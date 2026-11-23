import { addDays, diffDays, fmt, fmtShort, localISO, localTime, range, weekday } from './dates.js';
import { FOODS, FOOD_BY_ID, FLAG_TEXT, registerFood, searchFoods } from './foods.js';
import { BAR_KEYS, DAY_STATUS, bmi, contributors, dayFoods, dayProgress, dayStatus, habitsFor, latestHabit, limitStatus, prenatalWarnings } from './nutrition.js';
import { completedThrough, dailySummary, patternNotes, weakestNutrient, weekSummaries } from './memory.js';
import { DEFAULT_PRENATAL, applyOnboarding, demoState, exportCSV, exportJSON, guessMeal, load, makeFoodLog, save, uid, validateOnboarding, wipe } from './store.js';
import { applyEntry, applyProfileChange, createToolHandlers, describeEntry, lookupWebFood } from './tools.js';
import { createChat } from './chat.js';
import { SAFETY_CARDS } from './safety.js';
import { foodTerms, isFavorite } from './matching.js';

const table = await fetch('data/nutrient_targets.json').then((r) => r.json());
const LABEL = Object.fromEntries(table.nutrients.map((n) => [n.key, n.label]));

let state = load();
state.customFoods.forEach(registerFood);
sanitizeConvo();

const ui = {
  tab: 'chat', foodView: 'day', foodDate: localISO(), calMonth: localISO().slice(0, 7),
  overlay: null, busy: false, recording: false, ai: null,
  ob: null, obErrors: {},
};
const pending = new Map(); // confirmation-card id -> resolver

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => localISO();
const num = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString();
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function commit(fn, opts = {}) {
  fn(state);
  save(state);
  if (!opts.silent) render();
}

// ---------- API ----------
async function api(path, body, raw) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Device-Id': state.deviceId, ...(raw ? { 'Content-Type': raw } : body ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ---------- Chat wiring ----------
function cardPromise(card) {
  return new Promise((resolve) => {
    const id = uid();
    pending.set(id, resolve);
    commit((s) => s.chat.push({ id, role: 'card', status: 'pending', ts: Date.now(), ...card }));
  });
}

const handlers = createToolHandlers({
  getState: () => state,
  api,
  commit,
  table,
  ui: {
    confirmLogs: (entries, meta) => cardPromise({ kind: 'logs', entries: entries.map((e) => ({ ...e })), message_id: meta?.messageId }),
    confirmProfile: (change) => cardPromise({ kind: 'profile', change }),
    confirmEdit: (desc, changes) => cardPromise({ kind: 'edit', desc, changes }),
    confirmDelete: (desc) => cardPromise({ kind: 'delete', desc }),
    showSafety: (kind) => commit((s) => s.chat.push({ id: uid(), role: 'safety', kind: SAFETY_CARDS[kind] ? kind : 'medical', ts: Date.now() })),
  },
});
const chat = createChat({ getState: () => state, commit, handlers, api, onBusy: (b) => { ui.busy = b; render(); } });

function sanitizeConvo() {
  // A reload can leave a tool call without its result (e.g. an unanswered confirmation card).
  const outputs = new Set(state.convo.filter((i) => i.type === 'function_call_output').map((i) => i.call_id));
  const orphan = state.convo.findIndex((i) => i.type === 'function_call' && !outputs.has(i.call_id));
  if (orphan >= 0) {
    const lastUser = state.convo.slice(0, orphan).map((m) => m.role).lastIndexOf('user');
    state.convo = state.convo.slice(0, Math.max(lastUser, 0));
  }
  for (const m of state.chat) if (m.role === 'card' && m.status === 'pending') m.status = 'expired';
}

// ---------- Render ----------
const ICONS = {
  food: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M11 2v7a3 3 0 0 1-2 2.83V22H7V11.83A3 3 0 0 1 5 9V2h1.5v6h1V2h1.5v6h1V2H11Zm4 0c2.2 0 4 2.24 4 5v6h-2v9h-2V2Z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.5 1.4 4.7 3.6 6.1L5 21l4-2.2c1 .2 2 .3 3 .3 5.5 0 10-3.6 10-8S17.5 3 12 3Z"/></svg>',
  cycle: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V9h14v11ZM7 11h5v5H7z"/></svg>',
};

function headerSub() {
  if (!state.onboarded) return '';
  const ds = dayStatus(state, today(), table);
  return ds.logged ? `<span>${ds.metCount} of ${ds.total} nutrients met today</span>` : '<span>Nothing logged yet today</span>';
}

function render() {
  $('#top').innerHTML = `
    <div><div class="hdr-date">${esc(fmt(today(), { weekday: 'short', month: 'short', day: 'numeric' }))}</div>
    <div class="hdr-sub">${headerSub()}</div></div>
    <button class="avatar" data-act="profile" aria-label="Profile">${esc((state.profile.name || '·')[0].toUpperCase())}</button>`;

  $('#tabs').innerHTML = [['food', 'Food'], ['chat', 'Chat'], ['calendar', 'Calendar']].map(([k, l]) =>
    k === 'chat'
      ? `<button class="tab center ${ui.tab === k ? 'active' : ''}" data-act="tab" data-tab="${k}"><span class="bubble">${ICONS[k]}</span>${l}</button>`
      : `<button class="tab ${ui.tab === k ? 'active' : ''}" data-act="tab" data-tab="${k}">${ICONS[k === 'calendar' ? 'cycle' : k]}${l}</button>`).join('');

  const main = $('#main');
  main.className = ui.tab === 'chat' ? 'chat-main' : '';
  main.innerHTML = { food: viewFood, chat: viewChat, calendar: viewCalendar }[ui.tab]();

  $('#composer').hidden = ui.tab !== 'chat';
  $('#send').disabled = ui.busy;
  $('#mic').classList.toggle('recording', ui.recording);
  const ql = $('#quicklog');
  ql.hidden = ui.tab === 'chat';
  ql.innerHTML = `${ICONS.chat.replace('<svg', '<svg width="18" height="18"')} ${ui.tab === 'food' ? 'Log food…' : 'Ask the assistant…'}`;

  if (!state.onboarded && ui.overlay?.type !== 'onboarding') ui.overlay = { type: 'onboarding' };
  $('#overlay').innerHTML = ui.overlay ? renderOverlay() : '';
  if (ui.tab === 'chat') requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
}

// ---------- Food ----------
const barClass = (pct) => (pct >= 100 ? 'met' : pct >= 50 ? 'mid' : '');

function seg(act, current, opts) {
  return `<div class="seg">${opts.map(([v, l]) => `<button class="${current === v ? 'on' : ''}" data-act="${act}" data-v="${v}">${l}</button>`).join('')}</div>`;
}

