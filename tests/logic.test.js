// Acceptance-criteria tests for the deterministic logic (spec §10). Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DAY_STATUS, dayProgress, dayStatus, habitsFor, targetsFor } from '../public/js/nutrition.js';
import { computeGaps, recommendFoods, recommendRecipes } from '../public/js/recommend.js';
import { RECIPES } from '../public/js/recipes.js';
import { FOOD_BY_ID } from '../public/js/foods.js';
import { canonical, foodTerms, recipeTerms } from '../public/js/matching.js';
import { detectSafety, stripCalories } from '../public/js/safety.js';
import { weakestNutrient } from '../public/js/memory.js';
import { addDays, localISO } from '../public/js/dates.js';
import { computeFlags, isRaisable, makeNote, notebookDigest, pruneNotes, recordRaised, summarizeMeds } from '../public/js/notebook.js';
import { applyOnboarding, defaultProfile, exportCSV, exportJSON, makeFoodLog, validateOnboarding } from '../public/js/store.js';
import { applyEdit, applyEntry, buildContext, createToolHandlers, deleteLog } from '../public/js/tools.js';

const table = JSON.parse(readFileSync(new URL('../public/data/nutrient_targets.json', import.meta.url)));
const TODAY = '2026-11-16'; // a Monday
const profile = (over = {}) => ({
  name: 'Test', birth_date: '1995-01-01', weight_kg: 60, height_cm: 165, diet_pattern: 'omnivore',
  allergies: [], favorite_foods: [], disliked_foods: [], prenatal_vitamin: null, hide_weight: false, ...over,
});
const newState = (over = {}) => ({
  onboarded: true, profile: profile(), foodLogs: [], habitLogs: [], customFoods: [], summaries: {},
  privateNotes: [], flagState: {}, chat: [], convo: [], hiddenRecipes: [], dismissed: {}, ...over,
});
const goodDay = (state, date) => state.foodLogs.push({ id: date, date, meal: 'lunch', food_id: 'lentils', name: 'x', qty: 1, unit: 'u', nutrients: { folate: 500, iron: 20, iodine: 200, choline: 50, calcium: 1100, vitamin_d: 700, protein: 60, b12: 3, fiber: 30, water: 3, dha: 300 }, flags: [] });

// ---------- AC1: onboarding ----------
test('AC1: onboarding cannot finish while a required field is empty', () => {
  const good = { name: 'Maya', birth_date: '1995-03-14', diet_pattern: 'vegetarian' };
  assert.deepEqual(validateOnboarding(good, TODAY), {});
  for (const k of Object.keys(good)) {
    const errs = validateOnboarding({ ...good, [k]: '' }, TODAY);
    assert.ok(errs[k], `missing ${k} should block`);
  }
  const s = newState({ onboarded: false });
  applyOnboarding(s, { ...good, allergies: 'Shellfish, peanut', weight_lb: '150' }, TODAY);
  assert.equal(s.onboarded, true);
  assert.deepEqual(s.profile.allergies, ['shellfish', 'peanut']);
  assert.equal(s.profile.weight_kg, 68, 'pounds converted to kg');
  assert.equal(defaultProfile().units, 'imperial', 'inches and pounds by default');
  assert.ok(s.profile.prenatal_vitamin, 'every account starts with a prenatal so checking it counts');
});

test('checking the prenatal adds its nutrients; it is the only daily checkbox', () => {
  const s = newState();
  applyOnboarding(s, { name: 'A', birth_date: '1995-01-01', diet_pattern: 'omnivore' }, TODAY);
  const before = dayProgress(s, TODAY, table).find((b) => b.key === 'folate').value;
  applyEntry(s, { kind: 'habit', date: TODAY, habit_key: 'prenatal' }, 'manual');
  const after = dayProgress(s, TODAY, table).find((b) => b.key === 'folate').value;
  assert.ok(after - before >= 680, `folate went ${before} -> ${after}`);
  assert.deepEqual(habitsFor(s, TODAY).map((h) => h.key), ['prenatal']);
});

