// On-device handlers for the model's function tools (spec §5.2). The proxy forwards tool calls here;
// only the minimum context leaves the device (no name or birth date; age as a number).
import { ageOn, addDays, localISO, localTime, range } from './dates.js';
import { FLAG_TEXT, FOOD_BY_ID, registerFood, searchFoods, webFood } from './foods.js';
import { RECIPES } from './recipes.js';
import { bmi, dayFoods, dayProgress, dayStatus, fishServings, habitsFor, limitStatus } from './nutrition.js';
import { completedThrough, patternNotes, weakestNutrient, weekSummaries } from './memory.js';
import { computeGaps, recommendFoods, recommendRecipes } from './recommend.js';
import { computeFlags, historyFor, makeNote, notebookDigest, recordRaised, syncFlagState } from './notebook.js';
import { makeFoodLog, uid } from './store.js';

const pctMap = (progress) => Object.fromEntries(progress.map((p) => [p.key, `${p.value}/${p.target} ${p.unit} (${p.pct}%)${p.weekly ? ' [7-day]' : ''}`]));

const HABIT_LABEL = { prenatal: 'Prenatal vitamin taken' };

/** Turn one confirmed entry into stored log(s). Shared by chat and manual logging. */
export function applyEntry(state, e, source, messageId = null) {
  if (e.kind === 'food') {
    const log = makeFoodLog({ date: e.date, time: e.time, meal: e.meal, food_id: e.food_id, food_name: e.food_name, qty: e.quantity, portion_label: e.portion_label, source, message_id: messageId });
    state.foodLogs.push(log);
    return [log.id];
  }
  if (e.kind === 'habit') {
    const log = { id: uid(), date: e.date, habit_key: e.habit_key, done: true, source, message_id: messageId };
    state.habitLogs.push(log);
    return [log.id];
  }
  return [];
}

export function describeEntry(e) {
  if (e.kind === 'food') {
    const f = FOOD_BY_ID[e.food_id];
    return f ? f.name : e.food_name || 'Food';
  }
  if (e.kind === 'habit') return HABIT_LABEL[e.habit_key] || e.habit_key;
  return 'Entry';
}

/** Find any visible log by id (food or prenatal check-off). */
export function findLog(state, id) {
  for (const [coll, kind] of [['foodLogs', 'food'], ['habitLogs', 'habit']]) {
    const log = state[coll].find((x) => x.id === id);
    if (log) return { coll, kind, log };
  }
  return null;
}

export function describeLog({ kind, log }) {
  if (kind === 'food') return `${log.name}, ${log.portion_label || `${log.qty} × ${log.unit}`} (${log.meal}, ${log.date})`;
  return `${HABIT_LABEL[log.habit_key] || log.habit_key} (${log.date})`;
}

/** Apply an edit_log change to a stored log (re-scales food nutrients). */
export function applyEdit(state, id, changes) {
  const found = findLog(state, id);
  if (!found) return false;
  const { kind, log } = found;
  if (changes.date && /^\d{4}-\d{2}-\d{2}$/.test(changes.date)) log.date = changes.date;
  if (kind === 'food') {
    if (changes.meal) log.meal = changes.meal;
    if (changes.quantity && log.food_id) {
      const updated = makeFoodLog({ ...log, food_id: log.food_id, qty: changes.quantity });
      Object.assign(log, { qty: updated.qty, nutrients: updated.nutrients, portion_label: null });
    }
  }
  return true;
}

export function deleteLog(state, id) {
  const found = findLog(state, id);
  if (!found) return false;
  state[found.coll] = state[found.coll].filter((x) => x.id !== id);
  return true;
}

