import { h, card, tabs, statusBadge, badge, toast, openModal, formModal } from '../ui/dom.js';
import { dataTable } from '../ui/table.js';
import { state, decide, approvalOwnerRoles } from '../core/store.js';
import { canApprove, ROLES } from '../core/rbac.js';
import { fmtDate } from '../core/dates.js';
import { fmt } from '../core/format.js';
import { ph, user, usr } from '../ui/common.js';
const TYPE = { order_margin: 'Đơn hàng dưới ngưỡng biên', order_credit: 'Đơn vượt hạn mức tín dụng', po: 'Đề nghị mua hàng', payment: 'Đề nghị thanh toán', inv_adjust: 'Điều chỉnh kiểm kê', expense: 'Chi phí vượt ngân sách' };
const ST = { tab: 'mine' };
export const pendingFor = (u) => (state.db?.approvals || []).filter((a) => a.status === 'pending' && canApprove(u, a, state.db.settings) === null);
export async function render(params, nav) {
  const u = user(), all = state.db.approvals, mine = pendingFor(u), own = all.filter((a) => a.requesterId === u.id);
  const TABS = [['mine', `Chờ tôi duyệt (${mine.length})`], ['pending', 'Tất cả đang chờ'], ['own', 'Do tôi gửi'], ['done', 'Đã xử lý']];
  const rows = ST.tab === 'mine' ? mine : ST.tab === 'pending' ? all.filter((a) => a.status === 'pending') : ST.tab === 'own' ? own : all.filter((a) => a.status !== 'pending');
  const tbl = dataTable({ cols: [{ key: 'id', label: 'Mã', render: (a) => h('b', null, a.id), sortVal: (a) => a.id }, { key: 't', label: 'Loại', render: (a) => TYPE[a.type], sortVal: (a) => a.type }, { key: 'ti', label: 'Nội dung', render: (a) => a.title }, { key: 'am', label: 'Giá trị', align: 'num', render: (a) => fmt(a.amount), sortVal: (a) => a.amount }, { key: 'by', label: 'Người gửi', render: (a) => usr(a.requesterId) }, { key: 'd', label: 'Ngày', render: (a) => fmtDate(a.createdAt), sortVal: (a) => a.createdAt }, { key: 's', label: 'Trạng thái', render: (a) => statusBadge(a.status), sortVal: (a) => a.status }], rows, pageSize: 10, searchText: (a) => a.title + a.id, onRow: (a) => detail(a, nav), empty: 'Không có yêu cầu nào', exportName: 'phe-duyet', canExport: false });
  return h('div', null, ph('Phê duyệt', 'Duyệt/từ chối theo số tiền và vai trò • Có kiểm soát kép: không tự duyệt giao dịch do mình tạo • Thao tác được ghi nhật ký'), tabs(TABS, ST.tab, (t) => { ST.tab = t; nav.refresh(); }), tbl);
}
function detail(a, nav) {
  const err = canApprove(user(), a, state.db.settings), ids = approvalOwnerRoles(a.amount).map((r) => ROLES[r].name.split(' / ')[0]).join(', ');
  const body = h('div', null, h('p', null, h('b', null, a.title)), h('p', { class: 'note' }, `${TYPE[a.type]} • Giá trị ${fmt(a.amount)} đ • Người gửi ${usr(a.requesterId)} • ${fmtDate(a.createdAt)} • Thẩm quyền duyệt: ${ids}`),
    a.reasons?.length ? h('ul', null, a.reasons.map((r) => h('li', { class: 'red-t' }, r))) : null, a.note ? h('p', null, 'Giải trình/ghi chú: ' + a.note) : null,
    a.status !== 'pending' ? h('p', null, statusBadge(a.status), ` bởi ${usr(a.approverId)} ${a.decisionNote ? '– ' + a.decisionNote : ''}`) : err ? h('p', { class: 'note red-t' }, 'Bạn không thể duyệt: ' + err) : h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => formModal({ title: 'Từ chối ' + a.id, fields: [{ name: 'n', label: 'Lý do từ chối', type: 'textarea', required: true, full: true }], submitLabel: 'Từ chối', onSubmit: (v) => { decide(a.id, 'reject', v.n); toast('Đã từ chối'); m.close(); nav.refresh(); window.__refreshBadge?.(); } }) }, 'Từ chối'), h('button', { class: 'btn', onclick: () => { try { decide(a.id, 'approve', ''); toast('Đã duyệt ' + a.id); m.close(); nav.refresh(); } catch (e) { toast(e.message, 'err'); } } }, 'Duyệt')));
  const m = openModal({ title: 'Yêu cầu ' + a.id, body, wide: true });
}
