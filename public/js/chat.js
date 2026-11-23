// Chat orchestration on the device: send history to the proxy, run returned tool calls locally,
// send results back, repeat until the model answers in text.
import { detectSafety, stripCalories } from './safety.js';
import { uid } from './store.js';
import { canonical } from './matching.js';

const MAX_STEPS = 10;
const MAX_ITEMS = 60;

export function createChat({ getState, commit, handlers, api, onBusy }) {
  /** Keep the tail of the conversation, always starting at a user message so tool pairs stay intact. */
  function trimmed(convo) {
    if (convo.length <= MAX_ITEMS) return convo;
    const start = convo.findIndex((item, i) => i >= convo.length - MAX_ITEMS && item.role === 'user');
    return start > 0 ? convo.slice(start) : convo;
  }

  // Second line of defense after the recommend() filter: drop sentences naming an excluded food.
  function scrubExcluded(text) {
    const p = getState().profile;
    const terms = [...p.disliked_foods, ...p.allergies].map(canonical).filter(Boolean);
    if (!terms.length) return text;
    return text.split(/(?<=[.!?])\s+/).filter((s) => {
      const low = ` ${canonical(s)} `;
      const mentions = terms.some((t) => low.includes(` ${t} `));
      const isWarning = /(don'?t|not|avoid|allerg|skip|without|instead|swap)/i.test(s);
      return !mentions || isWarning;
    }).join(' ');
  }

  async function send(text) {
    const messageId = uid();
    commit((s) => {
      for (const m of s.chat) if (m.role === 'card' && m.status === 'pending') m.status = 'expired';
      s.chat.push({ id: messageId, role: 'user', text, ts: Date.now(), linked_log_ids: [] });
    });

    const urgent = detectSafety(text);
    if (urgent) {
      // Fixed, templated card. Normal flow stops; nothing is sent to the model.
      commit((s) => s.chat.push({ id: uid(), role: 'safety', kind: urgent, ts: Date.now() }));
      return;
    }

    commit((s) => s.convo.push({ role: 'user', content: text }));
    onBusy(true);
    let recommended = false;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const convo = trimmed(getState().convo);
        const res = await api('/api/chat', { input: convo });
        const output = res.output || [];
        const calls = output.filter((o) => o.type === 'function_call');
        commit((s) => {
          s.convo = trimmed(s.convo).concat(output);
          for (const o of output) {
            if (o.type !== 'message') continue;
            let t = (o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('\n');
            t = stripCalories(t);
            if (recommended) t = scrubExcluded(t);
            if (t.trim()) s.chat.push({ id: uid(), role: 'assistant', text: t, ts: Date.now() });
          }
        });
        if (!calls.length) break;
        for (const call of calls) {
          let result;
          try {
            const fn = handlers[call.name];
            if (!fn) throw new Error(`Unknown tool ${call.name}`);
            if (call.name === 'recommend') recommended = true;
            result = await fn(JSON.parse(call.arguments || '{}'), { messageId });
            if (call.name === 'propose_logs' && result.log_ids) {
              commit((s) => { const m = s.chat.find((x) => x.id === messageId); if (m) m.linked_log_ids.push(...result.log_ids); });
            }
          } catch (err) {
            result = { error: err.message };
          }
          commit((s) => s.convo.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) }));
        }
      }
    } catch (err) {
      commit((s) => {
        s.chat.push({ id: uid(), role: 'error', text: `Couldn't reach the assistant (${err.message}). You can still log by hand in any tab.`, ts: Date.now() });
        // Drop the unanswered tail so the next turn starts clean.
        const lastUser = s.convo.map((m) => m.role).lastIndexOf('user');
        if (lastUser >= 0) s.convo = s.convo.slice(0, lastUser);
      });
    } finally {
      onBusy(false);
    }
  }

  return { send };
}
