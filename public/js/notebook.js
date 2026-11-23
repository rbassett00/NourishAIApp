// Private assistant notebook (spec §7.3). An internal memory only the AI reads: never rendered in the
// normal UI, included in Export, erased by Delete everything, auto-deleted after 12 months.
// Flag rules here are deterministic; the AI decides when (and whether) to raise an active flag.
import { addDays, diffDays, range } from './dates.js';
import { dayProgress, limitStatus } from './nutrition.js';

export const NOTE_KINDS = ['medication', 'supplement', 'symptom', 'substance', 'eating_context', 'sleep_stress', 'health_context', 'preference_context'];
export const NOTE_TAGS = ['nsaid', 'acetaminophen', 'vitamin_a', 'headache', 'fatigue', 'dizziness', 'nausea', 'skipped_meal', 'low_intake', 'nonfood_craving', 'low_sleep', 'high_stress', 'nicotine', 'cannabis', 'other'];

/** Starting thresholds (spec §7.3). Tune here. */
export const FLAG_RULES = {
  nsaid: { days7: 4, days30: 10 },
  acetaminophen: { days7: 4, dailyMaxMg: 4000 },
  under_eating: { days7: 3 },
  headaches: { count14: 3 },
  high_caffeine: { days7: 3 },
  sleep_stress: { count14: 5 },
  iron_low_pct: 50,
  cooldownDays: 7,
  retentionDays: 365,
};

// Fallback classification when the model leaves `tag` empty.
const TAG_PATTERNS = [
  ['nsaid', /\b(ibuprofen|advil|motrin|naproxen|aleve|midol)\b/i],
  ['acetaminophen', /\b(acetaminophen|tylenol|paracetamol)\b/i],
  ['vitamin_a', /\b(vitamin a|retinol|retinyl|cod liver oil|hair.{0,10}skin.{0,10}nails)\b/i],
  ['headache', /\b(headache|migraine)\b/i],
  ['fatigue', /\b(tired|fatigue|exhausted|no energy)\b/i],
  ['dizziness', /\b(dizzy|dizziness|lightheaded|light-headed)\b/i],
  ['skipped_meal', /\bskip(ped)? (breakfast|lunch|dinner|a meal|meals)\b/i],
  ['nonfood_craving', /\b(craving|crave|eating|chewing)\b[^.]{0,20}\b(ice|dirt|clay|chalk|starch|paper)\b/i],
  ['low_sleep', /\b(sleep|slept)\b/i],
  ['high_stress', /\b(stress|overwhelm|anxious|anxiety)\b/i],
  ['nicotine', /\b(smok|vap|cigarette|nicotine|juul)/i],
];

export function classify(text) {
  return TAG_PATTERNS.find(([, re]) => re.test(text))?.[0] || 'other';
}

const uidLocal = () => Math.random().toString(36).slice(2, 10);

/** Normalize a remember_private() call into a stored PrivateNote. */
export function makeNote(entry, { today, messageId = null } = {}) {
  const occurred = /^\d{4}-\d{2}-\d{2}$/.test(entry.occurred_on || '') ? entry.occurred_on : today;
  const text = String(entry.text || '').slice(0, 300);
  return {
    id: uidLocal(),
    kind: NOTE_KINDS.includes(entry.kind) ? entry.kind : 'health_context',
    tag: NOTE_TAGS.includes(entry.tag) && entry.tag !== 'other' ? entry.tag : classify(`${entry.name || ''} ${text}`),
    name: entry.name ? String(entry.name).toLowerCase().slice(0, 60) : null,
    text,
    dose: Number.isFinite(entry.dose) ? entry.dose : null,
    unit: entry.unit || null,
    amount: Number.isFinite(entry.amount) ? entry.amount : null,
    occurred_on: occurred > today ? today : occurred,
    status: entry.status === 'closed' ? 'closed' : 'active',
    source_message_id: messageId,
    created_at: today,
    updated_at: today,
  };
}

/** Drop notes older than 12 months (spec §7.3). */
export function pruneNotes(notes, today) {
  return notes.filter((n) => diffDays(today, n.occurred_on) <= FLAG_RULES.retentionDays);
}

const within = (n, today, days) => n.occurred_on <= today && diffDays(today, n.occurred_on) < days;
const daysWith = (notes, pred) => new Set(notes.filter(pred).map((n) => n.occurred_on)).size;

/**
 * Compute every active flag for `today`. Each: { key, level, detail }.
 * `level` rises as a pattern gets worse, which lifts the cooldown.
 */