// ---------- AC3/4: logging ----------
test('AC3/4: confirmed food entries update bars (same result by hand or AI)', () => {
  const ai = newState();
  const manual = newState();
  for (const [food_id, quantity] of [['egg', 2], ['whole_wheat_bread', 1], ['latte', 1]]) {
    applyEntry(ai, { kind: 'food', date: TODAY, meal: 'breakfast', food_id, quantity }, 'ai');
    manual.foodLogs.push(makeFoodLog({ date: TODAY, meal: 'breakfast', food_id, qty: quantity, source: 'manual' }));
  }
  const a = dayProgress(ai, TODAY, table);
  const m = dayProgress(manual, TODAY, table);
  assert.deepEqual(a.map((x) => x.value), m.map((x) => x.value));
  assert.ok(a.find((x) => x.key === 'choline').value >= 294);
});

// ---------- Calendar ----------
test('calendar day status: green at 8+ of 10 nutrients at 90%, yellow at 5-7, gray below, none if empty', () => {
  const s = newState();
  assert.equal(dayStatus(s, TODAY, table).level, null, 'nothing logged');
  const full = { folate: 400, iron: 18, iodine: 150, choline: 425, calcium: 1000, vitamin_d: 600, protein: 46, b12: 2.4, fiber: 25, water: 2.7 };
  const day = (date, scale) => s.foodLogs.push({ id: date, date, meal: 'lunch', food_id: 'lentils', name: 'x', qty: 1, unit: 'u', flags: [], nutrients: Object.fromEntries(Object.entries(full).map(([k, v]) => [k, v * (scale[k] ?? 1)])) });
  day('2026-11-01', {}); // all 10 met
  day('2026-11-02', { choline: 0.5, water: 0.5 }); // 8 met
  day('2026-11-03', { choline: 0.89 }); // 89% does not count; 9 met
  day('2026-11-04', { choline: 0, water: 0, vitamin_d: 0 }); // 7 met
  day('2026-11-05', { choline: 0, water: 0, vitamin_d: 0, calcium: 0, fiber: 0 }); // 5 met
  day('2026-11-06', { choline: 0, water: 0, vitamin_d: 0, calcium: 0, fiber: 0, iodine: 0 }); // 4 met
  const lv = (d) => dayStatus(s, d, table);
  assert.deepEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d) => [lv(d).level, lv(d).metCount]),
    [['green', 10], ['green', 8], ['green', 9], ['yellow', 7], ['yellow', 5], ['gray', 4]]);
  assert.equal(lv('2026-11-01').total, 10, 'DHA (7-day) is left out');
  assert.ok(lv('2026-11-03').unmet.includes('choline'));
  assert.deepEqual(DAY_STATUS, { metPct: 90, green: 8, yellow: 5 });
});

test('the AI can log, read and fix foods on earlier days; future dates are not allowed', async () => {
  const s = newState();
  const today = localISO();
  const earlier = addDays(today, -9);
  const h = createToolHandlers({ getState: () => s, commit: (fn) => fn(s), table, ui: { confirmLogs: async (e) => e, confirmEdit: async () => true } });
  const entry = (date) => ({ kind: 'food', date, time: null, meal: 'dinner', food_id: 'salmon', food_name: null, quantity: 1, portion_label: null, habit_key: null });
  await h.propose_logs({ entries: [entry(earlier), entry(addDays(today, 3))] }, {});
  assert.deepEqual(s.foodLogs.map((f) => f.date), [earlier, today], 'future date falls back to today');
  const day = await h.get_day_logs({ date: earlier });
  assert.equal(day.foods_with_ids.length, 1);
  assert.match(day.status, /of 10 daily nutrients/);
  const id = day.foods_with_ids[0].split(':')[0];
  await h.edit_log({ log_id: id, changes: { quantity: 2, meal: null, date: null } });
  assert.equal(s.foodLogs.find((f) => f.id === id).qty, 2);
  assert.ok((await h.get_day_logs({ date: addDays(today, 1) })).error);
});

test('removed features stay removed: no period, plan, exercise or alcohol tools', async () => {
  const { TOOLS, SYSTEM_PROMPT } = await import('../server/prompt.js');
  const names = TOOLS.map((t) => t.name);
  for (const n of ['get_cycle_status', 'get_plan_status']) assert.ok(!names.includes(n), n);
  const kinds = TOOLS.find((t) => t.name === 'propose_logs').parameters.properties.entries.items.properties.kind.enum;
  assert.deepEqual(kinds, ['food', 'habit']);
  assert.match(SYSTEM_PROMPT, /does not track periods, exercise/);
  const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.ok(!/cycleEvents|activityLogs|planStatus|programStatus/.test(app));
});

