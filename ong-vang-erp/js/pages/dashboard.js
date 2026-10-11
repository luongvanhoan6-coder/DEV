import { h, kpi, card, badge, toast } from '../ui/dom.js';
import { barChart, donut, PALETTE } from '../ui/charts.js';
import { state } from '../core/store.js';
import { periodStats, monthlySeries, profitBySegment, cashBalance, arByCustomer, arAging, apInvoices, inventoryView, buildAlerts, unreconciled, months, T, ordersIn } from '../core/queries.js';
import { balance } from '../core/calc.js';
import { addMonths, monthKey, fmtMonth } from '../core/dates.js';
import { fmtShort, fmt, pct, sum } from '../core/format.js';
import { allow, scopeOf, select } from '../ui/common.js';
const F = { period: null, segmentId: '', customerId: '', productId: '', whId: '' };
export async function render(params, nav) {
  const cur = monthKey(T()); F.period ||= addMonths(cur, -1);
  const scope = scopeOf(), f = { segmentId: F.segmentId || undefined, customerId: F.customerId || undefined, productId: F.productId || undefined, whId: F.whId || undefined, scope: scope || undefined };
  const s = periodStats(F.period, f), prev = periodStats(addMonths(F.period, -1), f);
  const delta = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
  const dl = (a, b) => { const d = delta(a, b); return d == null ? 'Chưa có kỳ so sánh' : (d >= 0 ? '↑ +' : '↓ ') + d.toFixed(0) + '% so với tháng trước'; };
  const filt = [select('p', months(13).reverse().map((m) => [m, fmtMonth(m)]), F.period, (v) => { F.period = v; nav.refresh(); }, 'Kỳ'),
    select('s', [['', 'Tất cả mảng'], ...state.db.segments.filter((x) => !scope || scope.includes(x.id)).map((x) => [x.id, x.name])], F.segmentId, (v) => { F.segmentId = v; nav.refresh(); }, 'Mảng'),
    select('c', [['', 'Tất cả khách hàng'], ...state.db.customers.map((x) => [x.id, x.name])], F.customerId, (v) => { F.customerId = v; nav.refresh(); }, 'Khách hàng'),
    select('pr', [['', 'Tất cả sản phẩm'], ...state.db.products.map((x) => [x.id, x.name])], F.productId, (v) => { F.productId = v; nav.refresh(); }, 'Sản phẩm'),
    select('w', [['', 'Tất cả kho'], ...state.db.warehouses.map((x) => [x.id, x.name])], F.whId, (v) => { F.whId = v; nav.refresh(); }, 'Kho')];
  const filtered = F.segmentId || F.customerId || F.productId || F.whId || scope;
  const un = unreconciled();
  const k1 = h('div', { class: 'grid g3' }, kpi('Doanh thu thuần', fmtShort(s.revenue), 'green', dl(s.revenue, prev.revenue), '#/reports?r=pl&month=' + F.period), kpi('Lãi gộp', fmtShort(s.gross), 'green', `Biên lãi gộp ${pct(s.margin)}`, '#/profit'), kpi('Lợi nhuận quản trị', fmtShort(s.profit), s.profit < 0 ? 'red' : 'green', dl(s.profit, prev.profit) + (filtered ? ' (chi phí chung phân bổ)' : ''), '#/profit'));
  const k2 = [];
  if (allow('cashflow')) k2.push(kpi('Tiền mặt & tài khoản', fmtShort(cashBalance()), 'green', un.length ? `Gồm ${un.length} GD chưa đối soát` : 'Đã đối soát', '#/cashflow'));
  if (allow('ar')) { const ag = arAging(arByCustomer()); k2.push(kpi('Công nợ phải thu', fmtShort(ag.total), 'amber', `Quá hạn ${fmtShort(ag.overdue)}`, '#/ar')); }
  if (allow('ap')) k2.push(kpi('Công nợ phải trả', fmtShort(sum(apInvoices(), balance)), 'red', 'Xem lịch thanh toán', '#/ap'));
  if (allow('inventory')) k2.push(kpi('Giá trị tồn kho', fmtShort(sum(inventoryView(), (x) => x.value)), 'blue', 'Theo phương pháp ' + (state.db.settings.costMethod === 'avg' ? 'bình quân gia quyền' : 'FIFO'), '#/inventory'));
  const ser = monthlySeries({ scope: scope || undefined, segmentId: F.segmentId || undefined, customerId: F.customerId || undefined, productId: F.productId || undefined, whId: F.whId || undefined }, 12);
  const seg = profitBySegment(F.period).filter((r) => (!scope || scope.includes(r.id)) && r.revenue > 0);
  const alerts = buildAlerts().slice(0, 5);
  const root = h('div', null,
    h('div', { class: 'banner' }, h('div', null, h('h2', null, 'ONG VÀNG'), h('small', null, 'KẾT NỐI GIÁ TRỊ NÔNG NGHIỆP')), h('div', { class: 'filters' }, filt)),
    h('p', { class: 'note', style: { margin: '8px 2px' } }, `Kỳ ${fmtMonth(F.period)} • Dữ liệu cập nhật ${new Date().toLocaleString('vi-VN')} • ${un.length} giao dịch tiền chưa đối soát (số tiền chưa phải số chốt) • Công thức: Lãi gộp = Doanh thu thuần − Giá vốn; Lợi nhuận quản trị = Lãi gộp − chi phí trực tiếp − chi phí chung (phân bổ theo "${state.db.settings.allocationMethod}"). ${state.db.settings.confirmed ? '' : 'Các ngưỡng/phương pháp đang là mặc định DEMO, chưa được xác nhận.'}`),
    h('div', { class: 'grid', style: { marginTop: '8px' } }, k1, h('div', { class: 'grid g4' }, k2)),
    h('div', { class: 'grid g21', style: { marginTop: '14px' } },
      card('Doanh thu & Lợi nhuận theo tháng', barChart({ labels: ser.map((x) => 'T' + +x.month.slice(5)), bars: [{ name: 'Doanh thu thuần', color: '#0f7a3f', data: ser.map((x) => x.revenue) }], line: { name: 'Lợi nhuận quản trị', color: '#f1b21c', data: ser.map((x) => x.profit) }, unit: 'tỷ', ariaLabel: 'Doanh thu và lợi nhuận 12 tháng' })),
      card('Tỷ trọng doanh thu theo mảng', seg.length ? donut({ items: seg.map((r, i) => ({ label: r.name, value: r.revenue, color: r.color || PALETTE[i % 8] })), center: [fmtShort(sum(seg, (r) => r.revenue)), fmtMonth(F.period)] }) : h('div', { class: 'state empty' }, 'Chưa có doanh thu trong kỳ'))),
    card('Cảnh báo cần xử lý', alerts.length ? h('div', { class: 'alerts' }, alerts.map((a) => h('a', { class: 'al', href: a.link }, h('span', { class: 'sev ' + a.sev }, '!'), h('div', null, h('b', null, a.title), h('p', null, a.detail))))) : h('div', { class: 'state empty' }, 'Không có cảnh báo'), h('a', { class: 'link', href: '#/ai?tab=alerts' }, 'Xem tất cả'), 'mt'));
  root.lastChild.style.marginTop = '14px';
  return root;
}
