import { h, card, kpi, toast, formModal, badge } from '../ui/dom.js';
import { dataTable } from '../ui/table.js';
import { state, saveScenario } from '../core/store.js';
import { forecast, periodStats, months, inventoryView, T } from '../core/queries.js';
import { addMonths, monthKey, fmtDate } from '../core/dates.js';
import { fmt, fmtShort, pct, sum } from '../core/format.js';
import { ph, allow, usr } from '../ui/common.js';
const ST = { sel: null };
const VARS = [['revenuePct', 'Thay đổi sản lượng bán (%)', 0], ['sellPricePct', 'Thay đổi giá bán (%)', 0], ['buyPricePct', 'Thay đổi giá mua/giá vốn (%)', 0], ['costPct', 'Thay đổi chi phí chung (%)', 0], ['collectionPct', 'Tỷ lệ thu được công nợ (%)', 100], ['delayDays', 'Thu tiền trễ (+)/sớm (−) ngày', 0], ['inventoryPct', 'Thay đổi giá trị tồn kho (%)', 0]];
// Công thức minh bạch, dựa trên trung bình 3 tháng gần nhất (đã chốt) – giả định tách khỏi dữ liệu thực (BR-11)
export function runScenario(v) {
  const ms = months(3, addMonths(monthKey(T()), -1)), ps = ms.map((m) => periodStats(m)), avg = (k) => sum(ps, (p) => p[k]) / 3;
  const base = { revenue: avg('revenue'), cogs: avg('cogs'), direct: avg('direct'), shared: avg('shared') };
  const vol = 1 + (v.revenuePct || 0) / 100, sp = 1 + (v.sellPricePct || 0) / 100, bp = 1 + (v.buyPricePct || 0) / 100, cp = 1 + (v.costPct || 0) / 100;
  const sc = { revenue: base.revenue * vol * sp, cogs: base.cogs * vol * bp, direct: base.direct * vol, shared: base.shared * cp };
  [base, sc].forEach((x) => { x.gross = x.revenue - x.cogs; x.margin = x.revenue ? (x.gross / x.revenue) * 100 : null; x.profit = x.gross - x.direct - x.shared; });
  const fb = forecast('base'), fs = forecast('x', { collectionPct: (v.collectionPct ?? 100) / 100, delayDays: v.delayDays || 0, costPct: cp });
  const minB = Math.min(...fb.weeks.map((w) => w.closing)), minS = Math.min(...fs.weeks.map((w) => w.closing)), min = state.db.settings.minCash;
  const invDelta = sum(inventoryView(), (x) => x.value) * ((v.inventoryPct || 0) / 100);
  const bepBase = base.gross && base.revenue ? base.shared / (base.gross / base.revenue) : null, bepSc = sc.gross && sc.revenue ? sc.shared / (sc.gross / sc.revenue) : null;
  return { base, sc, fb, fs, minB, minS, needB: Math.max(0, min - minB), needS: Math.max(0, min - minS + invDelta), invDelta, closeB: fb.closing, closeS: fs.closing - invDelta, bepBase, bepSc };
}
export async function render(params, nav) {
  const edit = allow('scenario', 'edit'), list = state.db.scenarios; ST.sel ||= list[0]?.id; const cur = list.find((s) => s.id === ST.sel) || list[0];
  const head = ph('Kịch bản phân bổ vốn', 'Giả định tách khỏi dữ liệu thực • Lưu người tạo, thời gian, biến số, ghi chú • Cơ sở so sánh: trung bình 3 tháng đã chốt', edit ? h('button', { class: 'btn', onclick: () => form(nav) }, '+ Tạo kịch bản') : null);
  const tbl = card('Danh sách kịch bản', dataTable({ cols: [{ key: 'n', label: 'Tên', render: (s) => h('b', null, s.name), sortVal: (s) => s.name }, { key: 'by', label: 'Người tạo', render: (s) => usr(s.createdBy) }, { key: 'd', label: 'Ngày', render: (s) => fmtDate(s.createdAt) }], rows: list, onRow: (s) => { ST.sel = s.id; nav.refresh(); }, pageSize: 6, rowClass: (s) => (s.id === cur?.id ? 'rowamber' : ''), empty: 'Chưa có kịch bản' }));
  if (!cur) return h('div', null, head, tbl);
  const r = runScenario(cur.vars), row = (label, a, b, f = fmt, bad = (x, y) => y < x) => h('tr', null, h('td', null, label), h('td', { class: 'num' }, f(a)), h('td', { class: 'num ' + (bad(a, b) ? 'red-t' : 'green-t') }, f(b)), h('td', { class: 'num' }, typeof a === 'number' && typeof b === 'number' ? (b - a >= 0 ? '+' : '') + fmt(b - a) : ''));
  const detail = card('Tác động: ' + cur.name, h('div', null, h('p', { class: 'note' }, 'Giả định: ' + VARS.filter(([k]) => cur.vars[k] != null && cur.vars[k] !== (VARS.find((x) => x[0] === k)[2])).map(([k, l]) => `${l} = ${cur.vars[k]}`).join('; ') + (cur.note ? ' • ' + cur.note : '')),
    h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Chỉ tiêu (bình quân tháng)', 'Cơ sở', 'Kịch bản', 'Chênh lệch'].map((x) => h('th', null, x)))), h('tbody', null, row('Doanh thu thuần', r.base.revenue, r.sc.revenue), row('Giá vốn', r.base.cogs, r.sc.cogs, fmt, (a, b) => b > a), row('Lãi gộp', r.base.gross, r.sc.gross), row('Biên lãi gộp (%)', r.base.margin, r.sc.margin, (x) => (x == null ? 'N/A' : x.toFixed(1)), (a, b) => b < a), row('Lợi nhuận quản trị', r.base.profit, r.sc.profit), row('Tiền cuối tuần 13 (dự báo)', r.closeB, r.closeS), row('Số dư thấp nhất trong 13 tuần', r.minB, r.minS - r.invDelta), row('Nhu cầu vốn (đến ngưỡng tiền tối thiểu)', r.needB, r.needS, fmt, (a, b) => b > a), row('Doanh thu hòa vốn/tháng (điểm hòa vốn)', r.bepBase ?? 0, r.bepSc ?? 0, fmt, (a, b) => b > a))),
    h('p', { class: 'note', style: { marginTop: '8px' } }, 'Công thức: Doanh thu′ = DT × (1+Δsản lượng) × (1+Δgiá bán); Giá vốn′ = GV × (1+Δsản lượng) × (1+Δgiá mua); CP chung′ = CP chung × (1+Δ). Dòng tiền dùng dự báo 13 tuần với tỷ lệ/độ trễ thu tiền của kịch bản; thay đổi tồn kho trừ vào tiền. Điểm hòa vốn = CP chung / biên lãi gộp (chỉ tham khảo – chưa phân tách chi phí cố định/biến đổi chính thức, FR-SCN-03).'), badge('GIẢ ĐỊNH – không phải số thực tế', 'amber')));
  return h('div', null, head, h('div', { class: 'grid g12' }, tbl, detail));
}
function form(nav) {
  formModal({ title: 'Tạo kịch bản', wide: true, fields: [{ name: 'name', label: 'Tên kịch bản', required: true, full: true }, ...VARS.map(([k, l, d]) => ({ name: k, label: l, type: 'number', value: d })), { name: 'note', label: 'Ghi chú/giả định', type: 'textarea', full: true }], onSubmit: (v) => { const { name, note, ...vars } = v; const s = saveScenario({ name, note, vars }); ST.sel = s.id; toast('Đã lưu kịch bản'); nav.refresh(); } });
}
