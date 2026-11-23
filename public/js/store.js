// Local-first storage. Prototype uses localStorage on this device only.
// A production build would use encrypted on-device storage (e.g. SQLCipher / Keychain-wrapped key).
import { addDays, localISO, localTime } from './dates.js';
import { FOOD_BY_ID, scaleNutrients } from './foods.js';
import { makeNote, pruneNotes } from './notebook.js';

const KEY = 'nourish.v2';

export const DEFAULT_PRENATAL = {
  name: 'Generic prenatal', folic_acid_mcg: 800, iodine_mcg: 150, choline_mg: 55, dha_mg: 200,
  vitamin_a_mcg: 770, iron_mg: 27, vitamin_d_iu: 400, b12_mcg: 2.6,
};

export function defaultProfile() {
  return {
    name: '', birth_date: '', diet_pattern: '',
    allergies: [], disliked_foods: [], favorite_foods: [],
    height_cm: null, weight_kg: null, weight_updated_at: null,
    prenatal_vitamin: null,
    hide_weight: false, units: 'imperial',
  };
}

function emptyState() {
  return {
    onboarded: false,
    profile: defaultProfile(),
    foodLogs: [], habitLogs: [], customFoods: [],
    summaries: {}, patternNote: null,
    privateNotes: [], flagState: {},
    chat: [], convo: [], hiddenRecipes: [], dismissed: {},
    deviceId: crypto.randomUUID(),
  };
}

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Drop data from features that were removed (period tracker, plan, exercise). */
function dropRemoved(s) {
  for (const k of ['program', 'planItems', 'cycleEvents', 'activityLogs', 'wrapupSeenFor']) delete s[k];
  for (const k of ['avg_cycle_length', 'recent_hormonal_bc', 'activity_restricted']) delete s.profile?.[k];
  return s;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = dropRemoved({ ...emptyState(), ...JSON.parse(raw) });
      s.profile = { ...defaultProfile(), ...s.profile };
      s.privateNotes = pruneNotes(s.privateNotes, localISO());
      return s;
    }
  } catch { /* fall through to a fresh state */ }
  return emptyState();
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Onboarding validation: name, birth date and diet are required. */
export function validateOnboarding(f, today = localISO()) {
  const errors = {};
  if (!String(f.name || '').trim()) errors.name = 'Please add your name.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.birth_date || '')) errors.birth_date = 'Please add your birth date.';
  else if (f.birth_date >= today) errors.birth_date = 'Birth date must be in the past.';
  if (!['omnivore', 'pescatarian', 'vegetarian', 'vegan'].includes(f.diet_pattern)) errors.diet_pattern = 'Please choose a diet.';
  return errors;
}

/** Apply a validated onboarding form to state. */
export function applyOnboarding(state, f, today = localISO()) {
  const list = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  state.profile = {
    ...state.profile,
    name: f.name.trim(), birth_date: f.birth_date, diet_pattern: f.diet_pattern,
    allergies: list(f.allergies), disliked_foods: list(f.disliked_foods), favorite_foods: list(f.favorite_foods),
  };
  // Weight is entered in pounds and stored in kg. Every account starts with a standard prenatal (editable in Profile)
  // so checking it off counts toward the day's nutrients.
  const lb = Number(f.weight_lb);
  if (lb > 0) { state.profile.weight_kg = Math.round((lb / 2.2046) * 10) / 10; state.profile.weight_updated_at = today; }
  state.profile.prenatal_vitamin ||= { ...DEFAULT_PRENATAL };
  state.onboarded = true;
}

export function makeFoodLog({ date, time, meal, food_id, food_name, qty, portion_label, source, message_id }) {
  const food = FOOD_BY_ID[food_id];
  return {
    id: uid(), date, time: time || localTime(), meal: meal || guessMeal(time),
    food_id: food ? food.id : null, name: food ? food.name : food_name || 'Unknown food',
    qty: qty || (food ? food.defaultQty : 1), unit: food ? food.unit : 'serving', portion_label: portion_label || null,
    nutrients: food ? scaleNutrients(food.nutrients, qty || food.defaultQty) : {},
    flags: food ? food.flags : [], estimated: Boolean(food?.web), source, message_id: message_id || null,
  };
}

export function guessMeal(time) {
  const h = Number((time || localTime()).slice(0, 2));
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h >= 17 && h < 21) return 'dinner';
  return 'snack';
}

/** Export includes everything the app holds, including the private notebook. */
export function exportJSON(state) {
  const { convo, deviceId, ...rest } = state;
  return JSON.stringify(rest, null, 2);
}