function viewFood() {
  const d = ui.foodDate;
  const isToday = d === today();
  const dateNav = `
      <div class="row" style="gap:4px">
        <button class="btn small ghost" data-act="food-date" data-step="-1" aria-label="Previous day">‹</button>
        <span class="date-label">${isToday ? 'Today' : esc(fmt(d))}</span>
        <button class="btn small ghost" data-act="food-date" data-step="1" ${isToday ? 'disabled' : ''} aria-label="Next day">›</button>
      </div>`;
  const nav = `<div class="row between" style="margin-bottom:12px">${seg('food-view', ui.foodView, [['day', 'Day'], ['week', 'Week']])}${dateNav}</div>`;
  if (ui.foodView === 'week') return nav + viewFoodWeek(d);

  const p = state.profile;
  const weightCard = !p.hide_weight && p.weight_kg && p.weight_updated_at && diffDays(today(), p.weight_updated_at) > 28 && state.dismissed.weight !== p.weight_updated_at
    ? `<div class="card info row between"><div class="grow"><b>Update your weight?</b><div class="muted">It's used only for your protein target. Optional.</div></div><button class="btn small" data-act="profile">Update</button><button class="x" data-act="dismiss-weight" aria-label="Dismiss">×</button></div>` : '';

  const habits = habitsFor(state, d).map((h) => `
    <button class="habit ${h.done ? 'done' : ''}" data-act="habit" data-key="${h.key}" ${h.auto ? 'data-auto="1"' : ''}>
      <span class="check">${h.done ? '✓' : ''}</span>
      <span class="grow">${esc(h.label)}${h.hint ? `<div class="tiny">${esc(h.hint)}</div>` : ''}${h.key === 'prenatal' && !state.profile.prenatal_vitamin ? '<div class="tiny">Add your prenatal in Profile so it counts toward your nutrients</div>' : ''}</span>
    </button>`).join('');

  const bars = dayProgress(state, d, table).map((b) => {
    const pct = Math.min(b.pct, 100);
    const val = b.key === 'water' ? `${Math.round(b.value / 0.25)} / ${Math.round(b.target / 0.25)} glasses` : `${num(b.value, b.value < 10 ? 1 : 0)} / ${num(b.target, b.target < 10 ? 1 : 0)} ${b.unit}`;
    return `<div class="row" style="gap:6px">
      <button class="bar-row grow" data-act="bar" data-key="${b.key}">
        <div class="bar-top"><b>${esc(b.label)}${b.weekly ? ' <span class="tiny">past 7 days</span>' : ''}</b><span class="muted">${val} ${b.pct >= 100 ? '<span class="met-check">✓</span>' : ''}</span></div>
        <div class="bar ${barClass(b.pct)}"><i style="width:${pct}%"></i></div>
      </button>
      ${b.key === 'water' ? '<button class="btn small" data-act="water" aria-label="Add a glass of water">+1</button>' : ''}
    </div>`;
  }).join('');

  const limits = limitStatus(state, d, table).map((l) => {
    const pct = Math.min((l.value / l.max) * 100, 100);
    return `<div style="padding:6px 0"><div class="bar-top"><b>${esc(l.label)}</b><span class="muted">${num(l.value)} / under ${num(l.max)} ${l.unit}</span></div>
      <div class="bar meter ${l.level}"><i style="width:${pct}%"></i></div>
      ${l.level === 'over' ? `<div class="tiny" style="color:var(--red)">Over the ${num(l.max)} ${l.unit} limit today.</div>` : ''}</div>`;
  }).join('');

  const foods = dayFoods(state, d);
  const meals = ['breakfast', 'lunch', 'dinner', 'snack'].map((m) => {
    const items = foods.filter((f) => f.meal === m);
    if (!items.length) return '';
    return `<div class="meal-h">${m}</div>${items.map((f) => `
      <div class="log">
        <div class="grow"><div>${esc(f.name)}</div>
          <div class="tiny">${esc(f.portion_label || `${num(f.qty, 2)} × ${f.unit}`)} · ${esc(f.time)} · <span class="src">${f.source === 'ai' ? '✨ AI' : '✎ manual'}</span>${f.estimated || FOOD_BY_ID[f.food_id]?.web ? ' · <span class="src">estimated</span>' : ''}${!f.food_id ? ' · <span class="src not-counted">not counted</span>' : ''}</div>
          ${(f.flags || []).filter((x) => FLAG_TEXT[x]).map((x) => `<div class="flag">⚠ ${esc(FLAG_TEXT[x])}</div>`).join('')}
        </div>
        <button class="btn small ghost" data-act="edit-food" data-id="${f.id}">Edit</button>
        <button class="x" data-act="del-food" data-id="${f.id}" aria-label="Delete">×</button>
      </div>`).join('')}`;
  }).join('');

  return `${nav}${weightCard}
    <div class="card">${habits}</div>
    <div class="card"><h3>Nutrients <span class="tiny">tap a bar for details</span></h3>${bars}</div>
    <div class="card"><h3>Stay under</h3>${limits}</div>
    <div class="card"><h3>Meals <button class="btn small primary" data-act="add-food">+ Add food</button></h3>
      ${meals || '<div class="empty">Nothing logged yet. Tell the assistant what you ate, or add it here.</div>'}</div>`;
}