// ---------- AC6/7: no unprompted suggestions ----------
test('AC6: the UI never computes recommendations; only the chat tool does', () => {
  const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/recommend\.js'/.test(app), 'app.js must not import the recommender');
  assert.ok(!/recommendFoods|recommendRecipes/.test(app));
  const prompt = readFileSync(new URL('../server/prompt.js', import.meta.url), 'utf8');
  assert.match(prompt, /NO UNPROMPTED SUGGESTIONS/);
  assert.match(prompt, /confirm what was saved in 1-2 short sentences and STOP/);
});

test('AC6: propose_logs result carries no food ideas', async () => {
  const s = newState();
  const h = createToolHandlers({ getState: () => s, commit: (fn) => fn(s), table, ui: { confirmLogs: async (e) => e } });
  const res = await h.propose_logs({ entries: [{ kind: 'food', date: TODAY, meal: 'lunch', food_id: 'egg', quantity: 2, food_name: null, time: null, portion_label: null }] }, {});
  assert.equal(res.status, 'confirmed');
  assert.ok(!('foods' in res) && !('recipes' in res) && !('gaps' in res));
  assert.match(res.reminder, /No food suggestions/);
});

test('AC7: "rest of my nutrients" ideas target only unmet nutrients and respect filters', async () => {
  const s = newState({ profile: profile({ allergies: ['egg'], disliked_foods: ['salmon'] }) });
  goodDay(s, localISO()); // the recommend tool reads the real current date
  s.foodLogs[0].nutrients.choline = 50; // choline still low
  const h = createToolHandlers({ getState: () => s, commit: (fn) => fn(s), table, ui: {} });
  const res = await h.recommend({ gaps: [], meal_type: 'any' });
  assert.ok(res.gaps.every((g) => !res.met.includes(g.split(':')[0])), 'met nutrients are not gaps');
  assert.equal(res.gaps[0].split(':')[0], 'choline');
  const names = [...res.foods.map((f) => f.name), ...res.recipes.flatMap((r) => r.ingredients)].join(' ').toLowerCase();
  assert.ok(!/\begg/.test(names) && !/salmon/.test(names), names);
});

// ---------- AC8: combo meals (prompt rule) ----------
test('AC8: prompt tells the model to expand combo meals', () => {
  const prompt = readFileSync(new URL('../server/prompt.js', import.meta.url), 'utf8');
  assert.match(prompt, /Combo meals and bundles/);
});

// ---------- AC9: edits ----------
test('AC9: editing an entry changes it in place instead of adding a duplicate', async () => {
  const s = newState();
  const [id] = applyEntry(s, { kind: 'food', date: TODAY, meal: 'breakfast', food_id: 'egg', quantity: 2 }, 'ai');
  const h = createToolHandlers({ getState: () => s, commit: (fn) => fn(s), table, ui: { confirmEdit: async () => true, confirmDelete: async () => true } });
  const res = await h.edit_log({ log_id: id, changes: { quantity: 3, meal: null, date: null } });
  assert.equal(res.status, 'updated');
  assert.equal(s.foodLogs.length, 1);
  assert.equal(s.foodLogs[0].qty, 3);
  assert.equal(Math.round(s.foodLogs[0].nutrients.choline), 441);
  await h.delete_log({ log_id: id });
  assert.equal(s.foodLogs.length, 0);
  assert.equal(applyEdit(s, 'nope', {}), false);
  assert.equal(deleteLog(s, 'nope'), false);
});

// ---------- AC10: weight ----------
test('AC10: weight changes the protein target and nothing else; blank weight uses the floor', () => {
  const a = targetsFor(table, profile({ weight_kg: 60 }));
  const b = targetsFor(table, profile({ weight_kg: 80 }));
  assert.equal(a.protein, 48);
  assert.equal(b.protein, 64);
  for (const k of Object.keys(a)) if (k !== 'protein') assert.equal(a[k], b[k], k);
  assert.equal(targetsFor(table, profile({ weight_kg: null })).protein, 46);
  assert.equal(a.folate, 400);
  assert.equal(a.water, 2.7);
});