export function exportCSV(state) {
  const rows = [['type', 'date', 'time', 'name/kind', 'amount', 'source']];
  for (const f of state.foodLogs) rows.push(['food', f.date, f.time, f.name, `${f.qty} x ${f.unit}`, f.source]);
  for (const h of state.habitLogs) rows.push(['habit', h.date, '', h.habit_key, h.done ? 'done' : 'undone', h.source]);
  for (const n of state.privateNotes) rows.push(['assistant_note', n.occurred_on, '', `${n.kind}: ${n.text}`, n.dose ? `${n.dose} ${n.unit || ''}`.trim() : '', 'ai']);
  return rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

/** Demo: three weeks of food logs with a mix of strong and weak days, plus a few assistant notes. */
export function demoState() {
  const today = localISO();
  const s = emptyState();
  s.onboarded = true;
  s.profile = {
    ...defaultProfile(), name: 'Maya', birth_date: '1995-03-14', diet_pattern: 'omnivore',
    height_cm: 165, weight_kg: 64, weight_updated_at: addDays(today, -20),
    favorite_foods: ['salmon', 'berries'], disliked_foods: ['mushrooms', 'coriander'],
    prenatal_vitamin: { ...DEFAULT_PRENATAL },
  };

  const days = [
    { b: [['oatmeal', 1], ['berries', 1], ['coffee', 1]], l: [['lentils', 1], ['mixed_greens', 1]], d: [['pasta', 1.5], ['spinach_cooked', 1]] },
    { b: [['fortified_cereal', 1], ['milk', 1]], l: [['chicken_salad', 1]], d: [['black_beans', 1], ['brown_rice', 1], ['avocado', 1]] },
    { b: [['veggie_omelet', 1], ['milk', 1]], l: [['burrito_bowl', 1], ['greek_yogurt', 1]], d: [['salmon', 1], ['broccoli', 1], ['quinoa', 1]] },
    { b: [['avocado_toast', 1], ['latte', 1]], l: [['hummus', 1], ['whole_wheat_bread', 2], ['carrots', 1]], d: [['pizza', 2]] },
    { b: [['fortified_cereal', 1], ['soy_milk', 1]], l: [['lentils', 1], ['spinach_raw', 1]], d: [['chicken_stirfry', 1], ['greek_yogurt', 1]] },
    { b: [['greek_yogurt', 1], ['berries', 1], ['egg', 2]], l: [['chickpeas', 1], ['quinoa', 1]], d: [['salmon', 1], ['sweet_potato', 1], ['mixed_greens', 1]] },
    { b: [['bagel', 1], ['coffee', 1]], l: [['turkey_sandwich', 1]], d: [['mac_cheese', 1]] },
  ];
  for (let off = 20; off >= 1; off--) {
    if (off % 6 === 0) continue; // a few days with nothing logged
    const date = addDays(today, -off);
    const meals = days[off % days.length];
    const add = (items, meal, time) => items.forEach(([food_id, qty]) => s.foodLogs.push(makeFoodLog({ date, time, meal, food_id, qty, source: off % 2 ? 'ai' : 'manual' })));
    add(meals.b, 'breakfast', '08:00');
    add(meals.l, 'lunch', '12:30');
    add(meals.d, 'dinner', '18:45');
    s.foodLogs.push(makeFoodLog({ date, time: '15:00', meal: 'snack', food_id: 'water', qty: off % 3 ? 8 : 5, source: 'manual' }));
    if (off % 5 !== 0) s.habitLogs.push({ id: uid(), date, habit_key: 'prenatal', done: true, source: 'manual' });
  }

  const note = (e) => s.privateNotes.push(makeNote(e, { today }));
  note({ kind: 'medication', tag: 'nsaid', name: 'ibuprofen', text: 'Took 2 Advil (400 mg ibuprofen) for cramps', dose: 400, unit: 'mg', occurred_on: addDays(today, -1) });
  note({ kind: 'medication', tag: 'nsaid', name: 'ibuprofen', text: 'Took 2 Advil (400 mg ibuprofen) for cramps', dose: 400, unit: 'mg', occurred_on: today });
  note({ kind: 'symptom', tag: 'headache', text: 'Mild headache in the afternoon', occurred_on: addDays(today, -4) });
  note({ kind: 'preference_context', text: 'Can\'t stand the smell of fish cooking at home; fine with fish at restaurants or canned', occurred_on: addDays(today, -12) });
  note({ kind: 'health_context', text: 'Preconception visit booked with her OB for later this month', occurred_on: addDays(today, -20) });
  return s;
}