function viewFoodWeek(end) {
  const days = range(addDays(end, -6), end);
  const sums = weekSummaries(state, end, table);
  const keys = BAR_KEYS.filter((k) => k !== 'dha');
  const rows = keys.map((k) => `<tr><td>${esc(LABEL[k])}</td>${sums.map((s) => {
    const p = s.nutrient_pct[k];
    const cls = !s.logged ? 'none' : p >= 100 ? 'met' : p >= 50 ? 'part' : '';
    return `<td><span class="dot ${cls}" title="${s.logged ? `${p}%` : 'Not logged'}"></span></td>`;
  }).join('')}</tr>`).join('');
  const pEnd = completedThrough(end, today());
  const weakest = weakestNutrient(state, pEnd, table, LABEL);
  const notes = patternNotes(state, pEnd, table);
  return `
    <div class="card"><h3>Last 7 days</h3>
      <table class="wk"><thead><tr><th></th>${days.map((d) => `<th>${esc(weekday(d)[0])}<div class="tiny">${d.slice(8)}</div></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      <div class="legend"><span style="--c:var(--accent)">Met</span><span style="--c:var(--accent-2)">50–99%</span><span style="--c:var(--neutral-fill)">Under 50%</span></div>
    </div>
    <div class="card soft"><h3>Patterns <span class="tiny">last 7 full days</span></h3>
      ${weakest ? `<p style="margin:0 0 6px">Lowest: <b>${esc(weakest.label)}</b>, averaging ${weakest.avg}% (met ${weakest.metDays} of ${weakest.days} logged days).</p>` : '<p class="muted" style="margin:0">Log at least 3 days to see patterns.</p>'}
      ${state.patternNote ? `<p style="margin:6px 0">${esc(state.patternNote.text)}</p>` : ''}
      ${notes.map((n) => `<div class="muted">• ${esc(n)}</div>`).join('')}
    </div>`;
}


// ---------- Chat ----------
function viewChat() {
  const welcome = `<div class="card welcome"><h2>Hi${state.profile.name ? ` ${esc(state.profile.name)}` : ''}!</h2>
    <p style="margin:0 0 8px">Tell me what you ate, today or on an earlier day, in your own words. I'll show you what I understood before saving anything.</p>
    <p class="tiny" style="margin:10px 0 0">Not medical advice. For anything urgent, call your provider or 911.</p></div>
    ${ui.ai === false ? '<div class="card amber muted">The AI assistant is offline (no API key on the server). Manual logging in every tab still works.</div>' : ''}`;

  const msgs = state.chat.map((m) => {
    if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
    if (m.role === 'assistant') return `<div class="msg assistant">${esc(m.text)}</div>`;
    if (m.role === 'error') return `<div class="msg error">${esc(m.text)}</div>`;
    if (m.role === 'safety') return safetyCard(m);
    if (m.role === 'card') return { logs: logsCard, profile: profileCard, edit: editCard, delete: deleteCard }[m.kind]?.(m) || '';
    return '';
  }).join('');
  return `${welcome}<div class="msgs">${msgs}${ui.busy ? '<div class="typing"><span>Thinking…</span></div>' : ''}</div>`;
}

function safetyCard(m) {
  const c = SAFETY_CARDS[m.kind] || SAFETY_CARDS.medical;
  return `<div class="card danger confirm" role="alert"><h3>⚠ ${esc(c.title)}</h3><p style="margin:0 0 10px">${esc(c.body)}</p>
    <div class="row wrap">${c.actions.map((a) => `<a class="btn ${a.primary ? 'primary' : ''}" style="text-decoration:none" href="${a.href}">${esc(a.label)}</a>`).join('')}</div></div>`;
}

function logsCard(m) {
  const editable = m.status === 'pending';
  const dis = editable ? '' : 'disabled';
  const rows = m.entries.map((e, i) => {
    const f = FOOD_BY_ID[e.food_id];
    const attr = (field) => `data-card="${m.id}" data-idx="${i}" data-field="${field}" ${dis}`;
    const date = `<input type="date" value="${esc(e.date)}" max="${today()}" ${attr('date')} aria-label="Date">`;
    let controls = date;
    if (e.kind === 'food') {
      controls = `<input type="number" step="0.25" min="0.25" value="${e.quantity ?? f?.defaultQty ?? 1}" ${attr('quantity')} aria-label="Quantity">
        <span class="tiny">× ${esc(f ? f.unit : 'serving')}</span>
        <select ${attr('meal')} aria-label="Meal">${['breakfast', 'lunch', 'dinner', 'snack'].map((x) => `<option ${e.meal === x ? 'selected' : ''}>${x}</option>`).join('')}</select>${date}`;
    }
    const notCounted = e.kind === 'food' && !f ? `<div class="flag warn-count">⚠ Couldn't find nutrition info. This won't count toward your nutrients. Remove it and add a similar food instead, or confirm to keep it as a note.</div>` : '';
    const notes = (f ? f.flags.filter((x) => FLAG_TEXT[x]).map((x) => `<div class="flag">⚠ ${esc(FLAG_TEXT[x])}</div>`).join('') : '') + (f?.web ? webNote(f) : '') + notCounted;
    const icon = { food: '🍽', habit: '✅' }[e.kind];
    return `<div class="entry"><div>${icon} <b>${esc(describeEntry(e))}</b>${e.portion_label ? ` <span class="chip">${esc(e.portion_label)}</span>` : ''}${notes}</div>
      ${editable ? `<button class="x" data-act="card-remove" data-card="${m.id}" data-idx="${i}" aria-label="Remove">×</button>` : '<span></span>'}
      <div class="controls">${controls}</div></div>`;
  }).join('');
  const footer = editable
    ? `<div class="row" style="margin-top:10px"><button class="btn ghost" data-act="card-answer" data-card="${m.id}" data-ok="0">Cancel</button><button class="btn primary grow" data-act="card-answer" data-card="${m.id}" data-ok="1">Confirm ${m.entries.length > 1 ? 'all' : ''}</button></div>`
    : `<div class="tiny" style="margin-top:6px">${{ confirmed: '✓ Saved', cancelled: 'Cancelled, nothing saved', expired: 'Not saved' }[m.status] || ''}</div>`;
  return `<div class="card confirm"><h3>Here's what I understood <span class="tiny">edit anything</span></h3>${rows || '<div class="muted">Nothing left to log.</div>'}${footer}</div>`;
}

function yesNo(m, yes, no = 'No') {
  return m.status === 'pending'
    ? `<div class="row" style="margin-top:10px"><button class="btn ghost" data-act="card-answer" data-card="${m.id}" data-ok="0">${no}</button><button class="btn primary grow" data-act="card-answer" data-card="${m.id}" data-ok="1">${yes}</button></div>`
    : `<div class="tiny" style="margin-top:6px">${m.status === 'confirmed' ? '✓ Done' : 'No change made'}</div>`;
}

function profileCard(m) {
  const { field, action, value } = m.change;
  const label = { disliked_foods: 'foods you don\'t like', favorite_foods: 'favorite foods', allergies: 'allergies', diet_pattern: 'diet', weight_kg: 'weight (kg)' }[field];
  const text = action === 'remove' ? `Remove “${esc(value)}” from ${label}?` : action === 'add' ? `Add “${esc(value)}” to ${label}?` : `Set ${label} to “${esc(value)}”?`;
  return `<div class="card confirm"><h3>Update your profile</h3><p style="margin:0">${text}</p>${yesNo(m, 'Yes, save')}</div>`;
}

function editCard(m) {
  const changes = Object.entries(m.changes).map(([k, v]) => `${k.replace('_', ' ')} → <b>${esc(v)}</b>`).join(', ');
  return `<div class="card confirm"><h3>Update this entry?</h3><p style="margin:0">${esc(m.desc)}</p><p class="muted" style="margin:6px 0 0">${changes}</p>${yesNo(m, 'Yes, update')}</div>`;
}

