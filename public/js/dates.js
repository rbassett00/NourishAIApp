// Local-date helpers. Dates are stored as local 'YYYY-MM-DD' strings; arithmetic is done in UTC
// on those strings so DST never shifts a day.

const pad = (n) => String(n).padStart(2, '0');

export function localISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localTime(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const toUTC = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDays(iso, n) {
  const d = new Date(toUTC(iso) + n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function diffDays(a, b) {
  return Math.round((toUTC(a) - toUTC(b)) / 86400000);
}

export function range(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function fmt(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Date(toUTC(iso)).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

export const fmtShort = (iso) => fmt(iso, { month: 'short', day: 'numeric' });
export const weekday = (iso) => fmt(iso, { weekday: 'short' });

export function ageOn(birthISO, todayISO) {
  if (!birthISO) return null;
  const [by, bm, bd] = birthISO.split('-').map(Number);
  const [ty, tm, td] = todayISO.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export function monthsBetween(startISO, endISO) {
  return diffDays(endISO, startISO) / 30.44;
}

/** Monday of the week containing `iso`. */
export function weekStart(iso) {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}
