// Targets, daily totals, limits, habits and activity. Pure functions over app state (spec §3).
import { addDays, range } from './dates.js';
import { FOOD_BY_ID } from './foods.js';

export const BAR_KEYS = ['folate', 'iron', 'iodine', 'choline', 'dha', 'calcium', 'vitamin_d', 'protein', 'b12', 'fiber', 'water'];
export const LIMIT_KEYS = ['caffeine', 'retinol', 'alcohol'];

/** Daily targets. Only protein depends on body weight; with no weight the floor is used. */
export function targetsFor(table, profile) {
  const out = {};
  for (const n of table.nutrients) {
    if (n.per_kg) {
      const kg = Number(profile.weight_kg) || 0;
      out[n.key] = Math.max(Math.round(n.per_kg * kg), n.floor);
    } else {
      out[n.key] = n.daily;
    }
  }
  return out;
}

/** Nutrients the prenatal vitamin adds on days it's checked off. Folic acid counts 1.7x as DFE. */
export function prenatalNutrients(profile) {
  const p = profile.prenatal_vitamin;
  if (!p) return {};
  return {
    folate: (Number(p.folic_acid_mcg) || 0) * 1.7,
    iodine: Number(p.iodine_mcg) || 0,
    choline: Number(p.choline_mg) || 0,
    dha: Number(p.dha_mg) || 0,
    retinol: Number(p.vitamin_a_mcg) || 0,
    iron: Number(p.iron_mg) || 0,
    vitamin_d: Number(p.vitamin_d_iu) || 0,
    b12: Number(p.b12_mcg) || 0,
  };
}

/** Label checks for the chosen prenatal (spec §2, plan item 2). Facts about the label, not food advice. */
export function prenatalWarnings(profile) {
  const p = profile.prenatal_vitamin;
  if (!p) return ['No prenatal vitamin set up yet.'];
  const w = [];
  if (Number(p.folic_acid_mcg) < 400) w.push('This prenatal lists under 400 mcg folic acid.');
  if (!Number(p.iodine_mcg)) w.push('This prenatal lists no iodine.');
  if (!Number(p.dha_mg)) w.push('This prenatal lists no DHA.');
  if (Number(p.choline_mg) < 100) w.push('This prenatal is low in choline (most are).');
  if (Number(p.vitamin_a_mcg) > 1500) w.push('This prenatal is high in preformed vitamin A. Check before adding any other vitamin A product.');
  return w;
}

export function latestHabit(state, date, key) {
  const logs = state.habitLogs.filter((h) => h.date === date && h.habit_key === key);
  return logs.length ? logs[logs.length - 1] : null;
}

export const prenatalTaken = (state, date) => Boolean(latestHabit(state, date, 'prenatal')?.done);

export function dayFoods(state, date) {
  return state.foodLogs.filter((f) => f.date === date);
}

/** All nutrient + limit totals for a day (foods + prenatal when taken). */
export function dayTotals(state, date) {
  const t = Object.fromEntries([...BAR_KEYS, ...LIMIT_KEYS].map((k) => [k, 0]));
  for (const log of dayFoods(state, date)) for (const [k, v] of Object.entries(log.nutrients)) if (k in t) t[k] += v;
  if (prenatalTaken(state, date)) for (const [k, v] of Object.entries(prenatalNutrients(state.profile))) t[k] += v;
  return t;
}

export function contributors(state, date, key) {
  const list = dayFoods(state, date)
    .filter((f) => (f.nutrients[key] || 0) > 0)
    .map((f) => ({ name: f.name, label: f.portion_label || `${f.qty} × ${f.unit}`, amount: f.nutrients[key] }));
  if (prenatalTaken(state, date)) {
    const v = prenatalNutrients(state.profile)[key];
    if (v) list.push({ name: state.profile.prenatal_vitamin?.name || 'Prenatal vitamin', label: '1 dose', amount: v });
  }
  return list.sort((a, b) => b.amount - a.amount);
}

/** Bars for one day. DHA is weekly: 7-day sum vs 7 × daily target. */
export function dayProgress(state, date, table) {
  const targets = targetsFor(table, state.profile);
  const totals = dayTotals(state, date);
  return table.nutrients.map((n) => {
    let value = totals[n.key];
    let target = targets[n.key];
    if (n.weekly) {
      value = range(addDays(date, -6), date).reduce((s, d) => s + dayTotals(state, d)[n.key], 0);
      target *= 7;
    }
    value = Math.round(value * 10) / 10;
    return { key: n.key, label: n.label, unit: n.unit, weekly: Boolean(n.weekly), value, target, pct: target ? Math.round((value / target) * 100) : 0 };
  });
}

/** Daily "stay under" meters (caffeine, retinol). */
export function limitStatus(state, date, table) {
  const totals = dayTotals(state, date);
  return table.limits.map((l) => {
    const value = Math.round(totals[l.key] * 10) / 10;
    let level = 'ok';
    if (value > l.max) level = 'over';
    else if (value >= l.amber) level = 'amber';
    return { ...l, value, level };
  });
}

/** Daily checklist: just the prenatal vitamin. Checking it adds the prenatal's nutrients to the day. */
export function habitsFor(state, date) {
  return [{ key: 'prenatal', label: 'Prenatal vitamin taken', done: prenatalTaken(state, date) }];
}

export function fishServings(state, endDate) {
  const days = range(addDays(endDate, -6), endDate);
  return state.foodLogs.filter((f) => days.includes(f.date) && FOOD_BY_ID[f.food_id]?.fishServing).reduce((s, f) => s + Math.min(f.qty, 2), 0);
}

/**
 * Calendar day status. A nutrient counts as met at ${MET_PCT}%+ of its target. DHA is left out because it's
 * counted over 7 days. Green: 8+ of the 10 daily nutrients met; yellow: 5–7; gray: food logged but fewer than 5.
 */
export const DAY_STATUS = { metPct: 90, green: 8, yellow: 5 };

export function dayStatus(state, date, table) {
  const logged = dayFoods(state, date).length > 0 || prenatalTaken(state, date);
  const daily = dayProgress(state, date, table).filter((p) => !p.weekly);
  const met = daily.filter((p) => p.pct >= DAY_STATUS.metPct);
  const level = !logged ? null : met.length >= DAY_STATUS.green ? 'green' : met.length >= DAY_STATUS.yellow ? 'yellow' : 'gray';
  return { date, logged, level, metCount: met.length, total: daily.length, met: met.map((p) => p.key), unmet: daily.filter((p) => p.pct < DAY_STATUS.metPct).map((p) => p.key) };
}

export function bmi(profile) {
  const h = Number(profile.height_cm) / 100;
  const w = Number(profile.weight_kg);
  return h && w ? Math.round((w / (h * h)) * 10) / 10 : null;
}