function deleteCard(m) {
  return `<div class="card confirm"><h3>Delete this entry?</h3><p style="margin:0">${esc(m.desc)}</p>${yesNo(m, 'Delete', 'Keep it')}</div>`;
}

// ---------- Calendar ----------
const STATUS_TEXT = { green: 'Goals met', yellow: 'Partly met', gray: 'Logged' };

function viewCalendar() {
  const d = today();
  const [y, m] = ui.calMonth.split('-').map(Number);
  const first = `${ui.calMonth}-01`;
  const startDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const gridStart = addDays(first, -startDow);
  const counts = { green: 0, yellow: 0, gray: 0 };
  const cells = range(gridStart, addDays(gridStart, 41)).map((day) => {
    const inMonth = day.slice(0, 7) === ui.calMonth;
    const ds = day <= d ? dayStatus(state, day, table) : { level: null };
    if (inMonth && ds.level) counts[ds.level]++;
    const cls = ['day', !inMonth && 'out', day === d && 'today', day > d && 'future', ds.level && `st-${ds.level}`].filter(Boolean).join(' ');
    const mark = ds.level === 'green' ? '<span class="mark">✓</span>' : ds.level ? '<span class="mark"></span>' : '';
    const label = ds.level ? `: ${STATUS_TEXT[ds.level]}, ${ds.metCount} of ${ds.total} nutrients` : '';
    return `<button class="${cls}" data-act="day" data-date="${day}" aria-label="${esc(fmt(day))}${label}">${Number(day.slice(8))}${mark}</button>`;
  }).join('');
  const monthName = new Date(`${ui.calMonth}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `<div class="card">
      <div class="row between" style="margin-bottom:8px"><button class="btn small ghost" data-act="cal" data-step="-1" aria-label="Previous month">‹</button><b>${esc(monthName)}</b><button class="btn small ghost" data-act="cal" data-step="1" ${ui.calMonth >= d.slice(0, 7) ? 'disabled' : ''} aria-label="Next month">›</button></div>
      <div class="cal">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<div class="dow">${x}</div>`).join('')}${cells}</div>
      <div class="legend status-legend">
        <span><i class="lg green">✓</i>${DAY_STATUS.green}+ of 10 nutrients</span>
        <span><i class="lg yellow"></i>${DAY_STATUS.yellow}–${DAY_STATUS.green - 1}</span>
        <span><i class="lg gray"></i>fewer than ${DAY_STATUS.yellow}</span>
      </div>
      <div class="tiny" style="margin-top:6px">A nutrient counts as met at ${DAY_STATUS.metPct}% of its target. DHA is left out because it's counted over 7 days. Tap a day to see or edit what you ate.</div>
    </div>
    <div class="card row between"><span><b>${counts.green}</b> <span class="muted">goals-met days</span></span><span><b>${counts.yellow}</b> <span class="muted">partly met</span></span><span><b>${counts.gray}</b> <span class="muted">logged</span></span></div>`;
}

/** Day sheet: status, prenatal, and every food logged that day, editable in place. */
function sheetDay() {
  const d = ui.overlay.date;
  const title = fmt(d, { weekday: 'long', month: 'long', day: 'numeric' });
  if (d > today()) return `${sheetHead(title)}<p class="muted">You can log this day once it arrives.</p>`;
  const ds = dayStatus(state, d, table);
  const prenatal = habitsFor(state, d)[0];
  const foods = dayFoods(state, d);
  const status = ds.logged
    ? `<div class="day-status st-${ds.level}"><b>${STATUS_TEXT[ds.level]}</b> · ${ds.metCount} of ${ds.total} nutrients at ${DAY_STATUS.metPct}%+</div>
       <div class="chips" style="margin:8px 0 12px">${[...ds.met.map((k) => `<span class="chip on">✓ ${esc(LABEL[k])}</span>`), ...ds.unmet.map((k) => `<span class="chip">${esc(LABEL[k])}</span>`)].join('')}</div>`
    : '<p class="muted">Nothing logged for this day.</p>';
  const list = ['breakfast', 'lunch', 'dinner', 'snack'].map((meal) => {
    const items = foods.filter((f) => f.meal === meal);
    if (!items.length) return '';
    return `<div class="meal-h">${meal}</div>${items.map((f) => `
      <div class="log"><div class="grow"><div>${esc(f.name)}</div>
        <div class="tiny">${esc(f.portion_label || `${num(f.qty, 2)} × ${f.unit}`)}${f.estimated || FOOD_BY_ID[f.food_id]?.web ? ' · estimated' : ''}${!f.food_id ? ' · <span class="src not-counted">not counted</span>' : ''}</div></div>
        <button class="btn small ghost" data-act="edit-food" data-id="${f.id}">Edit</button>
        <button class="x" data-act="del-food" data-id="${f.id}" aria-label="Delete ${esc(f.name)}">×</button></div>`).join('')}`;
  }).join('');
  return `${sheetHead(title)}
    ${status}
    <button class="habit ${prenatal.done ? 'done' : ''}" data-act="habit" data-key="prenatal" data-date="${d}"><span class="check">${prenatal.done ? '✓' : ''}</span><span class="grow">${esc(prenatal.label)}</span></button>
    <div style="margin-top:8px">${list || ''}</div>
    <div class="row" style="margin-top:12px"><button class="btn grow" data-act="day-food-tab" data-date="${d}">Open full day</button><button class="btn primary grow" data-act="add-food" data-date="${d}">+ Add food</button></div>`;
}

// ---------- Overlays ----------
function openSheet(o) { ui.overlay = o; render(); }
function closeOverlay() {
  const o = ui.overlay;
  ui.overlay = null;
  if (o?.type === 'modal') o.resolve?.(null);
  render();
}

function modal({ title, body, buttons }) {
  return new Promise((resolve) => openSheet({ type: 'modal', title, body, buttons, resolve }));
}

function renderOverlay() {
  const o = ui.overlay;
  if (o.type === 'modal') {
    return `<div class="scrim modal-wrap" data-act="scrim"><div class="modal" role="dialog" aria-modal="true"><h2>${esc(o.title)}</h2><div class="muted">${esc(o.body)}</div>
      <div class="actions">${o.buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : b.danger ? 'danger' : ''}" data-act="modal-btn" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div></div>`;
  }
  const body = { add: sheetAddFood, bar: sheetBar, edit: sheetEditFood, day: sheetDay, profile: sheetProfile, onboarding: sheetOnboarding }[o.type]();
  const full = ['profile', 'onboarding'].includes(o.type);
  return `<div class="scrim" data-act="scrim"><div class="sheet ${full ? 'full' : ''}" role="dialog" aria-modal="true">${full ? '' : '<div class="grab"></div>'}${body}</div></div>`;
}

const sheetHead = (title, closable = true) => `<div class="sheet-h"><h2 class="serif">${esc(title)}</h2>${closable ? '<button class="x" data-act="close" aria-label="Close">×</button>' : ''}</div>`;

function foodRow(f) {
  return `<button class="result" data-act="pick-food" data-id="${f.id}"><span class="grow"><b>${esc(f.name)}</b><div class="tiny">${esc(f.unit)}${f.flags.filter((x) => FLAG_TEXT[x]).length ? ' · ⚠ note' : ''}</div></span></button>`;
}

function sheetAddFood() {
  const o = ui.overlay;
  if (o.selected) {
    const f = FOOD_BY_ID[o.selected];
    return `${sheetHead('Add food')}
      <div class="card"><b>${esc(f.name)}</b><div class="tiny">per ${esc(f.unit)}</div>${f.web ? webNote(f) : ''}
        ${f.flags.filter((x) => FLAG_TEXT[x]).map((x) => `<div class="flag" style="margin-top:6px">⚠ ${esc(FLAG_TEXT[x])}</div>`).join('')}
        <div class="row" style="margin:12px 0"><div class="stepper"><button data-act="qty" data-step="-0.5">−</button><input id="add-qty" type="number" step="0.25" min="0.25" value="${o.qty}"><button data-act="qty" data-step="0.5">+</button></div><span class="muted">× ${esc(f.unit)}</span></div>
        <div class="chips">${['breakfast', 'lunch', 'dinner', 'snack'].map((m) => `<button class="chip ${o.meal === m ? 'on' : ''}" data-act="add-meal" data-v="${m}">${m}</button>`).join('')}</div>
      </div>
      <div class="row"><button class="btn ghost" data-act="add-back">Back</button><button class="btn primary grow" data-act="add-confirm">Add to ${esc((o.date || ui.foodDate) === today() ? 'today' : fmt(o.date || ui.foodDate))}</button></div>`;
  }
  const recents = [...new Set([...state.foodLogs].reverse().map((f) => f.food_id).filter(Boolean))].slice(0, 6).map((id) => FOOD_BY_ID[id]).filter(Boolean);
  const favs = FOODS.filter((f) => isFavorite(foodTerms(f), state.profile.favorite_foods)).slice(0, 6);
  return `${sheetHead('Add food')}
    <input id="food-search" type="search" placeholder="Search foods (e.g. lentils, latte)" value="${esc(o.q || '')}" autocomplete="off">
    <div id="food-results">${foodResults(o.q || '')}</div>
    ${!o.q && favs.length ? `<div class="section-title">Favorites</div>${favs.map(foodRow).join('')}` : ''}
    ${!o.q && recents.length ? `<div class="section-title">Recent</div>${recents.map(foodRow).join('')}` : ''}`;
}

function foodResults(q) {
  if (!q.trim()) return '';
  const res = searchFoods(q, 10);
  const web = q.trim().length >= 3 ? `<button class="btn block" style="margin-top:10px" data-act="web-search">🌐 Not listed? Look up “${esc(q.trim())}” on the web</button>` : '';
  return (res.length ? res.map(foodRow).join('') : '<div class="empty">No match in the food database.</div>') + web;
}

function webNote(f) {
  const src = f.web.sources[0];
  let host = '';
  try { host = src ? new URL(src.url).hostname.replace(/^www\./, '') : ''; } catch { /* bad url */ }
  return `<div class="tiny" style="margin-top:4px">🌐 From a web lookup${f.web.estimated ? ', some values estimated' : ''}${host ? ` · <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(host)}</a>` : ''}</div>`;
}