export function computeFlags(state, today, table) {
  const notes = state.privateNotes || [];
  const n7 = notes.filter((n) => within(n, today, 7));
  const n14 = notes.filter((n) => within(n, today, 14));
  const n30 = notes.filter((n) => within(n, today, 30));
  const flags = [];
  const R = FLAG_RULES;

  // Frequent NSAID use
  const nsaid7 = daysWith(n7, (n) => n.tag === 'nsaid');
  const nsaid30 = daysWith(n30, (n) => n.tag === 'nsaid');
  if (nsaid7 >= R.nsaid.days7 || nsaid30 >= R.nsaid.days30) {
    flags.push({ key: 'nsaid', level: nsaid7 >= 6 || nsaid30 >= 15 ? 2 : 1, detail: `Ibuprofen/naproxen-type pain reliever on ${nsaid7} of the last 7 days (${nsaid30} of the last 30).` });
  }

  // Acetaminophen: frequency, or any single day over the label max
  const acet7 = daysWith(n7, (n) => n.tag === 'acetaminophen');
  const acetByDay = {};
  for (const n of n7.filter((x) => x.tag === 'acetaminophen' && x.dose)) acetByDay[n.occurred_on] = (acetByDay[n.occurred_on] || 0) + n.dose;
  const overMax = Object.entries(acetByDay).find(([, mg]) => mg > R.acetaminophen.dailyMaxMg);
  if (acet7 >= R.acetaminophen.days7 || overMax) {
    flags.push({ key: 'acetaminophen', level: overMax ? 2 : 1, detail: overMax ? `About ${overMax[1]} mg acetaminophen on ${overMax[0]}, above the usual label maximum.` : `Acetaminophen on ${acet7} of the last 7 days.` });
  }

  // Vitamin A stacking
  const prenatalA = Number(state.profile.prenatal_vitamin?.vitamin_a_mcg) > 0;
  const extraA = notes.find((n) => n.kind === 'supplement' && n.status === 'active' && n.tag === 'vitamin_a');
  const retinolOver = range(addDays(today, -6), today).filter((d) => limitStatus(state, d, table).find((l) => l.key === 'retinol')?.level === 'over').length;
  if ((extraA && prenatalA) || retinolOver >= 2) {
    flags.push({ key: 'vitamin_a', level: extraA && retinolOver >= 2 ? 2 : 1, detail: extraA && prenatalA ? `Takes a supplement with vitamin A (${extraA.name || extraA.text}) on top of a prenatal that also has vitamin A.` : `Preformed vitamin A over the limit on ${retinolOver} of the last 7 days.` });
  }

  // Possible under-eating
  const under = daysWith(n7, (n) => n.tag === 'skipped_meal' || n.tag === 'low_intake');
  if (under >= R.under_eating.days7) flags.push({ key: 'under_eating', level: under >= 5 ? 2 : 1, detail: `Skipped meals or ate very little on ${under} of the last 7 days.` });

  // Possible low-iron picture
  const loggedDays = range(addDays(today, -7), addDays(today, -1)).filter((d) => state.foodLogs.some((f) => f.date === d));
  const ironLowDays = loggedDays.filter((d) => (dayProgress(state, d, table).find((p) => p.key === 'iron')?.pct ?? 100) < R.iron_low_pct).length;
  const tiredDizzy = n14.some((n) => n.tag === 'fatigue' || n.tag === 'dizziness');
  const craving = n30.find((n) => n.tag === 'nonfood_craving');
  const ironLowMost = loggedDays.length >= 3 && ironLowDays >= Math.ceil(loggedDays.length / 2);
  if (craving || (ironLowMost && tiredDizzy)) {
    flags.push({ key: 'low_iron', level: craving && ironLowMost ? 2 : 1, detail: craving ? `Mentioned cravings for non-food items (${craving.text}), which can be linked to low iron.` : `Iron under ${R.iron_low_pct}% on ${ironLowDays} of ${loggedDays.length} logged days, and has mentioned feeling tired or dizzy.` });
  }

  // Recurring headaches
  const headaches = n14.filter((n) => n.tag === 'headache').length;
  if (headaches >= R.headaches.count14) flags.push({ key: 'headaches', level: headaches >= 6 ? 2 : 1, detail: `${headaches} headaches mentioned in the last 14 days.` });

  // High caffeine trend
  const cafOver = range(addDays(today, -6), today).filter((d) => limitStatus(state, d, table).find((l) => l.key === 'caffeine')?.level === 'over').length;
  if (cafOver >= R.high_caffeine.days7) flags.push({ key: 'high_caffeine', level: cafOver >= 5 ? 2 : 1, detail: `Caffeine over 200 mg on ${cafOver} of the last 7 days.` });

  // Ongoing low sleep / high stress
  const ss = n14.filter((n) => n.tag === 'low_sleep' || n.tag === 'high_stress' || n.kind === 'sleep_stress').length;
  if (ss >= R.sleep_stress.count14) flags.push({ key: 'sleep_stress', level: ss >= 9 ? 2 : 1, detail: `${ss} mentions of poor sleep or high stress in the last 14 days.` });

  return flags;
}

