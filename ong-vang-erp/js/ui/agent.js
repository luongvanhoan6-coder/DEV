// Popup "TRỢ LÝ XINH ĐẸP" (góc phải dưới). Chỉ hoạt động khi chạy bằng máy chủ cục bộ (npm run local) – dùng Claude Code CLI của máy bạn.
import { h } from './dom.js';
import { state } from '../core/store.js';
import { buildSnapshot } from '../core/snapshot.js';

const NAME = 'TRỢ LÝ XINH ĐẸP';
const CHIPS = ['Tổng hợp tình hình toàn bộ phần mềm hôm nay', 'Rủi ro dòng tiền 13 tuần?', 'Công nợ quá hạn và nên làm gì?', 'Tồn kho cần xử lý gì?', 'Mảng nào lãi thấp nhất?', 'Việc đang chờ duyệt'];
const AVATAR = '<svg viewBox="0 0 48 48" width="100%" height="100%"><defs><linearGradient id="agg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9ec7"/><stop offset="1" stop-color="#f1b21c"/></linearGradient></defs><circle cx="24" cy="24" r="24" fill="url(#agg)"/><circle cx="24" cy="21" r="9" fill="#ffe3cf"/><path d="M13 21c0-8 5-12 11-12s11 4 11 12c-3-5-7-7-11-7s-8 2-11 7z" fill="#4a2c1a"/><circle cx="20.5" cy="22" r="1.3" fill="#3a2418"/><circle cx="27.5" cy="22" r="1.3" fill="#3a2418"/><path d="M21 26.2q3 2.6 6 0" stroke="#d6537f" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M10 44c1-8 7-11 14-11s13 3 14 11z" fill="#0f5a2c"/><path d="M36 10l1.2 2.8 2.8 1.2-2.8 1.2L36 18l-1.2-2.8L32 14l2.8-1.2z" fill="#fff"/></svg>';
let open = false, busy = false, root, panel, list, input, sendBtn; const history = [];

function md(text) { // hiển thị an toàn: **đậm**, gạch đầu dòng; không dùng innerHTML
  const frag = document.createDocumentFragment(); let ul = null;
  const inline = (s, el) => s.split(/(\*\*[^*]+\*\*)/g).forEach((p) => el.append(/^\*\*[^*]+\*\*$/.test(p) ? h('b', null, p.slice(2, -2)) : p));
  for (const raw of String(text).split('\n')) {
    const line = raw.trimEnd(), m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { if (!ul) { ul = h('ul'); frag.append(ul); } const li = h('li'); inline(m[1], li); ul.append(li); continue; }
    ul = null; if (!line.trim()) { frag.append(h('div', { class: 'ag-sp' })); continue; }
    const hm = line.match(/^#{1,4}\s+(.*)$/), p = h('p'); inline(hm ? '**' + hm[1] + '**' : line, p); frag.append(p);
  }
  return frag;
}
function addMsg(role, text, extra) { const b = h('div', { class: 'ag-msg ' + role }, role === 'bot' ? md(text) : text); if (extra) b.append(extra); list.append(b); list.scrollTop = list.scrollHeight; return b; }
async function ask(q) {
  q = q.trim(); if (!q || busy) return; busy = true; sendBtn.disabled = true; input.value = '';
  addMsg('user', q); const typing = addMsg('bot typing', '', h('span', { class: 'ag-dots' }, h('i'), h('i'), h('i'), ' Em đang xem số liệu...'));
  try {
    const snapshot = buildSnapshot(state.user);
    const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, snapshot, history }) });
    const j = await r.json().catch(() => ({})); typing.remove();
    if (!r.ok) { addMsg('bot err', '⚠️ ' + (j.error || 'Không kết nối được trợ lý (mã ' + r.status + ')')); }
    else { addMsg('bot', j.answer); history.push({ role: 'user', text: q }, { role: 'bot', text: j.answer }); if (history.length > 12) history.splice(0, history.length - 12); }
  } catch (e) { typing.remove(); addMsg('bot err', '⚠️ Mất kết nối tới máy chủ cục bộ. Hãy chắc chắn "npm run local" vẫn đang chạy.'); }
  busy = false; sendBtn.disabled = false; input.focus();
}
function toggle(v) { open = v ?? !open; panel.hidden = !open; root.classList.toggle('open', open); try { sessionStorage.setItem('ag.open', open ? '1' : ''); } catch {} if (open) setTimeout(() => input.focus(), 50); }
function build() {
  const fab = h('button', { class: 'ag-fab', 'aria-label': 'Mở ' + NAME, onclick: () => toggle() }, h('span', { class: 'ag-av', html: AVATAR }), h('span', { class: 'ag-fab-t' }, NAME));
  list = h('div', { class: 'ag-list', 'aria-live': 'polite' });
  input = h('textarea', { rows: 1, placeholder: 'Hỏi em về số liệu, rủi ro, việc cần làm...', 'aria-label': 'Câu hỏi', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } if (e.key === 'Escape') toggle(false); }, oninput: () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 110) + 'px'; } });
  sendBtn = h('button', { class: 'ag-send', 'aria-label': 'Gửi', onclick: () => ask(input.value) }, '➤');
  panel = h('section', { class: 'ag-panel', hidden: true, role: 'dialog', 'aria-label': NAME },
    h('header', { class: 'ag-h' }, h('span', { class: 'ag-av lg', html: AVATAR }), h('div', null, h('b', null, NAME), h('small', null, '● Trực tuyến · dùng Claude trên máy của anh/chị')), h('span', { class: 'grow' }), h('button', { class: 'ag-x', title: 'Xóa hội thoại', 'aria-label': 'Xóa hội thoại', onclick: () => { history.length = 0; list.replaceChildren(); greet(); } }, '🗑'), h('button', { class: 'ag-x', 'aria-label': 'Thu nhỏ', onclick: () => toggle(false) }, '—')),
    list, h('div', { class: 'ag-chips' }, CHIPS.map((c) => h('button', { class: 'chip', onclick: () => ask(c) }, c))),
    h('div', { class: 'ag-in' }, input, sendBtn), h('p', { class: 'ag-foot' }, 'Bản tóm tắt dữ liệu theo quyền của anh/chị được gửi tới Claude để trả lời. Trợ lý chỉ tư vấn, không tự chuyển tiền/duyệt chi.'));
  root = h('div', { class: 'ag-root' }, panel, fab); document.body.append(root); greet();
}
function greet() { addMsg('bot', `Chào ${state.user.name.split(' ').slice(-1)[0]}! 💖 Em là **${NAME}**. Em tổng hợp thông tin toàn bộ phần mềm (theo quyền của ${state.user.title || 'anh/chị'}) và giúp anh/chị xem nhanh tình hình, rủi ro, việc cần làm. Anh/chị cứ hỏi nhé!`); }
export async function mountAgent() {
  if (root) { root.remove(); root = null; }
  if (!state.user) return;
  try { const r = await fetch('/api/agent/health', { cache: 'no-store' }); const j = await r.json(); if (!j.ok) return; } catch { return; } // không có máy chủ cục bộ => ẩn
  build(); try { if (sessionStorage.getItem('ag.open')) toggle(true); } catch {}
}
export const unmountAgent = () => { root?.remove(); root = null; history.length = 0; };