function sheetEditFood() {
  const f = state.foodLogs.find((x) => x.id === ui.overlay.id);
  if (!f) return sheetHead('Edit');
  return `${sheetHead('Edit entry')}
    <div class="card"><b>${esc(f.name)}</b><div class="tiny">${f.source === 'ai' ? 'Logged by the assistant' : 'Logged by hand'}</div>
      ${f.food_id ? `<div class="row" style="margin:12px 0"><div class="stepper"><button data-act="qty" data-step="-0.5">−</button><input id="add-qty" type="number" step="0.25" min="0.25" value="${f.qty}"><button data-act="qty" data-step="0.5">+</button></div><span class="muted">× ${esc(f.unit)}</span></div>` : '<p class="muted">Not in the food database, so nutrients aren\'t counted.</p>'}
      <div class="chips">${['breakfast', 'lunch', 'dinner', 'snack'].map((m) => `<button class="chip ${(ui.overlay.meal || f.meal) === m ? 'on' : ''}" data-act="add-meal" data-v="${m}">${m}</button>`).join('')}</div></div>
    <div class="row"><button class="btn danger" data-act="del-food" data-id="${f.id}">Delete</button><button class="btn primary grow" data-act="edit-save">Save</button></div>`;
}


function sheetBar() {
  const key = ui.overlay.key;
  const d = ui.foodDate;
  const b = dayProgress(state, d, table).find((x) => x.key === key);
  const meta = table.nutrients.find((n) => n.key === key);
  const list = contributors(state, d, key);
  const ask = b.pct < 100 && d === today()
    ? `<button class="btn block" data-act="ask-ideas" data-key="${key}">✨ Ask for ideas</button><div class="tiny" style="text-align:center;margin-top:4px">Opens Chat with “How can I get more ${esc(b.label.toLowerCase())} today?”</div>` : '';
  return `${sheetHead(b.label)}
    <div class="card"><div class="bar-top"><b>${num(b.value, 1)} / ${num(b.target, 1)} ${b.unit}${b.weekly ? ' over 7 days' : ''}</b><span>${b.pct}%</span></div><div class="bar ${barClass(b.pct)}"><i style="width:${Math.min(b.pct, 100)}%"></i></div>
      ${meta.note ? `<div class="tiny" style="margin-top:6px">${esc(meta.note)}</div>` : ''}</div>
    <div class="section-title">${b.weekly ? 'Today\'s contributions' : 'Where it came from'}</div>
    <div class="card">${list.length ? list.map((c) => `<div class="log"><span class="grow">${esc(c.name)} <span class="tiny">${esc(c.label)}</span></span><b>${num(c.amount, c.amount < 10 ? 1 : 0)} ${b.unit}</b></div>`).join('') : '<div class="empty">Nothing yet.</div>'}</div>
    ${ask}`;
}




// Onboarding (spec §2: required fields block "Get started")
function obField(name, label, input) {
  const err = ui.obErrors[name];
  return `<label class="field ${err ? 'has-err' : ''}"><span>${label}</span>${input}${err ? `<div class="err">${esc(err)}</div>` : ''}</label>`;
}