// ---------- AC11: exclusions ----------
const FIXTURES = [
  { profile: { disliked_foods: ['coriander leaves'] }, mustNotContain: ['cilantro'] },
  { profile: { disliked_foods: ['Mushrooms'] }, mustNotContain: ['mushroom'] },
  { profile: { disliked_foods: ['garbanzo beans'] }, mustNotContain: ['chickpea'] },
  { profile: { disliked_foods: ['salmon'] }, mustNotContain: ['salmon'] },
  { profile: { allergies: ['shellfish'] }, mustNotContain: ['shrimp'] },
  { profile: { allergies: ['prawns'] }, mustNotContain: ['shrimp'] },
  { profile: { allergies: ['milk'] }, mustNotContain: ['dairy', 'milk', 'cheese', 'yogurt'] },
  { profile: { allergies: ['tree nuts'] }, mustNotContain: ['walnut', 'almond'] },
  { profile: { allergies: ['peanut'] }, mustNotContain: ['peanut'] },
  { profile: { allergies: ['gluten'] }, mustNotContain: ['wheat', 'bread', 'pasta', 'tortilla'] },
  { profile: { allergies: ['egg'] }, mustNotContain: ['egg'] },
  { profile: { allergies: ['sesame'] }, mustNotContain: ['sesame', 'tahini'] },
  { profile: { diet_pattern: 'vegan' }, mustNotContain: ['dairy', 'egg', 'fish', 'poultry', 'meat', 'shellfish'] },
];
const fullGaps = () => table.nutrients.filter((n) => n.key !== 'water').map((n) => ({ key: n.key, target: n.daily || 50, remaining: n.daily || 50, pct: 0 }));

for (const fx of FIXTURES) {
  test(`AC11: never recommends excluded items: ${JSON.stringify(fx.profile)}`, () => {
    const p = profile(fx.profile);
    const needles = fx.mustNotContain.map(canonical);
    for (const meal of ['any', 'breakfast', 'lunch', 'dinner', 'snack']) {
      for (const ironBoost of [false, true]) {
        const foods = recommendFoods({ profile: p, gaps: fullGaps(), mealType: meal, ironBoost, limit: 999 });
        const recipes = recommendRecipes({ profile: p, gaps: fullGaps(), mealType: meal, ironBoost, limit: 999 });
        for (const f of foods) {
          const terms = foodTerms(FOOD_BY_ID[f.id]);
          for (const n of needles) assert.ok(!terms.some((t) => ` ${t} `.includes(` ${n} `)), `${f.name} contains ${n}`);
        }
        for (const r of recipes) {
          const terms = recipeTerms(RECIPES.find((x) => x.id === r.id), FOOD_BY_ID);
          for (const n of needles) assert.ok(!terms.some((t) => ` ${t} `.includes(` ${n} `)), `${r.name} contains ${n}`);
        }
      }
    }
  });
}

test('recommendations never include high-mercury fish or other flagged foods', () => {
  for (const f of recommendFoods({ profile: profile(), gaps: fullGaps(), limit: 999 })) assert.deepEqual(FOOD_BY_ID[f.id].flags, [], f.name);
});

// ---------- AC13/14: private notebook ----------
test('AC13: "Took 2 Advil" creates a private medication note with no confirmation card', async () => {
  const s = newState();
  let cards = 0;
  const ui = { confirmLogs: async () => { cards++; }, confirmProfile: async () => { cards++; }, confirmEdit: async () => { cards++; }, confirmDelete: async () => { cards++; } };
  const h = createToolHandlers({ getState: () => s, commit: (fn) => fn(s), table, ui });
  const res = await h.remember_private({ kind: 'medication', tag: 'nsaid', name: 'Ibuprofen', text: 'Took 2 Advil (400 mg ibuprofen) for cramps', dose: 400, unit: 'mg', amount: 2, occurred_on: TODAY, status: 'active', update_note_id: null }, { messageId: 'm1' });
  assert.equal(res.status, 'saved');
  assert.equal(cards, 0);
  assert.equal(s.privateNotes.length, 1);
  assert.deepEqual([s.privateNotes[0].kind, s.privateNotes[0].dose, s.privateNotes[0].name, s.privateNotes[0].source_message_id], ['medication', 400, 'ibuprofen', 'm1']);
  assert.equal(s.foodLogs.length + s.habitLogs.length, 0, 'no visible log');
  assert.equal(makeNote({ kind: 'medication', tag: 'other', text: 'had some motrin' }, { today: TODAY }).tag, 'nsaid', 'tag fallback');
});

