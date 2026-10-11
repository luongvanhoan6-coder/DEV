import { h, card, kpi, tabs, statusBadge, toast, formModal, openModal } from '../ui/dom.js';
import { barChart } from '../ui/charts.js';
import { dataTable } from '../ui/table.js';
import { state, recordPayment, createPaymentRequest, approvalOwnerRoles } from '../core/store.js';
import { apInvoices, apAging, cashBalance, T } from '../core/queries.js';
import { balance, paid, daysOverdue } from '../core/calc.js';
import { fmtDate, diffDays } from '../core/dates.js';
import { fmt, sum } from '../core/format.js';
import { ph, allow, sup } from '../ui/common.js';
import { ROLES } from '../core/rbac.js';
const ST = { tab: 'sched' };
export async function render(params, nav) {
  if (params.tab) ST.tab = params.tab;
  const t = T(), open = apInvoices().filter((i) => balance(i) > 0), ag = apAging(), edit = allow('ap', 'edit');
  const due7 = open.filter((i) => diffDays(i.dueDate, t) <= 7), cash = cashBalance();
  const kp = h('div', { class: 'grid g4' }, kpi('Tổng phải trả', fmt(ag.total) + ' đ', 'red', open.length + ' chứng từ'), kpi('Đến hạn 7 ngày', fmt(sum(due7, balance)) + ' đ', 'amber', `Tiền hiện có ${fmt(cash)} đ`), kpi('Đã quá hạn', fmt(ag.overdue) + ' đ', 'red'), kpi('Chờ duyệt thanh toán', String(open.filter((i) => i.requestStatus === 'pending').length), 'blue', 'Không tự chuyển tiền'));
  const TABS = [['overview', 'Tổng quan'], ['list', 'Danh sách'], ['sched', 'Lịch thanh toán'], ['prio', 'Ưu tiên thanh toán']];
  const reqBtn = (i) => (edit && (i.requestStatus === 'none' || i.requestStatus === 'rejected') ? h('button', { class: 'btn sm', onclick: () => { try { createPaymentRequest(i.id); toast('Đã gửi đề nghị thanh toán'); nav.refresh(); } catch (e) { toast(e.message, 'err'); } } }, '+ Tạo đề nghị') : i.requestStatus === 'approved' && edit ? h('button', { class: 'btn gold sm', onclick: () => payForm(i, nav) }, 'Ghi đã thanh toán') : null);
  const cols = [{ key: 'no', label: 'Chứng từ', render: (i) => h('b', null, i.no), sortVal: (i) => i.no }, { key: 'p', label: 'Nhà cung cấp', render: (i) => sup(i.partyId), sortVal: (i) => sup(i.partyId) }, { key: 'due', label: 'Đến hạn', render: (i) => fmtDate(i.dueDate), sortVal: (i) => i.dueDate }, { key: 'bal', label: 'Còn lại', align: 'num', render: (i) => fmt(balance(i)), sortVal: balance }, { key: 'st', label: 'Trạng thái', render: (i) => h('span', null, daysOverdue(i, t) > 0 ? h('span', { class: 'badge red' }, 'Quá hạn') : h('span', { class: 'badge green' }, 'Trong hạn'), ' ', statusBadge(i.requestStatus || 'none')), sortVal: (i) => i.requestStatus, csv: (i) => i.requestStatus }, { key: 'act', label: '', noSort: true, noExport: true, render: reqBtn }];
  let body;
  if (ST.tab === 'overview') body = card('Tuổi nợ phải trả', barChart({ labels: ['Chưa đến hạn', ...state.db.settings.agingBands.map((b) => b.label)], bars: [{ name: 'Số tiền', color: '#e0572b', data: [ag.current, ...state.db.settings.agingBands.map((b) => ag[b.key])] }], unit: 'triệu' }));
  else if (ST.tab === 'list') body = card('Sổ phải trả', dataTable({ cols, rows: open, pageSize: 10, searchText: (i) => i.no + ' ' + sup(i.partyId), placeholder: 'Tìm nhà cung cấp/chứng từ...', exportName: 'cong-no-phai-tra', canExport: allow('ap', 'export'), filters: [{ key: 'r', label: 'Trạng thái đề nghị', options: [['none', 'Chưa đề nghị'], ['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['rejected', 'Từ chối']], test: (i, v) => i.requestStatus === v }] }));
  else if (ST.tab === 'sched') body = card('Lịch thanh toán sắp tới', h('div', { class: 'alerts' }, [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 12).map((i) => h('div', { class: 'al' }, h('div', { class: 'badge ' + (daysOverdue(i, t) > 0 ? 'red' : diffDays(i.dueDate, t) <= 7 ? 'amber' : 'green'), style: { minWidth: '64px', textAlign: 'center' } }, h('b', null, i.dueDate.slice(8)), ' Th' + i.dueDate.slice(5, 7)), h('div', null, h('b', null, sup(i.partyId)), h('p', null, `${fmt(balance(i))} đ • ${i.note || i.no}`)), h('div', { style: { marginLeft: 'auto' } }, statusBadge(i.requestStatus || 'none'), ' ', reqBtn(i))))));
  else body = card('Gợi ý thứ tự ưu tiên (tham khảo – người có thẩm quyền quyết định)', priority(open, cash, t, reqBtn));
  return h('div', null, ph('Công nợ phải trả', 'Phải trả theo nhà cung cấp/chứng từ • Đề nghị thanh toán phải được duyệt theo hạn mức; hệ thống không tự chuyển tiền'), tabs(TABS, ST.tab, (x) => { ST.tab = x; nav.refresh(); }), kp, h('p', { class: 'note', style: { margin: '8px 0' } }, 'Thẩm quyền duyệt: ' + state.db.settings.approvalTiers.map((x) => `≤ ${x.upTo >= 1e15 ? '∞' : fmt(x.upTo)}: ${x.roles.map((r) => ROLES[r].name.split(' / ')[0]).join('/')}`).join('; ')), h('div', { style: { marginTop: '8px' } }, body));
}
// Ưu tiên: quá hạn trước, rồi theo hạn gần nhất; chỉ để gợi ý, hiển thị tiền còn lại sau mỗi khoản
function priority(open, cash, t, reqBtn) {
  let left = cash; const rows = [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 12).map((i, k) => { left -= balance(i); return { i, k: k + 1, left }; });
  return h('div', null, h('p', { class: 'note' }, 'Quy tắc gợi ý: hạn thanh toán gần nhất trước (quá hạn lên đầu). Chưa xét chiết khấu/mức quan trọng vì chưa có dữ liệu cấu hình.'), h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['#', 'Nhà cung cấp', 'Đến hạn', 'Số tiền', 'Tiền còn lại nếu trả', ''].map((x) => h('th', null, x)))), h('tbody', null, rows.map(({ i, k, left }) => h('tr', null, h('td', null, k), h('td', null, sup(i.partyId)), h('td', null, fmtDate(i.dueDate)), h('td', { class: 'num' }, fmt(balance(i))), h('td', { class: 'num ' + (left < state.db.settings.minCash ? 'red-t' : '') }, fmt(left)), h('td', null, reqBtn(i)))))));
}
function payForm(inv, nav) {
  formModal({ title: `Ghi nhận đã thanh toán – ${inv.no}`, note: 'Chỉ ghi nhận việc đã thanh toán ngoài hệ thống; phần mềm không chuyển tiền.', fields: [{ name: 'date', label: 'Ngày chi', type: 'date', value: T(), required: true }, { name: 'amount', label: 'Số tiền (đ)', type: 'number', value: balance(inv), required: true }, { name: 'accountId', label: 'Từ tài khoản', type: 'select', options: state.db.cashAccounts.map((a) => [a.id, a.name]), full: true }, { name: 'note', label: 'Ghi chú', full: true }], onSubmit: (v) => { recordPayment(inv.id, v); toast('Đã ghi nhận thanh toán'); nav.refresh(); } });
}
