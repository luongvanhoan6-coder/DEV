import { h, card, kpi, tabs, statusBadge, badge, toast, formModal, openModal } from '../ui/dom.js';
import { barChart } from '../ui/charts.js';
import { dataTable } from '../ui/table.js';
import { state, recordPayment, addCommitment, addReminder, addTask, setTaskStatus, customerOutstanding } from '../core/store.js';
import { arByCustomer, arAging, T } from '../core/queries.js';
import { balance, paid } from '../core/calc.js';
import { fmtDate, addDays } from '../core/dates.js';
import { fmt, fmtShort, sum, pct } from '../core/format.js';
import { ph, allow, user, cust, usr } from '../ui/common.js';
const ST = { tab: 'list' };
export async function render(params, nav) {
  if (params.tab) ST.tab = params.tab;
  const rows = arByCustomer(user()), ag = arAging(rows), bands = state.db.settings.agingBands, edit = allow('ar', 'edit');
  const TABS = [['overview', 'Tổng quan'], ['list', 'Danh sách công nợ'], ['sched', 'Lịch thu tiền'], ['report', 'Báo cáo']];
  const kp = h('div', { class: 'grid g3' }, kpi('Tổng phải thu', fmt(ag.total) + ' đ', 'blue', `${rows.length} khách hàng còn nợ`), kpi('Chưa đến hạn', fmt(ag.current) + ' đ', 'green', 'Không bị đánh dấu quá hạn'), kpi('Đã quá hạn', fmt(ag.overdue) + ' đ', 'red', ag.total ? pct((ag.overdue / ag.total) * 100) + ' tổng phải thu' : ''));
  const kb = h('div', { class: 'grid g4', style: { marginTop: '12px' } }, bands.map((b) => kpi('Quá hạn ' + b.label, fmt(ag[b.key]) + ' đ', 'red', null)));
  const body = ST.tab === 'overview' ? overview(rows, ag, bands) : ST.tab === 'list' ? list(rows, nav, edit, params) : ST.tab === 'sched' ? sched(rows, nav, edit) : report(rows, ag, bands);
  return h('div', null, ph('Công nợ phải thu', 'Tuổi nợ = ngày báo cáo − ngày đến hạn • Còn phải thu = phát sinh − thanh toán đã ghi nhận'), tabs(TABS, ST.tab, (t) => { ST.tab = t; nav.refresh(); }), kp, kb, h('div', { style: { marginTop: '14px' } }, body));
}
function overview(rows, ag, bands) {
  const top = [...rows].sort((a, b) => b.overdue - a.overdue).slice(0, 8), lim = rows.filter((r) => r.overLimit);
  return h('div', { class: 'grid g2' }, card('Tuổi nợ', barChart({ labels: ['Chưa đến hạn', ...bands.map((b) => b.label)], bars: [{ name: 'Số tiền', color: '#c0392b', data: [ag.current, ...bands.map((b) => ag[b.key])] }], unit: 'triệu', height: 220 })),
    card('Khách nợ quá hạn lớn nhất', h('table', { class: 'tbl' }, h('tbody', null, top.filter((r) => r.overdue > 0).map((r) => h('tr', null, h('td', null, r.name), h('td', { class: 'num red-t' }, fmt(r.overdue)), h('td', { class: 'num' }, r.maxDays + ' ngày')))))),
    card('Vượt hạn mức tín dụng', lim.length ? h('table', { class: 'tbl' }, h('tbody', null, lim.map((r) => h('tr', null, h('td', null, r.name), h('td', { class: 'num' }, fmt(r.total)), h('td', { class: 'num' }, 'Hạn mức ' + fmt(r.customer.creditLimit)))))) : h('div', { class: 'state empty' }, 'Không có khách vượt hạn mức')),
    card('Rủi ro (cảnh báo theo tuổi nợ – KHÔNG tự kết luận nợ xấu)', h('div', { class: 'alerts' }, rows.filter((r) => r.maxDays > 60).map((r) => h('div', { class: 'al' }, h('span', { class: 'sev high' }, '!'), h('div', null, h('b', null, r.name), h('p', null, `Có khoản quá hạn ${r.maxDays} ngày – cần cấp có thẩm quyền đánh giá.`)))).concat(rows.some((r) => r.maxDays > 60) ? [] : [h('div', { class: 'state empty' }, 'Không có khoản quá hạn trên 60 ngày')]))));
}
function list(rows, nav, edit, params) {
  const t = dataTable({ cols: [
    { key: 'name', label: 'Khách hàng', render: (r) => h('b', null, r.name), sortVal: (r) => r.name }, { key: 'total', label: 'Tổng công nợ', align: 'num', render: (r) => fmt(r.total), sortVal: (r) => r.total },
    { key: 'overdue', label: 'Quá hạn', align: 'num', render: (r) => h('span', { class: r.overdue ? 'red-t' : '' }, r.overdue ? fmt(r.overdue) : '0'), sortVal: (r) => r.overdue }, { key: 'days', label: 'Số ngày', align: 'num', render: (r) => (r.maxDays ? r.maxDays : '–'), sortVal: (r) => r.maxDays },
    { key: 'st', label: 'Trạng thái', render: (r) => h('span', null, statusBadge(r.status), r.overLimit ? h('span', { class: 'badge amber', style: { marginLeft: '4px' } }, 'Vượt hạn mức') : null), sortVal: (r) => r.status, csv: (r) => (r.status === 'overdue' ? 'Quá hạn' : 'Đúng hạn') }], rows,
    pageSize: 8, searchText: (r) => r.name + ' ' + r.customer.code, placeholder: 'Tìm kiếm khách hàng...', onRow: (r) => customerModal(r.id, nav, edit), rowClass: (r) => (r.status === 'overdue' && r.maxDays > 30 ? 'rowred' : ''),
    filters: [{ key: 'st', label: 'Tất cả', options: [['overdue', 'Quá hạn'], ['ontime', 'Đúng hạn'], ['over', 'Vượt hạn mức']], test: (r, v) => (v === 'over' ? r.overLimit : r.status === v) }], exportName: 'cong-no-phai-thu', canExport: allow('ar', 'export'), initialFilters: {} });
  if (params.q) setTimeout(() => { const i = t.querySelector('input.search'); if (i) { i.value = params.q; i.dispatchEvent(new Event('input')); } });
  return t;
}
function sched(rows, nav, edit) {
  const cms = state.db.commitments.filter((c) => c.status === 'open').sort((a, b) => a.promiseDate.localeCompare(b.promiseDate));
  const t = T(), due = rows.flatMap((r) => r.invoices.filter((x) => x.days <= 0 && x.days > -30).map((x) => ({ ...x, name: r.name })));
  return h('div', { class: 'grid g2' }, card('Cam kết thanh toán đang mở', dataTable({ cols: [{ key: 'd', label: 'Ngày hứa', render: (c) => fmtDate(c.promiseDate), sortVal: (c) => c.promiseDate }, { key: 'c', label: 'Khách hàng', render: (c) => cust(c.customerId) }, { key: 'a', label: 'Số tiền', align: 'num', render: (c) => fmt(c.amount), sortVal: (c) => c.amount }, { key: 'n', label: 'Nhắc', render: (c) => c.reminders.length + ' lần', sortVal: (c) => c.reminders.length }], rows: cms, pageSize: 6, onRow: (c) => customerModal(c.customerId, nav, edit), empty: 'Chưa có cam kết nào' })),
    card('Khoản sắp đến hạn (30 ngày)', dataTable({ cols: [{ key: 'd', label: 'Đến hạn', render: (x) => fmtDate(x.inv.dueDate), sortVal: (x) => x.inv.dueDate }, { key: 'c', label: 'Khách hàng', render: (x) => x.name }, { key: 'a', label: 'Còn lại', align: 'num', render: (x) => fmt(x.bal), sortVal: (x) => x.bal }], rows: due, pageSize: 6, empty: 'Không có khoản sắp đến hạn' })),
    card('Nhiệm vụ nhắc thu nợ', taskList(nav)));
}
function taskList(nav) {
  const ts = state.db.tasks.filter((x) => x.refType === 'ar');
  return ts.length ? h('div', { class: 'alerts' }, ts.slice(0, 12).map((x) => h('div', { class: 'al' }, statusBadge(x.status), h('div', null, h('b', null, x.title), h('p', null, `Hạn ${fmtDate(x.due)} • ${usr(x.ownerId)}`)), x.status === 'open' && allow('ar', 'edit') ? h('button', { class: 'btn ghost sm', style: { marginLeft: 'auto' }, onclick: () => { setTaskStatus(x.id, 'done'); nav.refresh(); } }, 'Hoàn thành') : null))) : h('div', { class: 'state empty' }, 'Chưa có nhiệm vụ. Mở một khách hàng để tạo nhiệm vụ nhắc nợ.');
}
function report(rows, ag, bands) {
  const top = [...rows].sort((a, b) => b.total - a.total).slice(0, 10);
  return h('div', { class: 'grid' }, card('Công nợ theo khách hàng và tuổi nợ (10 khách lớn nhất)', barChart({ labels: top.map((r) => r.name.slice(0, 10)), bars: [{ name: 'Chưa đến hạn', color: '#0f7a3f', data: top.map((r) => r.buckets.current || 0) }, ...bands.map((b, i) => ({ name: b.label, color: ['#e0b43a', '#e07b3a', '#c0392b', '#7d1414'][i % 4], data: top.map((r) => r.buckets[b.key] || 0) }))], stacked: true, unit: 'triệu', height: 260 })), h('p', { class: 'note' }, `DSO tham khảo xem ở Báo cáo > Vốn lưu động. Dải tuổi nợ cấu hình ở Hệ thống > Cấu hình.`));
}
export function customerModal(id, nav, edit) {
  const c = state.db.customers.find((x) => x.id === id), rows = arByCustomer(user()), r = rows.find((x) => x.id === id);
  const invs = state.db.invoices.filter((i) => i.direction === 'AR' && i.partyId === id && balance(i) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const cms = state.db.commitments.filter((x) => x.customerId === id);
  const body = h('div', null,
    h('div', { class: 'grid g3' }, kpi('Tổng nợ', fmt(r?.total || 0), 'blue'), kpi('Quá hạn', fmt(r?.overdue || 0), 'red'), kpi('Hạn mức / còn lại', fmt(c.creditLimit) + ' / ' + fmt(c.creditLimit - customerOutstanding(id)), 'amber', `Điều khoản ${c.terms} ngày • Phụ trách ${usr(c.ownerId)}`)),
    h('h4', { style: { margin: '14px 0 6px' } }, 'Chứng từ còn nợ'),
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Số CT', 'Đến hạn', 'Phát sinh', 'Đã thu', 'Còn lại', 'Tuổi nợ', ''].map((x) => h('th', null, x)))), h('tbody', null, invs.map((i) => { const d = Math.round((Date.parse(T()) - Date.parse(i.dueDate)) / 864e5); return h('tr', null, h('td', null, i.no), h('td', null, fmtDate(i.dueDate)), h('td', { class: 'num' }, fmt(i.amount)), h('td', { class: 'num' }, fmt(paid(i))), h('td', { class: 'num' }, fmt(balance(i))), h('td', null, d > 0 ? h('span', { class: 'red-t' }, d + ' ngày quá hạn') : 'Chưa đến hạn'), h('td', null, edit ? h('button', { class: 'btn sm', onclick: () => payForm(i, nav, m) }, 'Ghi thu tiền') : null)); }), invs.length ? null : h('tr', null, h('td', { colSpan: 7 }, 'Không còn nợ')))),
    h('h4', { style: { margin: '14px 0 6px' } }, 'Cam kết thanh toán & lịch sử nhắc'),
    cms.length ? h('div', { class: 'alerts' }, cms.map((x) => h('div', { class: 'al' }, statusBadge(x.status), h('div', null, h('b', null, `${fmt(x.amount)} đ – hứa ${fmtDate(x.promiseDate)} • ${x.contact}`), h('p', null, x.reminders.map((rm) => `${fmtDate(rm.at)}: ${rm.result}`).join(' | ')), edit && x.status === 'open' ? h('button', { class: 'btn ghost sm', onclick: () => formModal({ title: 'Ghi nhận lần nhắc', fields: [{ name: 'r', label: 'Kết quả liên hệ', required: true, full: true }], onSubmit: (v) => { addReminder(x.id, v.r); toast('Đã ghi nhận'); m.close(); nav.refresh(); } }) }, '+ Ghi lần nhắc') : null)))) : h('p', { class: 'muted' }, 'Chưa có cam kết.'),
    edit && invs.length ? h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => commitForm(invs, nav, m) }, '+ Ghi cam kết thanh toán'), h('button', { class: 'btn ghost', onclick: () => formModal({ title: 'Tạo nhiệm vụ nhắc thu nợ', fields: [{ name: 'title', label: 'Nội dung', value: 'Nhắc nợ ' + c.name, required: true, full: true }, { name: 'due', label: 'Hạn', type: 'date', value: addDays(T(), 3), required: true }], onSubmit: (v) => { addTask({ title: v.title, due: v.due, refType: 'ar', refId: id, ownerId: c.ownerId }); toast('Đã tạo nhiệm vụ'); m.close(); nav.refresh(); } }) }, 'Tạo nhiệm vụ nhắc nợ')) : null);
  const m = openModal({ title: c.name + ' (' + c.code + ')', body, wide: true });
}
function payForm(inv, nav, parent) {
  formModal({ title: `Ghi thu tiền – ${inv.no}`, fields: [{ name: 'date', label: 'Ngày thu', type: 'date', value: T(), required: true }, { name: 'amount', label: 'Số tiền (đ)', type: 'number', value: balance(inv), required: true, hint: 'Còn lại ' + fmt(balance(inv)) }, { name: 'accountId', label: 'Vào tài khoản', type: 'select', options: state.db.cashAccounts.map((a) => [a.id, a.name]), full: true }, { name: 'note', label: 'Ghi chú', full: true }], onSubmit: (v) => { recordPayment(inv.id, v); toast('Đã ghi nhận thu tiền'); parent.close(); nav.refresh(); } });
}
function commitForm(invs, nav, parent) {
  formModal({ title: 'Ghi cam kết thanh toán', fields: [{ name: 'invoiceId', label: 'Khoản phải thu', type: 'select', options: invs.map((i) => [i.id, `${i.no} – còn ${fmt(balance(i))}`]), full: true }, { name: 'promiseDate', label: 'Ngày hứa trả', type: 'date', value: addDays(T(), 7), required: true }, { name: 'amount', label: 'Số tiền hứa trả', type: 'number', required: true }, { name: 'contact', label: 'Người liên hệ', required: true }, { name: 'note', label: 'Ghi chú/kết quả liên hệ', full: true }], onSubmit: (v) => { addCommitment(v); toast('Đã ghi cam kết'); parent.close(); nav.refresh(); } });
}
