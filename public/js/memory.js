// Visible memory (spec §7.2): daily summaries, weekly patterns and the whole-program view.
// Patterns are plain observations; they never include advice.
// The Food week view and the AI's get_context() both use weakestNutrient() over the same completed days,
// so they always agree. Today is excluded because a half-logged day would skew the pattern.
import { addDays, range } from './dates.js';
import { dayFoods, dayProgress, habitsFor, limitStatus } from './nutrition.js';

/** Patterns cover completed days only: a window ending today ends yesterday instead. */
export function completedThrough(date, todayISO) {
  return date >= todayISO ? addDays(todayISO, -1) : date;
}

const PATTERN_KEYS = ['folate', 'iron', 'iodine', 'choline', 'calcium', 'vitamin_d', 'protein', 'b12', 'fiber'];

export function dailySummary(state, date, table) {
  const progress = dayProgress(state, date, table);
  return {
    date,
    logged: dayFoods(state, date).length > 0,
    nutrient_pct: Object.fromEntries(progress.map((p) => [p.key, p.pct])),
    habits: Object.fromEntries(habitsFor(state, date).map((h) => [h.key, h.done])),
    limit_flags: limitStatus(state, date, table).filter((l) => l.level === 'over').map((l) => l.key),
  };
}

export function weekSummaries(state, endDate, table, days = 7) {
  return range(addDays(endDate, -(days - 1)), endDate).map((d) => dailySummary(state, d, table));
}

/** Lowest average % of target over logged days in the window. */
export function weakestNutrient(state, endDate, table, labels = {}) {
  const logged = weekSummaries(state, endDate, table).filter((s) => s.logged);
  if (logged.length < 3) return null;
  let worst = null;
  for (const key of PATTERN_KEYS) {
    const avg = logged.reduce((s, d) => s + Math.min(d.nutrient_pct[key], 100), 0) / logged.length;
    const metDays = logged.filter((d) => d.nutrient_pct[key] >= 100).length;
    if (!worst || avg < worst.avg) worst = { key, label: labels[key] || key, avg: Math.round(avg), metDays, days: logged.length };
  }
  return worst;
}

/** Plain-language pattern notes for the last 7 days. */
export function patternNotes(state, endDate, table) {
  const labels = Object.fromEntries(table.nutrients.map((n) => [n.key, n.label]));
  const logged = weekSummaries(state, endDate, table).filter((s) => s.logged);
  if (logged.length < 3) return [];
  const notes = [];
  const n = logged.length;
  const strong = PATTERN_KEYS.filter((k) => logged.filter((d) => d.nutrient_pct[k] >= 100).length >= Math.ceil(n * 0.7));
  if (strong.length) notes.push(`${listJoin(strong.map((k) => labels[k]))} met on most days.`);
  for (const k of PATTERN_KEYS) {
    const low = logged.filter((d) => d.nutrient_pct[k] < 50).length;
    if (low >= Math.ceil(n * 0.6)) notes.push(`${labels[k]} under 50% on ${low} of the last ${n} logged days.`);
  }
  const prenatal = logged.filter((d) => d.habits.prenatal).length;
  if (prenatal < n) notes.push(`Prenatal taken on ${prenatal} of ${n} logged days.`);
  const caffeineOver = logged.filter((d) => d.limit_flags.includes('caffeine')).length;
  if (caffeineOver) notes.push(`Caffeine went over 200 mg on ${caffeineOver} day${caffeineOver > 1 ? 's' : ''}.`);
  const breakfastProtein = breakfastProteinLow(state, logged.map((d) => d.date));
  if (breakfastProtein) notes.push('Breakfasts are often low in protein.');
  const sugary = state.foodLogs.filter((f) => logged.some((d) => d.date === f.date) && (f.flags || []).some((x) => x === 'sugary' || x === 'trans_fat')).length;
  if (sugary >= 3) notes.push(`Sugary drinks or fried/processed treats ${sugary} times this week.`);
  return notes;
}

function listJoin(a) {
  return a.length < 3 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

function breakfastProteinLow(state, dates) {
  const days = dates.filter((d) => state.foodLogs.some((f) => f.date === d && f.meal === 'breakfast'));
  if (days.length < 3) return false;
  const low = days.filter((d) => state.foodLogs.filter((f) => f.date === d && f.meal === 'breakfast').reduce((s, f) => s + (f.nutrients.protein || 0), 0) < 15).length;
  return low >= Math.ceil(days.length * 0.6);
}