/** Cooldown (spec §7.3 step 4): a raised flag is muted for 7 days unless its level goes up. */
export function isRaisable(flag, record, today) {
  if (!record?.last_raised) return true;
  if (flag.level > (record.level_at_raise || 0)) return true;
  return diffDays(today, record.last_raised) >= FLAG_RULES.cooldownDays;
}

export function recordRaised(flagState, key, level, today) {
  const prev = flagState[key] || { first_seen: today };
  return { ...flagState, [key]: { ...prev, last_raised: today, level_at_raise: level } };
}

/** Keep first_seen for every currently active flag. */
export function syncFlagState(flagState, flags, today) {
  const next = { ...flagState };
  for (const f of flags) if (!next[f.key]) next[f.key] = { first_seen: today };
  return next;
}

/** Compact digest for get_context() (spec §7.3 step 1). */
export function notebookDigest(state, today, table) {
  const notes = state.privateNotes || [];
  const active = notes.filter((n) => ['medication', 'supplement'].includes(n.kind) && n.status === 'active' && diffDays(today, n.occurred_on) < 30);
  const counts = {};
  for (const k of NOTE_KINDS) {
    const c7 = notes.filter((n) => n.kind === k && within(n, today, 7)).length;
    const c30 = notes.filter((n) => n.kind === k && within(n, today, 30)).length;
    if (c30) counts[k] = { last_7d: c7, last_30d: c30 };
  }
  const flags = computeFlags(state, today, table);
  const fs = state.flagState || {};
  return {
    medications_and_supplements_30d: summarizeMeds(active),
    counts,
    recent: notes.filter((n) => within(n, today, 7)).slice(-12).map((n) => `${n.occurred_on} [${n.kind}${n.tag !== 'other' ? `/${n.tag}` : ''}] ${n.text}${n.dose ? ` (${n.dose}${n.unit ? ` ${n.unit}` : ''})` : ''}`),
    context: notes.filter((n) => ['health_context', 'preference_context'].includes(n.kind) && n.status === 'active').slice(-10).map((n) => n.text),
    flags_to_consider: flags.filter((f) => isRaisable(f, fs[f.key], today)).map((f) => ({ key: f.key, level: f.level, detail: f.detail })),
    flags_muted: flags.filter((f) => !isRaisable(f, fs[f.key], today)).map((f) => f.key),
  };
}

/** Medication/supplement list grouped by name (used by the digest and the provider summary). */
export function summarizeMeds(notes) {
  const groups = {};
  for (const n of notes.filter((x) => ['medication', 'supplement'].includes(x.kind))) {
    const name = n.name || n.text.slice(0, 40).toLowerCase();
    const g = (groups[name] ||= { name, kind: n.kind, days: new Set(), doses: [], last: n.occurred_on, ongoing: false });
    g.days.add(n.occurred_on);
    if (n.dose) g.doses.push(`${n.dose}${n.unit ? ` ${n.unit}` : ''}`);
    if (n.occurred_on > g.last) g.last = n.occurred_on;
    if (n.status === 'active' && /daily|every day|started|taking/i.test(n.text)) g.ongoing = true;
  }
  return Object.values(groups).map((g) => ({
    name: g.name, kind: g.kind, days_logged: g.days.size, last: g.last,
    usual_dose: g.doses.length ? mode(g.doses) : null, ongoing: g.ongoing,
  }));
}

function mode(arr) {
  const c = {};
  for (const x of arr) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}

export function historyFor(state, { kind, start_date, end_date }) {
  return (state.privateNotes || [])
    .filter((n) => (!kind || kind === 'any' || n.kind === kind) && (!start_date || n.occurred_on >= start_date) && (!end_date || n.occurred_on <= end_date))
    .slice(-60)
    .map((n) => ({ id: n.id, date: n.occurred_on, kind: n.kind, tag: n.tag, name: n.name, text: n.text, dose: n.dose, unit: n.unit, status: n.status }));
}