function sheetOnboarding() {
  const f = ui.ob ||= { name: '', birth_date: '', diet_pattern: '', allergies: '', disliked_foods: '', favorite_foods: '', weight_lb: '' };
  return `${sheetHead('Welcome to Nourish', false)}
    <div class="card soft"><p style="margin:0">A companion for the months before you start trying to conceive: eat well, take your prenatal, and see which nutrients you're getting enough of.</p></div>
    <div class="card"><h3>About you <span class="tiny">required</span></h3>
      ${obField('name', 'Name', `<input type="text" data-ob="name" value="${esc(f.name)}" autocomplete="given-name">`)}
      ${obField('birth_date', 'Birth date', `<input type="date" data-ob="birth_date" value="${esc(f.birth_date)}" max="${today()}">`)}
      ${obField('diet_pattern', 'Diet', `<select data-ob="diet_pattern"><option value="">Choose…</option>${['omnivore', 'pescatarian', 'vegetarian', 'vegan'].map((x) => `<option ${f.diet_pattern === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
    </div>
    <div class="card"><h3>Food preferences <span class="tiny">optional</span></h3>
      ${obField('allergies', 'Allergies', `<input type="text" data-ob="allergies" value="${esc(f.allergies)}" placeholder="e.g. shellfish, peanut">`)}
      ${obField('disliked_foods', 'Foods you don\'t like', `<input type="text" data-ob="disliked_foods" value="${esc(f.disliked_foods)}" placeholder="e.g. mushrooms, cilantro">`)}
      ${obField('favorite_foods', 'Favorite foods', `<input type="text" data-ob="favorite_foods" value="${esc(f.favorite_foods)}" placeholder="e.g. salmon, berries">`)}
    </div>
    <div class="card"><h3>Weight <span class="tiny">optional</span></h3>
      ${obField('weight_lb', 'Weight in pounds', `<input type="number" inputmode="decimal" data-ob="weight_lb" value="${esc(f.weight_lb)}">`)}
      <div class="tiny">Weight sets your protein target. If you leave it blank, the app uses 46 g a day.</div>
    </div>
    <p class="notice">Not medical advice. Your data stays on this device. Chat messages are sent to OpenAI to generate replies, without your name or birth date.</p>
    ${Object.keys(ui.obErrors).length ? '<div class="err" style="text-align:center;margin-bottom:8px">Please fill in the highlighted fields.</div>' : ''}
    <button class="btn primary block" data-act="ob-done">Get started</button>`;
}

function profileFields(p) {
  const imp = p.units === 'imperial';
  const h = p.height_cm ? (imp ? Math.round(p.height_cm / 2.54) : p.height_cm) : '';
  const w = p.weight_kg ? (imp ? Math.round(p.weight_kg * 2.2046) : p.weight_kg) : '';
  const pv = p.prenatal_vitamin;
  return `
    <div class="card"><h3>About you</h3>
      <label class="field"><span>Name</span><input type="text" data-pf="name" value="${esc(p.name)}"></label>
      <label class="field"><span>Birth date</span><input type="date" data-pf="birth_date" value="${esc(p.birth_date)}"></label>
      <label class="field"><span>Units</span><select data-pf="units"><option value="imperial" ${imp ? 'selected' : ''}>Inches and pounds</option><option value="metric" ${!imp ? 'selected' : ''}>Centimeters and kilograms</option></select></label>
      ${p.hide_weight ? '' : `<div class="grid2"><label class="field"><span>Height in ${imp ? 'inches' : 'cm'}</span><input type="number" data-pf="height" value="${h}"></label><label class="field"><span>Weight in ${imp ? 'pounds' : 'kg'}</span><input type="number" data-pf="weight" value="${w}"></label></div>
      <div class="tiny" style="margin-top:-4px;margin-bottom:8px">Weight sets your protein target. Height is only used for BMI, which you can view below.</div>`}
      <div class="toggle"><span>Hide weight & BMI everywhere</span><input type="checkbox" data-pf="hide_weight" ${p.hide_weight ? 'checked' : ''}></div>
    </div>
    <div class="card"><h3>Food</h3>
      <label class="field"><span>Diet</span><select data-pf="diet_pattern">${['omnivore', 'pescatarian', 'vegetarian', 'vegan'].map((d) => `<option ${p.diet_pattern === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label class="field"><span>Allergies</span><input type="text" data-pf="allergies" value="${esc(p.allergies.join(', '))}"></label>
      <label class="field"><span>Foods you don't like</span><input type="text" data-pf="disliked_foods" value="${esc(p.disliked_foods.join(', '))}"></label>
      <label class="field"><span>Favorite foods</span><input type="text" data-pf="favorite_foods" value="${esc(p.favorite_foods.join(', '))}"></label>
    </div>
    <div class="card"><h3>Prenatal vitamin</h3>
      ${pv ? `<label class="field"><span>Name</span><input type="text" data-pv="name" value="${esc(pv.name)}"></label>
      <div class="grid2">${[['folic_acid_mcg', 'Folic acid, mcg'], ['iodine_mcg', 'Iodine, mcg'], ['choline_mg', 'Choline, mg'], ['dha_mg', 'DHA, mg'], ['vitamin_a_mcg', 'Vitamin A, mcg'], ['iron_mg', 'Iron, mg'], ['vitamin_d_iu', 'Vitamin D, IU'], ['b12_mcg', 'B12, mcg']].map(([k, l]) => `<label class="field"><span>${l}</span><input type="number" data-pv="${k}" value="${pv[k] ?? 0}"></label>`).join('')}</div>
      ${prenatalWarnings(p).map((x) => `<div class="tiny" style="color:var(--amber)">⚠ ${esc(x)}</div>`).join('')}`
    : '<p class="muted" style="margin:0 0 10px">No prenatal set up yet. Add yours so checking it off counts toward your totals.</p><button class="btn small" data-act="add-prenatal">Add my prenatal</button>'}
    </div>`;
}

function sheetProfile() {
  const p = state.profile;
  const b = bmi(p);
  return `${sheetHead('Profile')}
    ${profileFields(p)}
    ${!p.hide_weight && b ? `<div class="card"><details><summary>Show BMI</summary><p class="muted" style="margin:6px 0 0">BMI ${b}. Used only for gentle context if you ask the assistant. It isn't a score.</p></details></div>` : ''}
    <div class="card"><h3>Privacy</h3><p class="muted" style="margin:0">Your food logs and the assistant's memory are stored on this device. For chat, a minimal context (age as a number, no name or birth date) is sent to <b>OpenAI</b>, our AI provider, through our server, which stores nothing. No ads, no data selling, no third-party analytics.</p>
      <p class="muted" style="margin:8px 0 0">The assistant keeps private notes about health details you mention (like medications or symptoms) to help it notice patterns over time. They're included when you export your data and erased when you delete everything.</p>
      <p class="tiny" style="margin:8px 0 0"><b>Not medical advice.</b> Always check with your provider about medications, supplements and symptoms.</p></div>
    <div class="card"><h3>Your data</h3><div class="row wrap"><button class="btn small" data-act="export" data-v="json">Export JSON</button><button class="btn small" data-act="export" data-v="csv">Export CSV</button><button class="btn small" data-act="demo">Load demo data</button><button class="btn small danger" data-act="wipe">Delete everything</button></div></div>`;
}




// ---------- Actions ----------
async function askYesterday(date) {
  // Logs between 00:00 and 03:00 ask whether they belong to yesterday (spec §6.1).
  if (date !== today() || Number(localTime().slice(0, 2)) >= 3) return date;
  const r = await modal({ title: 'Count this for yesterday?', body: 'It\'s just after midnight. Should this count toward yesterday?', buttons: [{ label: 'Today', value: 'today' }, { label: 'Yesterday', primary: true, value: 'yesterday' }] });
  return r === 'yesterday' ? addDays(date, -1) : date;
}

async function logFood(food_id, qty, meal, date = ui.foodDate) {
  const when = await askYesterday(date);
  commit((s) => s.foodLogs.push(makeFoodLog({ date: when, time: localTime(), meal: meal || guessMeal(), food_id, qty, source: 'manual' })));
  toast(`Added ${FOOD_BY_ID[food_id].name}`);
}

/** Flow and cramps: one value per day; tapping the selected value again clears it. */

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

function saveProfileField(el) {
  const p = state.profile;
  const key = el.dataset.pf;
  const v = el.type === 'checkbox' ? el.checked : el.value;
  const np = { ...p };
  if (['allergies', 'disliked_foods', 'favorite_foods'].includes(key)) np[key] = String(v).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  else if (key === 'height') np.height_cm = v ? (p.units === 'imperial' ? Math.round(Number(v) * 2.54) : Number(v)) : null;
  else if (key === 'weight') { np.weight_kg = v ? (p.units === 'imperial' ? Math.round((Number(v) / 2.2046) * 10) / 10 : Number(v)) : null; np.weight_updated_at = today(); }
  else np[key] = v;
  state.profile = np;
  save(state);
}

const actions = {
  tab: (el) => { ui.tab = el.dataset.tab; ui.overlay = null; render(); window.scrollTo(0, 0); },
  profile: () => openSheet({ type: 'profile' }),
  close: closeOverlay,
  scrim: (el, ev) => { if (ev.target === el && ui.overlay?.type !== 'onboarding') closeOverlay(); },
  'modal-btn': (el) => {
    const o = ui.overlay;
    const b = o.buttons[Number(el.dataset.i)];
    ui.overlay = null;
    render();
    o.resolve?.(b.value ?? b.label);
  },

  'food-view': (el) => { ui.foodView = el.dataset.v; render(); },
  'food-date': (el) => { const n = addDays(ui.foodDate, Number(el.dataset.step)); if (n <= today()) { ui.foodDate = n; render(); } },
  'dismiss-weight': () => commit((s) => { s.dismissed.weight = s.profile.weight_updated_at; }),
  habit: (el) => {
    const key = el.dataset.key;
    const date = el.dataset.date || ui.foodDate;
    const done = !latestHabit(state, date, key)?.done;
    commit((s) => s.habitLogs.push({ id: uid(), date, habit_key: key, done, source: 'manual' }));
  },
  water: () => logFood('water', 1, null),
  bar: (el) => openSheet({ type: 'bar', key: el.dataset.key }),
  'ask-ideas': (el) => {
    const label = LABEL[el.dataset.key].toLowerCase();
    ui.overlay = null;
    ui.tab = 'chat';
    render();
    const input = $('#chat-input');
    input.value = `How can I get more ${label} today?`;
    input.focus();
  },
  'add-food': (el) => openSheet({ type: 'add', q: '', qty: 1, meal: guessMeal(), date: el.dataset.date || null, back: el.dataset.date ? { type: 'day', date: el.dataset.date } : null }),
  'web-search': async () => {
    const o = ui.overlay;
    const q = (o.q || '').trim();
    $('#food-results').innerHTML = '<div class="empty">Searching the web for nutrition facts…</div>';
    try {
      const food = await lookupWebFood({ getState: () => state, commit, api }, q);
      if (!food) { $('#food-results').innerHTML = '<div class="empty">Couldn\'t find nutrition facts for that. Try a more specific name.</div>'; return; }
      if (ui.overlay === o) Object.assign(o, { selected: food.id, qty: 1 });
      render();
    } catch (err) {
      toast(`Web lookup failed: ${err.message}`);
      render();
    }
  },
  'pick-food': (el) => { const f = FOOD_BY_ID[el.dataset.id]; Object.assign(ui.overlay, { selected: f.id, qty: f.defaultQty }); render(); },
  'add-back': () => { ui.overlay.selected = null; render(); },
  qty: (el) => { const input = $('#add-qty'); input.value = Math.max(0.25, Number(input.value) + Number(el.dataset.step)); },
  'add-meal': (el) => { ui.overlay.meal = el.dataset.v; render(); },
  'add-confirm': () => {
    const o = ui.overlay;
    const qty = Number($('#add-qty').value) || 1;
    ui.overlay = o.back || null;
    logFood(o.selected, qty, o.meal, o.date || ui.foodDate);
  },
  'edit-food': (el) => openSheet({ type: 'edit', id: el.dataset.id, back: ui.overlay?.type === 'day' ? ui.overlay : null }),
  'edit-save': () => {
    const o = ui.overlay;
    const qtyEl = $('#add-qty');
    commit((s) => {
      const f = s.foodLogs.find((x) => x.id === o.id);
      if (!f) return;
      if (o.meal) f.meal = o.meal;
      if (qtyEl && f.food_id) {
        const updated = makeFoodLog({ ...f, food_id: f.food_id, qty: Number(qtyEl.value) || f.qty });
        Object.assign(f, { qty: updated.qty, nutrients: updated.nutrients, portion_label: null });
      }
      ui.overlay = o.back || null;
    });
  },
  'del-food': (el) => commit((s) => { s.foodLogs = s.foodLogs.filter((f) => f.id !== el.dataset.id); if (ui.overlay?.type === 'edit') ui.overlay = ui.overlay.back || null; }),

  'card-remove': (el) => commit((s) => { s.chat.find((m) => m.id === el.dataset.card).entries.splice(Number(el.dataset.idx), 1); }),
  'card-answer': (el) => {
    const id = el.dataset.card;
    const ok = el.dataset.ok === '1';
    const m = state.chat.find((x) => x.id === id);
    commit((s) => { s.chat.find((x) => x.id === id).status = ok ? 'confirmed' : 'cancelled'; });
    const resolve = pending.get(id);
    pending.delete(id);
    if (m.kind === 'logs') resolve?.(ok && m.entries.length ? m.entries : null);
    else resolve?.(ok);
  },

  day: (el) => openSheet({ type: 'day', date: el.dataset.date }),
  'day-food-tab': (el) => { ui.overlay = null; ui.tab = 'food'; ui.foodView = 'day'; ui.foodDate = el.dataset.date; render(); window.scrollTo(0, 0); },
  cal: (el) => {
    const [y, m] = ui.calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.step), 1);
    ui.calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    render();
  },
  'add-prenatal': () => commit((s) => { s.profile = { ...s.profile, prenatal_vitamin: { ...DEFAULT_PRENATAL } }; }),
  export: (el) => {
    const csv = el.dataset.v === 'csv';
    const blob = new Blob([csv ? exportCSV(state) : exportJSON(state)], { type: csv ? 'text/csv' : 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nourish-export-${today()}.${csv ? 'csv' : 'json'}`;
    a.click();
  },
  demo: async () => {
    if (state.onboarded) {
      const r = await modal({ title: 'Load demo data?', body: 'This replaces everything on this device with sample data.', buttons: [{ label: 'Cancel' }, { label: 'Load demo', primary: true, value: 'yes' }] });
      if (r !== 'yes') return;
    }
    state = demoState();
    save(state);
    ui.overlay = null;
    ui.tab = 'food';
    ui.foodDate = today();
    render();
    runMemoryJobs();
  },
  wipe: async () => {
    const r = await modal({ title: 'Delete everything?', body: 'All food logs, chat, and the assistant\'s notes on this device will be permanently deleted. This can\'t be undone.', buttons: [{ label: 'Cancel' }, { label: 'Delete everything', danger: true, value: 'yes' }] });
    if (r !== 'yes') return;
    wipe();
    state = load();
    ui.overlay = null;
    ui.ob = null;
    ui.obErrors = {};
    render();
  },
  'ob-done': () => {
    const f = ui.ob;
    ui.obErrors = validateOnboarding(f, today());
    if (Object.keys(ui.obErrors).length) return render();
    commit((s) => { applyOnboarding(s, f, today()); ui.overlay = null; ui.ob = null; });
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, ev);
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.ob) {
    const k = el.dataset.ob;
    ui.ob[k] = el.value;
    const errKey = k;
    if (ui.obErrors[errKey]) {
      // Clear this field's error in place (a full re-render would drop focus from the next field).
      delete ui.obErrors[errKey];
      const field = el.closest('.field');
      field?.classList.remove('has-err');
      field?.querySelector('.err')?.remove();
    }
  } else if (el.dataset.pf) {
    saveProfileField(el);
    if (['units', 'hide_weight'].includes(el.dataset.pf)) render();
    else $('#top').querySelector('.avatar').textContent = (state.profile.name || '·')[0].toUpperCase();
  } else if (el.dataset.pv) {
    const pv = { ...(state.profile.prenatal_vitamin || DEFAULT_PRENATAL) };
    pv[el.dataset.pv] = el.dataset.pv === 'name' ? el.value : Number(el.value) || 0;
    state.profile = { ...state.profile, prenatal_vitamin: pv };
    save(state);
  } else if (el.dataset.card) {
    const m = state.chat.find((x) => x.id === el.dataset.card);
    const e = m?.entries[Number(el.dataset.idx)];
    if (!e) return;
    const f = el.dataset.field;
    e[f] = f === 'quantity' ? Number(el.value) : el.value;
    if (f === 'quantity') e.portion_label = null;
    save(state);
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'food-search') {
    ui.overlay.q = ev.target.value;
    $('#food-results').innerHTML = foodResults(ev.target.value);
  } else if (ev.target.dataset.ob && ev.target.type === 'text') {
    ui.ob[ev.target.dataset.ob] = ev.target.value;
  }
});