test('AC14: ibuprofen on 4 days in 7 activates the NSAID flag; cooldown 7 days unless worse', () => {
  const s = newState();
  const add = (d) => s.privateNotes.push(makeNote({ kind: 'medication', tag: 'nsaid', name: 'ibuprofen', text: 'Advil', dose: 400, unit: 'mg', occurred_on: d }, { today: TODAY }));
  for (const d of [-6, -4, -2]) add(addDays(TODAY, d));
  assert.ok(!computeFlags(s, TODAY, table).some((f) => f.key === 'nsaid'), '3 days is not enough');
  add(TODAY);
  const flag = computeFlags(s, TODAY, table).find((f) => f.key === 'nsaid');
  assert.ok(flag);
  assert.equal(flag.level, 1);
  assert.ok(notebookDigest(s, TODAY, table).flags_to_consider.some((f) => f.key === 'nsaid'));

  s.flagState = recordRaised(s.flagState, 'nsaid', flag.level, TODAY);
  const d = notebookDigest(s, TODAY, table);
  assert.ok(!d.flags_to_consider.some((f) => f.key === 'nsaid'));
  assert.ok(d.flags_muted.includes('nsaid'));
  assert.ok(!isRaisable(flag, s.flagState.nsaid, addDays(TODAY, 6)));
  assert.ok(isRaisable(flag, s.flagState.nsaid, addDays(TODAY, 7)), 'after 7 days');
  assert.ok(isRaisable({ ...flag, level: 2 }, s.flagState.nsaid, addDays(TODAY, 1)), 'worse pattern lifts cooldown');
  add(addDays(TODAY, -1)); add(addDays(TODAY, -3));
  assert.equal(computeFlags(s, TODAY, table).find((f) => f.key === 'nsaid').level, 2);
});

test('notebook flags: vitamin A stacking, under-eating, headaches, caffeine, low iron (no alcohol flag)', () => {
  const s = newState({ profile: profile({ prenatal_vitamin: { name: 'P', folic_acid_mcg: 800, vitamin_a_mcg: 770 } }) });
  const note = (e) => s.privateNotes.push(makeNote(e, { today: TODAY }));
  note({ kind: 'supplement', tag: 'vitamin_a', name: 'skin vitamin', text: 'Started a vitamin A + E skin supplement daily', occurred_on: addDays(TODAY, -3) });
  for (const d of [0, -1, -2]) note({ kind: 'eating_context', tag: 'skipped_meal', text: 'Skipped lunch', occurred_on: addDays(TODAY, d) });
  for (const d of [0, -5, -9]) note({ kind: 'symptom', tag: 'headache', text: 'Headache', occurred_on: addDays(TODAY, d) });
  s.foodLogs.push(makeFoodLog({ date: TODAY, meal: 'dinner', food_id: 'wine', qty: 4, source: 'ai' }));
  for (const d of [0, -1, -2]) s.foodLogs.push(makeFoodLog({ date: addDays(TODAY, d), meal: 'snack', food_id: 'energy_drink', qty: 2, source: 'ai' }));
  note({ kind: 'eating_context', tag: 'nonfood_craving', text: 'Craving and chewing ice', occurred_on: addDays(TODAY, -2) });
  const keys = computeFlags(s, TODAY, table).map((f) => f.key);
  for (const k of ['vitamin_a', 'under_eating', 'headaches', 'high_caffeine', 'low_iron']) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes('heavy_alcohol'), 'alcohol is not tracked');
  assert.equal(dayProgress(s, TODAY, table).length, 11, 'wine still logs like a food');
});

test('notebook: closing notes, 12-month retention, med summary, digest stays compact', async () => {
  const s = newState();
  const h = createToolHandlers({ getState: () => s, commit: (fn) => fn(s), table, ui: {} });
  const { note_id } = await h.remember_private({ kind: 'supplement', tag: 'vitamin_a', name: 'skin vitamin', text: 'Started skin supplement', dose: null, unit: null, amount: null, occurred_on: TODAY, status: 'active', update_note_id: null });
  await h.remember_private({ kind: 'supplement', tag: 'other', name: null, text: 'stopped it', dose: null, unit: null, amount: null, occurred_on: TODAY, status: 'closed', update_note_id: note_id });
  assert.equal(s.privateNotes.length, 1);
  assert.equal(s.privateNotes[0].status, 'closed');
  const old = makeNote({ kind: 'symptom', text: 'old', occurred_on: '2025-10-01' }, { today: TODAY });
  assert.equal(pruneNotes([old, ...s.privateNotes], TODAY).length, 1);
  const meds = summarizeMeds([1, 2, 3].map((i) => makeNote({ kind: 'medication', name: 'ibuprofen', text: 'Advil', dose: 400, unit: 'mg', occurred_on: addDays(TODAY, -i) }, { today: TODAY })));
  assert.deepEqual([meds[0].name, meds[0].days_logged, meds[0].usual_dose], ['ibuprofen', 3, '400 mg']);
  const ctx = buildContext(s, table, new Date(`${TODAY}T10:00:00`));
  assert.ok(ctx.private_notebook && !('name' in ctx.profile) && !('birth_date' in ctx.profile), 'no name or birth date sent');
});