export function buildContext(state, table, now = new Date()) {
  const today = localISO(now);
  const p = state.profile;
  const labels = Object.fromEntries(table.nutrients.map((n) => [n.key, n.label]));
  const profile = {
    age: ageOn(p.birth_date, today),
    diet_pattern: p.diet_pattern, allergies: p.allergies, favorite_foods: p.favorite_foods, disliked_foods: p.disliked_foods,
    prenatal_vitamin: p.prenatal_vitamin, hide_weight: p.hide_weight, units: p.units,
  };
  if (!p.hide_weight) Object.assign(profile, { weight_kg: p.weight_kg, height_cm: p.height_cm, bmi: bmi(p) });
  const recentLogs = range(addDays(today, -2), today).flatMap((d) => dayFoods(state, d).map(logLine));
  return {
    now: { date: today, time: localTime(now), weekday: now.toLocaleDateString('en-US', { weekday: 'long' }), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, yesterday: addDays(today, -1) },
    profile,
    today: {
      progress: pctMap(dayProgress(state, today, table)),
      limits: Object.fromEntries(limitStatus(state, today, table).map((l) => [l.key, `${l.value} ${l.unit} (stay under ${l.max}, ${l.level})`])),
      habits: Object.fromEntries(habitsFor(state, today).map((h) => [h.key, h.done])),
    },
    recent_logs_with_ids: recentLogs,
    logs_for_other_days: 'Call get_day_logs(date) to see or edit foods on any earlier day.',
    last_7_days: weekSummaries(state, today, table).filter((s) => s.logged).map((s) => ({ date: s.date, pct: s.nutrient_pct, prenatal: s.habits.prenatal })),
    weakest_nutrient_7d: weakestNutrient(state, completedThrough(today, today), table, labels),
    visible_patterns: [...patternNotes(state, completedThrough(today, today), table), ...(state.patternNote ? [state.patternNote.text] : [])],
    private_notebook: notebookDigest(state, today, table),
  };
}

const logLine = (f) => `${f.id}: ${f.date} ${f.meal} ${f.name} x${f.qty} ${f.unit}${f.food_id ? '' : ' (no nutrition data)'}`;

/**
 * ctx: { getState, commit(fn), api, table,
 *        ui: { confirmLogs(entries, meta), confirmProfile(change), confirmEdit(desc, changes), confirmDelete(desc), showSafety(kind) } }
 */