$('#quicklog').addEventListener('click', () => {
  const from = ui.tab;
  ui.tab = 'chat';
  render();
  const input = $('#chat-input');
  input.placeholder = from === 'food' ? 'What did you eat?' : 'Tell me what you ate, or ask a question…';
  input.focus();
});

function sendMessage(text) {
  if (!text.trim() || ui.busy) return;
  chat.send(text.trim());
}

$('#composer').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const input = $('#chat-input');
  const text = input.value;
  input.value = '';
  input.placeholder = 'Tell me what you ate, or ask a question…';
  sendMessage(text);
});

// Voice: record -> server transcription -> handled like a typed message.
let recorder = null;
$('#mic').addEventListener('click', async () => {
  if (recorder) { recorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder = null;
      ui.recording = false;
      ui.busy = true;
      render();
      try {
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
        const { text } = await api('/api/transcribe', blob, blob.type);
        ui.busy = false;
        if (text) sendMessage(text); else render();
      } catch (err) {
        ui.busy = false;
        toast(`Voice failed: ${err.message}`);
        render();
      }
    };
    recorder.start();
    ui.recording = true;
    render();
  } catch {
    toast('Microphone not available');
  }
});

// ---------- Memory jobs (daily summaries on open, weekly AI pattern note: observations only) ----------
async function runMemoryJobs() {
  const d = today();
  for (const date of range(addDays(d, -28), addDays(d, -1))) {
    if (state.foodLogs.some((f) => f.date === date)) state.summaries[date] = dailySummary(state, date, table);
  }
  save(state);
  if (!ui.ai) return;
  if (state.patternNote && diffDays(d, state.patternNote.date) < 7) return;
  const weak = weakestNutrient(state, addDays(d, -1), table, LABEL);
  if (!weak) return;
  const lines = weekSummaries(state, addDays(d, -1), table).filter((s) => s.logged).map((s) => `${s.date}: ${Object.entries(s.nutrient_pct).map(([k, v]) => `${k} ${v}%`).join(', ')}`);
  try {
    const { summary } = await api('/api/summarize', { text: `Lowest nutrient: ${weak.label} (avg ${weak.avg}%).\nPatterns: ${patternNotes(state, addDays(d, -1), table).join(' ')}\n${lines.join('\n')}` });
    if (summary) commit((s) => { s.patternNote = { date: d, text: summary }; });
  } catch { /* optional job */ }
}

render();
api('/api/health').then((h) => { ui.ai = h.ai; render(); runMemoryJobs(); }).catch(() => { ui.ai = false; render(); });
