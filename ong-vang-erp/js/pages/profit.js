import { h, card, kpi, tabs, toast } from '../ui/dom.js';
import { barChart, donut } from '../ui/charts.js';
import { dataTable } from '../ui/table.js';
import { state } from '../core/store.js';
import { profitBySegment, ordersIn, months, T } from '../core/queries.js';
import { orderTotals, lineGross, lineDiscount, marginPct } from '../core/calc.js';
import { addMonths, monthKey, fmtMonth } from '../core/dates.js';
import { fmt, fmtShort, pct, sum } from '../core/format.js';
import { ph, allow, scopeOf, select, prod, cust, seg } from '../ui/common.js';
const ST = { tab: 'seg', per: 'prev' };
const periods = () => { const cur = monthKey(T()); const m = { m0: [cur], prev: [addMonths(cur, -1)], q: months(3, addMonths(cur, -1)), y: months(12) }; return m[ST.per] || [ST.per]; };
const prevPeriods = (p) => p.map((m) => addMonths(m, -p.length));
export async function render(params, nav) {
  if (params.tab) ST.tab = params.tab;
  const scope = scopeOf(), pds = periods(), cur = monthKey(T());
  let rows = profitBySegment(null, pds).filter((r) => !scope || scope.includes(r.id)); const prevRows = profitBySegment(null, prevPeriods(pds));
  const tot = { revenue: sum(rows, (r) => r.revenue), gross: sum(rows, (r) => r.gross), contribution: sum(rows, (r) => r.contribution), profit: sum(rows, (r) => r.profit), cogs: sum(rows, (r) => r.cogs), direct: sum(rows, (r) => r.direct), allocated: sum(rows, (r) => r.allocated) };
  const prevProfit = sum(prevRows.filter((r) => !scope || scope.includes(r.id)), (r) => r.profit);
  const TABS = [['seg', 'Theo mảng'], ['prod', 'Theo sản phẩm'], ['cust', 'Theo khách hàng'], ['area', 'Theo khu vực']];
  const perSel = select('per', [['m0', 'Tháng này (tạm tính)'], ['prev', 'Tháng trước'], ['q', '3 tháng gần nhất'], ['y', '12 tháng gần nhất'], ...months(12).reverse().map((m) => [m, fmtMonth(m)])], ST.per, (v) => { ST.per = v; nav.refresh(); }, 'Kỳ');
  const head = ph('Phân tích lợi nhuận', `Kỳ: ${pds.length > 1 ? fmtMonth(pds[0]) + ' – ' + fmtMonth(pds.at(-1)) : fmtMonth(pds[0])}${pds.includes(cur) ? ' (tháng hiện tại chưa chốt – tạm tính)' : ''} • Lãi gộp = Doanh thu thuần − Giá vốn • Lợi nhuận sau phân bổ = Lãi gộp − chi phí trực tiếp − chi phí chung phân bổ (${state.db.settings.allocationMethod})`, [perSel, allow('profit', 'export') ? h('button', { class: 'btn', onclick: () => window.print() }, '⬇ Xuất báo cáo (PDF)') : null]);
  const kp = h('div', { class: 'grid g4' }, kpi('Tổng doanh thu thuần', fmt(tot.revenue) + ' đ', 'blue'), kpi('Lãi gộp', fmt(tot.gross) + ' đ', 'green', 'Biên ' + pct(marginPct(tot.gross, tot.revenue))), kpi('Lợi nhuận đóng góp', fmt(tot.contribution) + ' đ', 'green', 'Sau chi phí trực tiếp'), kpi('Lợi nhuận sau phân bổ', fmt(tot.profit) + ' đ', tot.profit < 0 ? 'red' : 'amber', prevProfit ? `Kỳ trước ${fmtShort(prevProfit)} (${(((tot.profit - prevProfit) / Math.abs(prevProfit)) * 100).toFixed(0)}%)` : 'Chưa có kỳ so sánh'));
  let body;
  if (ST.tab === 'seg') {
    const act = rows.filter((r) => r.revenue > 0);
    body = h('div', { class: 'grid' }, card('Lợi nhuận theo mảng kinh doanh', barChart({ labels: act.map((r) => r.name), bars: [{ name: 'Doanh thu', color: '#0f7a3f', data: act.map((r) => r.revenue) }, { name: 'Lãi gộp', color: '#f1b21c', data: act.map((r) => r.gross) }, { name: 'Lợi nhuận', color: '#2b9fd8', data: act.map((r) => r.profit) }], unit: 'tỷ', height: 260 })),
      card('Chi tiết theo mảng', dataTable({ cols: [{ key: 'name', label: 'Mảng kinh doanh', render: (r) => h('b', null, r.name), sortVal: (r) => r.name }, { key: 'revenue', label: 'Doanh thu', align: 'num', render: (r) => fmt(r.revenue), sortVal: (r) => r.revenue }, { key: 'cogs', label: 'Giá vốn', align: 'num', render: (r) => fmt(r.cogs), sortVal: (r) => r.cogs }, { key: 'gross', label: 'Lãi gộp', align: 'num', render: (r) => fmt(r.gross), sortVal: (r) => r.gross }, { key: 'direct', label: 'CP trực tiếp', align: 'num', render: (r) => fmt(r.direct), sortVal: (r) => r.direct }, { key: 'contribution', label: 'LN đóng góp', align: 'num', render: (r) => fmt(r.contribution), sortVal: (r) => r.contribution }, { key: 'allocated', label: 'CP chung phân bổ', align: 'num', render: (r) => fmt(r.allocated), sortVal: (r) => r.allocated }, { key: 'profit', label: 'LN sau phân bổ', align: 'num', render: (r) => h('b', { class: r.profit < 0 ? 'red-t' : '' }, fmt(r.profit)), sortVal: (r) => r.profit }, { key: 'm', label: 'Biên lãi gộp', align: 'num', render: (r) => pct(r.margin), sortVal: (r) => r.margin ?? -1 }, { key: 'pm', label: 'Tỷ suất LN', align: 'num', render: (r) => pct(r.profitMargin), sortVal: (r) => r.profitMargin ?? -1 }], rows: rows.filter((r) => r.revenue || r.direct), pageSize: 10, exportName: 'loi-nhuan-theo-mang', canExport: allow('profit', 'export'), footer: (rs) => h('span', null, `Tổng: DT ${fmt(sum(rs, (r) => r.revenue))} • LN sau phân bổ ${fmt(sum(rs, (r) => r.profit))}. Chi phí chung được phân bổ theo "${state.db.settings.allocationMethod}" – không cộng trùng với chi phí trực tiếp (BR-09).`) })));
  } else {
    const dim = ST.tab, map = {}, scoped = pds.flatMap((p) => ordersIn(p, { scope: scope || undefined }));
    for (const o of scoped) {
      if (dim === 'prod') for (const l of o.lines) { const k = l.productId, r = (map[k] ||= { key: k, name: prod(k)?.name, revenue: 0, cogs: 0, direct: 0, qty: 0 }); r.revenue += lineGross(l) - lineDiscount(l); r.cogs += l.qty * l.cost; r.qty += l.qty; }
      else { const t = orderTotals(o), k = dim === 'cust' ? o.customerId : state.db.customers.find((c) => c.id === o.customerId)?.address, r = (map[k] ||= { key: k, name: dim === 'cust' ? cust(k) : k, revenue: 0, cogs: 0, direct: 0 }); r.revenue += t.net; r.cogs += t.cogs; r.direct += t.direct; }
    }
    const rs = Object.values(map).map((r) => ({ ...r, gross: r.revenue - r.cogs, margin: marginPct(r.revenue - r.cogs, r.revenue), contribution: r.revenue - r.cogs - r.direct }));
    body = card({ prod: 'Theo sản phẩm (lãi gộp theo dòng hàng)', cust: 'Theo khách hàng (lợi nhuận đóng góp, chưa phân bổ chi phí chung)', area: 'Theo địa bàn khách hàng' }[dim], dataTable({ cols: [{ key: 'name', label: dim === 'prod' ? 'Sản phẩm' : dim === 'cust' ? 'Khách hàng' : 'Khu vực', sortVal: (r) => r.name }, { key: 'revenue', label: 'Doanh thu', align: 'num', render: (r) => fmt(r.revenue), sortVal: (r) => r.revenue }, { key: 'cogs', label: 'Giá vốn', align: 'num', render: (r) => fmt(r.cogs), sortVal: (r) => r.cogs }, { key: 'gross', label: 'Lãi gộp', align: 'num', render: (r) => fmt(r.gross), sortVal: (r) => r.gross }, ...(dim !== 'prod' ? [{ key: 'contribution', label: 'LN đóng góp', align: 'num', render: (r) => fmt(r.contribution), sortVal: (r) => r.contribution }] : []), { key: 'm', label: 'Biên lãi gộp', align: 'num', render: (r) => pct(r.margin), sortVal: (r) => r.margin ?? -1 }], rows: rs.sort((a, b) => b.gross - a.gross), pageSize: 10, searchText: (r) => r.name || '', exportName: 'loi-nhuan-' + dim, canExport: allow('profit', 'export'), rowClass: (r) => (r.margin != null && r.margin < state.db.settings.marginThreshold ? 'rowamber' : '') }));
  }
  return h('div', null, head, tabs(TABS, ST.tab, (t) => { ST.tab = t; nav.refresh(); }), kp, h('div', { style: { marginTop: '14px' } }, body));
}
