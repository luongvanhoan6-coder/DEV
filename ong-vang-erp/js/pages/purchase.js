import { h, card, kpi, tabs, statusBadge, badge, toast, openModal } from '../ui/dom.js';
import { dataTable } from '../ui/table.js';
import { state, savePO, receivePO } from '../core/store.js';
import { T } from '../core/queries.js';
import { balance } from '../core/calc.js';
import { fmtDate } from '../core/dates.js';
import { fmt, sum } from '../core/format.js';
import { ph, allow, sup, prod, wh, usr } from '../ui/common.js';
const ST = { tab: 'po' };
const total = (po) => sum(po.lines, (l) => l.qty * l.cost);
export async function render(params, nav) {
  if (params.tab) ST.tab = params.tab;
  const edit = allow('purchase', 'edit'), pos = state.db.purchaseOrders;
  const head = ph('Mua hàng', 'Đề nghị mua cần cấp duyệt theo số tiền • Nhập kho đơn đã duyệt sẽ tạo công nợ phải trả', edit ? h('button', { class: 'btn', onclick: () => poForm(nav) }, '+ Tạo đề nghị mua') : null);
  const kp = h('div', { class: 'grid g4' }, kpi('Đơn mua tháng này', String(pos.filter((p) => p.date.startsWith(T().slice(0, 7))).length), 'blue'), kpi('Chờ duyệt', String(pos.filter((p) => p.status === 'pending_approval').length), 'amber'), kpi('Đã duyệt, chờ nhập kho', String(pos.filter((p) => p.status === 'approved').length), 'green'), kpi('Giá trị chờ duyệt', fmt(sum(pos.filter((p) => p.status === 'pending_approval'), total)), 'amber'));
  const body = ST.tab === 'po' ? dataTable({ cols: [{ key: 'id', label: 'Mã đơn mua', render: (p) => h('b', null, p.id), sortVal: (p) => p.id }, { key: 's', label: 'Nhà cung cấp', render: (p) => sup(p.supplierId), sortVal: (p) => sup(p.supplierId) }, { key: 'd', label: 'Ngày', render: (p) => fmtDate(p.date), sortVal: (p) => p.date }, { key: 'v', label: 'Giá trị', align: 'num', render: (p) => fmt(total(p)), sortVal: total }, { key: 'st', label: 'Trạng thái', render: (p) => statusBadge(p.status), sortVal: (p) => p.status, csv: (p) => p.status }], rows: [...pos].sort((a, b) => b.date.localeCompare(a.date)), pageSize: 9, searchText: (p) => p.id + sup(p.supplierId), onRow: (p) => poModal(p.id, nav), exportName: 'don-mua', canExport: allow('purchase', 'export'), filters: [{ key: 's', label: 'Trạng thái', options: [['pending_approval', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['received', 'Đã nhập kho'], ['rejected', 'Từ chối']], test: (p, v) => p.status === v }] })
    : dataTable({ cols: [{ key: 'c', label: 'Mã', render: (s) => s.code }, { key: 'n', label: 'Nhà cung cấp', render: (s) => h('b', null, s.name) }, { key: 't', label: 'Hạn thanh toán', render: (s) => s.terms + ' ngày' }, { key: 'b', label: 'Đang nợ', align: 'num', render: (s) => fmt(sum(state.db.invoices.filter((i) => i.direction === 'AP' && i.partyId === s.id), balance)), sortVal: (s) => sum(state.db.invoices.filter((i) => i.direction === 'AP' && i.partyId === s.id), balance) }], rows: state.db.suppliers, searchText: (s) => s.name });
  return h('div', null, head, tabs([['po', 'Đơn mua'], ['sup', 'Nhà cung cấp']], ST.tab, (t) => { ST.tab = t; nav.refresh(); }), kp, h('div', { style: { marginTop: '14px' } }, body));
}
function poModal(id, nav) {
  const po = state.db.purchaseOrders.find((p) => p.id === id), inv = state.db.invoices.find((i) => i.orderId === id), ap = state.db.approvals.find((a) => a.refId === id);
  const edit = allow('inventory', 'edit');
  const body = h('div', null, h('p', { class: 'note' }, `${sup(po.supplierId)} • ${fmtDate(po.date)} • Nhập về ${wh(po.whId)} • Người đề nghị ${usr(po.requesterId)} ${po.note ? '• ' + po.note : ''}`),
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Sản phẩm', 'SL', 'Đơn giá', 'Thành tiền'].map((x) => h('th', null, x)))), h('tbody', null, po.lines.map((l) => h('tr', null, h('td', null, prod(l.productId).name), h('td', { class: 'num' }, fmt(l.qty)), h('td', { class: 'num' }, fmt(l.cost)), h('td', { class: 'num' }, fmt(l.qty * l.cost)))))),
    h('p', null, h('b', null, 'Tổng: ' + fmt(total(po)) + ' đ'), ' ', statusBadge(po.status)),
    ap ? h('p', { class: 'note' }, `Phê duyệt: ${ap.id} – ${ap.status}${ap.decisionNote ? ' (' + ap.decisionNote + ')' : ''}`) : null,
    inv ? h('p', { class: 'note' }, `Đối chiếu: hóa đơn/phải trả ${inv.no} = ${fmt(inv.amount)} đ ${inv.amount === total(po) ? '(khớp đơn mua)' : '(LỆCH so với đơn mua)'}`) : null,
    edit && po.status === 'approved' ? h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => receiveForm(po, nav, m) }, 'Nhập kho & ghi nhận công nợ')) : null);
  const m = openModal({ title: 'Đơn mua ' + po.id, body, wide: true });
}
function receiveForm(po, nav, parent) {
  const lots = {}, rows = po.lines.map((l) => { const p = prod(l.productId); if (!p.expiryTracked) return null; lots[l.productId] = { lot: '', expiry: '' }; return h('div', { class: 'form-grid' }, h('b', { class: 'full' }, p.name + ' – quản lý hạn dùng'), h('label', { class: 'fld' }, h('span', null, 'Số lô *'), h('input', { oninput: (e) => (lots[l.productId].lot = e.target.value) })), h('label', { class: 'fld' }, h('span', null, 'Hạn dùng *'), h('input', { type: 'date', oninput: (e) => (lots[l.productId].expiry = e.target.value) }))); }).filter(Boolean);
  const err = h('div', { class: 'form-err' }), date = h('input', { type: 'date', value: T() });
  const m = openModal({ title: 'Nhập kho đơn ' + po.id, body: h('div', null, h('label', { class: 'fld' }, h('span', null, 'Ngày nhập'), date), ...rows, err, h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { try { receivePO(po.id, { date: date.value, lots }); toast('Đã nhập kho và tạo công nợ phải trả'); m.close(); parent.close(); nav.refresh(); } catch (e) { err.textContent = e.message; } } }, 'Xác nhận nhập kho'))) });
}
function poForm(nav) {
  const lines = [{ productId: state.db.products[0].id, qty: 1, cost: state.db.products[0].stdCost }], err = h('div', { class: 'form-err' }), tb = h('tbody');
  const sel = h('select', null, state.db.suppliers.map((s) => h('option', { value: s.id }, s.name))), date = h('input', { type: 'date', value: T() }), whs = h('select', null, state.db.warehouses.map((w) => h('option', { value: w.id }, w.name))), note = h('input', { placeholder: 'Mục đích/giải trình' }), sum_ = h('b');
  const redraw = () => { tb.replaceChildren(...lines.map((l, i) => h('tr', null, h('td', null, h('select', { onchange: (e) => { l.productId = e.target.value; l.cost = prod(l.productId).stdCost; redraw(); } }, state.db.products.map((p) => h('option', { value: p.id, selected: p.id === l.productId }, p.name)))), h('td', null, h('input', { type: 'number', min: 0, step: 'any', value: l.qty, style: { width: '90px' }, oninput: (e) => { l.qty = e.target.value; upd(); } })), h('td', null, h('input', { type: 'number', min: 0, step: 'any', value: l.cost, style: { width: '110px' }, oninput: (e) => { l.cost = e.target.value; upd(); } })), h('td', null, lines.length > 1 ? h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { lines.splice(i, 1); redraw(); } }, '×') : null)))); upd(); };
  const upd = () => { sum_.textContent = 'Tổng: ' + fmt(lines.reduce((a, l) => a + (+l.qty || 0) * (+l.cost || 0), 0)) + ' đ'; };
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Gửi duyệt');
  const m = openModal({ title: 'Đề nghị mua hàng', wide: true, body: h('form', { class: 'form-grid', onsubmit: (e) => { e.preventDefault(); err.textContent = ''; btn.disabled = true; try { const po = savePO({ supplierId: sel.value, date: date.value, whId: whs.value, lines: lines.map((l) => ({ ...l })), note: note.value }); toast('Đã gửi đề nghị ' + po.id + ' chờ duyệt'); m.close(); nav.refresh(); } catch (x) { err.textContent = x.message; btn.disabled = false; } } },
    h('label', { class: 'fld' }, h('span', null, 'Nhà cung cấp *'), sel), h('label', { class: 'fld' }, h('span', null, 'Ngày *'), date), h('label', { class: 'fld' }, h('span', null, 'Kho nhận'), whs), h('label', { class: 'fld' }, h('span', null, 'Ghi chú'), note),
    h('div', { class: 'full tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Sản phẩm', 'Số lượng', 'Đơn giá', ''].map((x) => h('th', null, x)))), tb)), h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { lines.push({ productId: state.db.products[0].id, qty: 1, cost: state.db.products[0].stdCost }); redraw(); } }, '+ Thêm dòng'), h('div', { class: 'full' }, sum_), err, h('div', { class: 'row end full' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => m.close() }, 'Hủy'), btn)) }); redraw();
}