export function createToolHandlers(ctx) {
  const today = () => localISO();

  return {
    get_context: () => {
      const st = ctx.getState();
      const flags = computeFlags(st, today(), ctx.table);
      ctx.commit((s) => { s.flagState = syncFlagState(s.flagState || {}, flags, today()); }, { silent: true });
      return buildContext(ctx.getState(), ctx.table);
    },

    lookup_food: ({ query, portion }) => {
      const n = Number(String(portion || '').match(/\d+(\.\d+)?/)?.[0]);
      const results = searchFoods(query, 3);
      if (!results.length) return { candidates: [], note: 'No match in the local database. Call search_food_web.' };
      return {
        candidates: results.map((f) => ({
          food_id: f.id, name: f.name, unit: f.unit, default_quantity: f.defaultQty,
          suggested_quantity: Number.isFinite(n) && n > 0 ? n : f.defaultQty,
          per_unit: Object.fromEntries(Object.entries(f.nutrients).filter(([, v]) => v)),
          log_time_notes: f.flags.filter((x) => FLAG_TEXT[x]).map((x) => FLAG_TEXT[x]),
          ...(f.web ? { from_web: true } : {}),
        })),
        note: 'If none of these is really the food she named (a specific restaurant item, brand or dish), call search_food_web instead.',
      };
    },

    search_food_web: async ({ query, portion }) => {
      const food = await lookupWebFood(ctx, query, portion);
      if (!food) return { found: false, note: 'Not found on the web. If it is a dish, build it from database ingredients with lookup_food (e.g. pasta + sauce) instead. Use food_id null only if nothing reasonable fits; it will not count toward nutrients.' };
      return {
        found: true, food_id: food.id, name: food.name, unit: food.unit, suggested_quantity: 1,
        per_unit: food.nutrients, estimated: food.web.estimated, sources: food.web.sources.map((x) => x.url),
        log_time_notes: food.flags.filter((x) => FLAG_TEXT[x]).map((x) => FLAG_TEXT[x]),
      };
    },

    propose_logs: async ({ entries }, meta) => {
      const clean = entries.map((e) => ({ ...e, food_id: e.food_id && FOOD_BY_ID[e.food_id] ? e.food_id : null, date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date <= today() ? e.date : today() }));
      const confirmed = await ctx.ui.confirmLogs(clean, meta);
      if (!confirmed) return { status: 'cancelled', note: 'She cancelled. Nothing was logged. Ask what she wants to change.' };
      let ids = [];
      ctx.commit((s) => { for (const e of confirmed) ids = ids.concat(applyEntry(s, e, 'ai', meta?.messageId)); });
      const st = ctx.getState();
      const notes = confirmed.filter((e) => e.kind === 'food' && e.food_id).flatMap((e) => FOOD_BY_ID[e.food_id].flags.map((f) => FLAG_TEXT[f]).filter(Boolean));
      return {
        status: 'confirmed',
        logged: confirmed.map((e, i) => `${ids[i]}: ${e.date} ${describeEntry(e)}${e.quantity ? ` x${e.quantity}` : ''}${e.minutes ? ` ${e.minutes} min` : ''}`),
        log_ids: ids,
        log_time_notes: [...new Set(notes)],
        reminder: 'Confirm what was saved in 1-2 sentences and stop. No food suggestions unless she asked for ideas.',
        limits_today: limitStatus(st, today(), ctx.table).filter((l) => l.level !== 'ok').map((l) => `${l.key}: ${l.value} ${l.unit} (${l.level})`),
      };
    },

    edit_log: async ({ log_id, changes }) => {
      const found = findLog(ctx.getState(), log_id);
      if (!found) return { status: 'not_found', note: 'No log with that id. Check recent_logs_with_ids in get_context.' };
      const clean = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== null && v !== undefined));
      const ok = await ctx.ui.confirmEdit(describeLog(found), clean);
      if (!ok) return { status: 'declined' };
      ctx.commit((s) => applyEdit(s, log_id, clean));
      const after = findLog(ctx.getState(), log_id);
      return { status: 'updated', now: describeLog(after) };
    },

    delete_log: async ({ log_id }) => {
      const found = findLog(ctx.getState(), log_id);
      if (!found) return { status: 'not_found', note: 'No log with that id. Check recent_logs_with_ids in get_context.' };
      const ok = await ctx.ui.confirmDelete(describeLog(found));
      if (!ok) return { status: 'declined' };
      ctx.commit((s) => deleteLog(s, log_id));
      return { status: 'deleted' };
    },

    get_progress: ({ start_date, end_date }) => {
      const st = ctx.getState();
      const days = range(start_date, end_date > today() ? today() : end_date).slice(-31);
      return {
        days: days.map((d) => ({ date: d, progress: pctMap(dayProgress(st, d, ctx.table)), over_limits: limitStatus(st, d, ctx.table).filter((l) => l.level === 'over').map((l) => `${l.key}: ${l.value} ${l.unit}`) })),
        calendar_status: days.map((d) => { const ds = dayStatus(st, d, ctx.table); return `${d}: ${ds.logged ? `${ds.level} (${ds.metCount}/${ds.total} nutrients at 90%+)` : 'nothing logged'}`; }),
      };
    },

    get_day_logs: ({ date }) => {
      const st = ctx.getState();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) return { error: 'Use a past or current date as YYYY-MM-DD.' };
      const ds = dayStatus(st, date, ctx.table);
      return {
        date,
        foods_with_ids: dayFoods(st, date).map(logLine),
        prenatal_taken: habitsFor(st, date)[0].done,
        status: ds.logged ? `${ds.level}: ${ds.metCount} of ${ds.total} daily nutrients at 90%+` : 'nothing logged',
        unmet: ds.unmet,
      };
    },

    recommend: ({ gaps, meal_type }) => {
      const st = ctx.getState();
      const d = today();
      const progress = dayProgress(st, d, ctx.table);
      const gapList = computeGaps(progress, gaps);
      const focus = weakestNutrient(st, completedThrough(d, d), ctx.table)?.key || null;
      const foods = recommendFoods({ profile: st.profile, gaps: gapList, mealType: meal_type, focus });
      const recipes = recommendRecipes({ profile: st.profile, gaps: gapList, mealType: meal_type, focus, fishThisWeek: fishServings(st, d), hidden: st.hiddenRecipes });
      return {
        gaps: gapList.slice(0, 5).map((g) => `${g.key}: ${g.pct}% of target, ${Math.round(g.remaining)} to go`),
        met: progress.filter((p) => p.pct >= 100).map((p) => p.key),
        foods: foods.map((f) => ({ name: f.name, portion: `${f.qty} × ${f.unit}`, helps: f.helps.map((h) => `+${h.amount} ${h.key}`), favorite: f.favorite })),
        recipes: recipes.map((r) => {
          const rec = RECIPES.find((x) => x.id === r.id);
          return { name: r.name, minutes: r.minutes, helps: r.helps.map((h) => `+${h.amount} ${h.key}`), ingredients: [...rec.components.map((c) => FOOD_BY_ID[c.food].name), ...rec.ingredients], steps: rec.steps };
        }),
        note: 'Already filtered for allergies, dislikes, diet and high-mercury fish. Suggest only these.',
      };
    },

    update_profile: async (change) => {
      const ok = await ctx.ui.confirmProfile(change);
      if (!ok) return { status: 'declined' };
      ctx.commit((s) => applyProfileChange(s.profile, change));
      return { status: 'saved', profile_field: change.field, value: ctx.getState().profile[change.field] };
    },

    remember_private: (entry, meta) => {
      if (entry.update_note_id) {
        let found = false;
        ctx.commit((s) => {
          const n = s.privateNotes.find((x) => x.id === entry.update_note_id);
          if (!n) return;
          found = true;
          if (entry.status) n.status = entry.status;
          if (entry.text) n.text = `${n.text} → ${entry.text}`.slice(0, 300);
          n.updated_at = today();
        }, { silent: true });
        return found ? { status: 'updated' } : { status: 'not_found' };
      }
      const note = makeNote(entry, { today: today(), messageId: meta?.messageId });
      ctx.commit((s) => { s.privateNotes.push(note); }, { silent: true });
      return { status: 'saved', note_id: note.id, reminder: 'Do not mention this note to her.' };
    },

    get_private_history: (q) => ({ entries: historyFor(ctx.getState(), q) }),

    mark_flag_raised: ({ flag_key }) => {
      const st = ctx.getState();
      const flag = computeFlags(st, today(), ctx.table).find((f) => f.key === flag_key);
      if (!flag) return { status: 'unknown_flag' };
      ctx.commit((s) => { s.flagState = recordRaised(s.flagState || {}, flag_key, flag.level, today()); }, { silent: true });
      return { status: 'recorded', muted_until: addDays(today(), 7), note: 'Muted for 7 days unless the pattern gets worse.' };
    },

    show_safety_card: ({ kind }) => {
      ctx.ui.showSafety(kind);
      return { status: 'shown', note: 'The templated card is on screen. Keep your reply to one short, caring sentence that points to the card.' };
    },
  };
}

/**
 * Look a food up on the web (via the proxy), save it on the device as a custom food and register it
 * so it behaves like a database food from then on. ctx: { getState, commit, api }.
 */
export async function lookupWebFood(ctx, query, portion = null) {
  const result = await ctx.api('/api/food-search', { query, portion });
  if (!result.found) return null;
  const food = webFood(result, query, `web_${uid()}`);
  registerFood(food);
  ctx.commit((s) => { s.customFoods.push(food); });
  return food;
}

export function applyProfileChange(profile, { field, action, value }) {
  if (Array.isArray(profile[field])) {
    const v = value.trim().toLowerCase();
    if (action === 'remove') profile[field] = profile[field].filter((x) => x.toLowerCase() !== v);
    else if (!profile[field].some((x) => x.toLowerCase() === v)) profile[field] = [...profile[field], v];
  } else if (field === 'weight_kg') {
    const kg = parseFloat(value);
    if (kg > 25 && kg < 300) { profile.weight_kg = kg; profile.weight_updated_at = localISO(); }
  } else if (field === 'diet_pattern') {
    if (['omnivore', 'pescatarian', 'vegetarian', 'vegan'].includes(value)) profile.diet_pattern = value;
  }
}
