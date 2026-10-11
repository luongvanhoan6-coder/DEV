import { h, card, kpi, tabs, badge, toast, openModal, statusBadge } from '../ui/dom.js';
import { state, logAiRun, aiFeedback, addTask } from '../core/store.js';
import { buildAlerts, arByCustomer, T } from '../core/queries.js';
import { answer, SUGGESTIONS, dunningEmail } from '../core/ai.js';
import { addDays, fmtDate } from '../core/dates.js';
import { fmtShort } from '../core/format.js';
import { ph, allow, user } from '../ui/common.js';
const ST = { tab: 'chat', msgs: [] };
export async function render(params, nav) {
  if (params.tab) ST.tab = params.tab;
  const alerts = buildAlerts(), TABS = [['overview', 'Tổng quan'], ['alerts', 'Cảnh báo'], ['chat', 'Phân tích AI'], ['actions', 'Gợi ý hành động']];
  const head = ph('Trợ lý AI Ong Vàng', null, badge('Beta', 'blue'));
  const note = h('p', { class: 'note', style: { marginBottom: '10px' } }, 'Trợ lý chạy theo quy tắc trên dữ liệu trong hệ thống (chưa kết nối mô hình ngôn ngữ ngoài – cần cấu hình AI provider ở server). Luôn nêu kỳ/thời điểm dữ liệu, phân biệt SỐ THỰC TẾ / DỰ BÁO / SUY LUẬN. Không tự chuyển tiền, duyệt chi, đổi hạn mức, sửa kỳ khóa.');
  let body;
  if (ST.tab === 'overview') { const t = answer('tóm tắt'); body = h('div', { class: 'grid g2' }, card('Tóm tắt tài chính', h('pre', { class: 'msg a', style: { whiteSpace: 'pre-wrap', fontFamily: 'inherit' } }, t.text)), card('Số cảnh báo', h('div', { class: 'grid g3' }, kpi('Mức cao', String(alerts.filter((a) => a.sev === 'high').length), 'red'), kpi('Mức trung bình', String(alerts.filter((a) => a.sev === 'med').length), 'amber'), kpi('Mức thấp', String(alerts.filter((a) => a.sev === 'low').length), 'blue')))); }
  else if (ST.tab === 'alerts') body = h('div', { class: 'alerts' }, alerts.map((a) => h('div', { class: 'al' }, h('span', { class: 'sev ' + a.sev }, '!'), h('div', null, h('b', null, a.title), h('p', null, a.detail), h('p', null, h('span', { class: 'src' }, a.kind === 'forecast' ? 'DỰ BÁO' : 'SỐ THỰC TẾ'), h('span', { class: 'src' }, 'Nguồn: ' + a.page), h('a', { class: 'link', href: a.link }, 'Xem giao dịch nguồn →'))))).concat(alerts.length ? [] : [h('div', { class: 'state empty' }, 'Không có cảnh báo')]));
  else if (ST.tab === 'actions') body = h('div', { class: 'alerts' }, alerts.filter((a) => a.action).map((a) => h('div', { class: 'al' }, badge(a.action.priority, a.action.priority === 'Cao' ? 'red' : a.action.priority === 'Trung bình' ? 'amber' : 'blue'), h('div', null, h('b', null, a.action.text), h('p', null, `Người phụ trách đề xuất: ${a.action.owner}${a.action.impact ? ' • Tác động ước tính: ' + fmtShort(a.action.impact) : ''} • Căn cứ: ${a.title}`)), allow('ar', 'edit') || allow('ap', 'edit') || user().role === 'admin' ? h('button', { class: 'btn ghost sm', style: { marginLeft: 'auto' }, onclick: () => { addTask({ title: a.action.text, due: addDays(T(), 7), refType: 'ai', refId: a.id, note: a.title }); toast('Đã tạo nhiệm vụ (cần người phụ trách xác nhận)'); } }, 'Tạo nhiệm vụ') : null)));
  else body = chat(nav);
  return h('div', null, head, tabs(TABS, ST.tab, (t) => { ST.tab = t; nav.refresh(); }), note, body);
}
function chat(nav) {
  const box = h('div', { class: 'chat' }), input = h('input', { onkeydown: (e) => e.key === 'Enter' && ask(input.value), placeholder: 'Hỏi bất kỳ điều gì về công nợ, dòng tiền, tồn kho...', style: { flex: 1, padding: '10px 14px', border: '1px solid var(--line)', borderRadius: '99px' } });
  const draw = () => { box.replaceChildren(...ST.msgs.map((m) => h('div', { class: 'msg ' + (m.role === 'u' ? 'u' : 'a') }, m.text, m.sources?.length ? h('small', null, 'Nguồn: ', m.sources.map((s) => h('a', { class: 'src', href: s.href }, s.label))) : null, m.run ? h('small', null, 'Phản hồi: ', h('button', { class: 'chip', onclick: () => { aiFeedback(m.run, 'up'); toast('Cảm ơn phản hồi'); } }, '👍 Hữu ích'), h('button', { class: 'chip', onclick: () => { aiFeedback(m.run, 'down'); toast('Đã ghi nhận'); } }, '👎 Chưa đúng')) : null))); box.scrollTop = box.scrollHeight; };
  const ask = (q) => { q = q.trim(); if (!q) return; ST.msgs.push({ role: 'u', text: q }); const a = answer(q), run = logAiRun({ question: q, intent: a.intent, sources: a.sources.map((s) => s.href), summary: a.text.slice(0, 200) }); ST.msgs.push({ role: 'a', text: a.text, sources: a.sources, run: run.id, top: a.top }); input.value = ''; draw(); };
  if (!ST.msgs.length) ST.msgs.push({ role: 'a', text: 'Xin chào! Tôi là Trợ lý AI Ong Vàng. Hãy chọn một gợi ý hoặc đặt câu hỏi về công nợ, dòng tiền, tồn kho, lợi nhuận, ngân sách.', sources: [] });
  draw();
  const rows = arByCustomer(user()).filter((r) => r.overdue > 0).sort((a, b) => b.overdue - a.overdue);
  const actions = h('div', { class: 'row', style: { marginTop: '10px' } }, allow('ar', 'edit') ? h('button', { class: 'chip', onclick: () => { try { const top = rows.slice(0, 5); top.forEach((r) => addTask({ title: `Gọi nhắc nợ ${r.name} – quá hạn ${fmtShort(r.overdue)}`, due: addDays(T(), 3), refType: 'ar', refId: r.id, ownerId: r.customer.ownerId })); toast(`Đã tạo ${top.length} nhiệm vụ nhắc nợ (xem Công nợ phải thu > Lịch thu tiền)`); } catch (e) { toast(e.message, 'err'); } } }, 'Tạo danh sách khách cần gọi') : null,
    h('button', { class: 'chip', onclick: () => { if (!rows[0]) return toast('Không có khách quá hạn'); const t = dunningEmail(rows[0]); openModal({ title: 'Bản nháp email nhắc nợ – ' + rows[0].name, body: h('div', null, h('textarea', { rows: 14, style: { width: '100%', padding: '10px' }, value: t }), h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(t); toast('Đã sao chép'); } }, 'Sao chép'))) }); } }, 'Soạn email nhắc nợ'),
    h('a', { class: 'chip', href: '#/ar' }, 'Xem chi tiết công nợ'));
  return h('div', { class: 'grid g21' }, card(null, h('div', null, box, h('div', { class: 'row', style: { marginTop: '10px' } }, input, h('button', { class: 'btn', onclick: () => ask(input.value) }, 'Gửi')), actions)), card('Gợi ý câu hỏi', h('div', null, SUGGESTIONS.map((s) => h('div', null, h('button', { class: 'chip', style: { textAlign: 'left', margin: '3px 0' }, onclick: () => ask(s) }, s))))));
}