test('AC15: notebook never rendered in normal UI, but included in export', () => {
  const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.ok(!app.includes('privateNotes'), 'the UI never reads the private notebook');
  const s = newState();
  s.privateNotes.push(makeNote({ kind: 'medication', text: 'Took Advil', occurred_on: TODAY }, { today: TODAY }));
  assert.ok(JSON.parse(exportJSON(s)).privateNotes.length === 1);
  assert.match(exportCSV(s), /assistant_note/);
});

// ---------- AC16: weakest nutrient ----------
test('AC16: weakest nutrient is computed from logs and matches the lowest bar', () => {
  const s = newState();
  for (let i = 1; i <= 7; i++) goodDay(s, addDays(TODAY, -i));
  assert.equal(weakestNutrient(s, addDays(TODAY, -1), table).key, 'choline');
  assert.equal(computeGaps(dayProgress(s, addDays(TODAY, -1), table))[0].key, 'choline');
});

// ---------- AC17: safety ----------
test('AC17: urgent signs show the right templated card', () => {
  const cases = {
    medical: ['I have heavy bleeding', 'severe abdominal pain since this morning', 'my stomach is killing me', 'chest pain', 'I have trouble breathing', 'soaking through a pad every hour', 'fever of 100.5 and bad pelvic pain', 'I fainted'],
    poison: ['I accidentally took 5 prenatal vitamins', 'I drank some bleach by accident', 'took 12 tylenol', 'I think I overdosed'],
    crisis: ['I want to hurt myself', 'I feel hopeless and don\'t see the point anymore', 'thinking about suicide'],
  };
  for (const [kind, list] of Object.entries(cases)) for (const t of list) assert.equal(detectSafety(t), kind, t);
  for (const t of ['I ate 2 eggs', 'mild cramps today', 'period started today', 'had a headache earlier', 'Took 2 Advil for cramps', 'some light spotting', 'fever of 100.5']) assert.equal(detectSafety(t), null, t);
});

test('AC18: calorie sentences are stripped from model text', () => {
  assert.equal(stripCalories('Great lunch! That was about 600 calories. Choline is up.'), 'Great lunch! Choline is up.');
});

// ---------- AC21/22 ----------
test('AC21: no API key or OpenAI access in the shipped client', () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  for (const file of walk(new URL('../public', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
    const src = readFileSync(file, 'utf8');
    assert.ok(!/sk-[A-Za-z0-9_-]{20,}/.test(src), `key-like string in ${file}`);
    assert.ok(!/api\.openai\.com|OPENAI_API_KEY/.test(src), `OpenAI access in ${file}`);
  }
});

test('AC22: model names live in config, not code', () => {
  const cfg = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
  assert.ok(cfg.OPENAI_CHAT_MODEL);
  const llm = readFileSync(new URL('../server/llm.js', import.meta.url), 'utf8');
  assert.ok(!/gpt-\d/.test(llm), 'no hard-coded model in llm.js');
});

test('tool schemas are strict and every tool has a handler', async () => {
  const { TOOLS } = await import('../server/prompt.js');
  const h = createToolHandlers({ getState: () => newState(), commit: () => {}, table, ui: {} });
  for (const t of TOOLS) {
    assert.ok(h[t.name], `handler for ${t.name}`);
    assert.equal(t.strict, true);
    const check = (schema, path) => {
      if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) {
        assert.equal(schema.additionalProperties, false, path);
        assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), path);
        for (const [k, v] of Object.entries(schema.properties)) check(v, `${path}.${k}`);
      }
      if (schema.items) check(schema.items, `${path}[]`);
    };
    check(t.parameters, t.name);
  }
});
