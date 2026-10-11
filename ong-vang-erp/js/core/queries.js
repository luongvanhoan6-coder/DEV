// Truy vấn tổng hợp (đọc) dùng chung cho dashboard, báo cáo, cảnh báo, AI. Mọi KPI trả kèm công thức/nguồn ở UI.
import { state, settings, stockPosition } from './store.js';
import { orderTotals, balance, daysOverdue, agingBucket, agingSummary, buildForecast, expectedCollection, allocateShared, inventoryTurnover, dso, lotsRemaining } from './calc.js';
import { today, addDays, addMonths, monthKey, diffDays } from './dates.js';
import { sum } from './format.js';

const D = () => state.db;
export const T = () => today();
export const revDate = (o) => o.deliveredAt || o.date;
export const isRevenue = (o) => o.status === 'delivered' || o.status === 'completed';
export const nameOf = (coll, id) => D()[coll].find((x) => x.id === id)?.name || id || '–';
export const months = (n = 12, end = monthKey(T())) => Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1));

export function ordersIn(period, f = {}) {
  return D().salesOrders.filter((o) => isRevenue(o) && (!period || monthKey(revDate(o)) === period) && (!f.segmentId || o.segmentId === f.segmentId) && (!f.customerId || o.customerId === f.customerId) && (!f.productId || o.lines.some((l) => l.productId === f.productId)) && (!f.whId || o.whId === f.whId) && (!f.scope || f.scope.includes(o.segmentId)));
}
const expIn = (period, pred = () => true) => D().expenses.filter((e) => e.status === 'approved' && (!period || monthKey(e.date) === period) && pred(e));

// Thống kê kỳ: BR-01/02/09. Chi phí chung chỉ tính vào tổng toàn công ty hoặc qua phân bổ theo mảng.
export function periodStats(period, f = {}) {
  const os = ordersIn(period, f), ts = os.map(orderTotals);
  const revenue = sum(ts, (t) => t.net), cogs = sum(ts, (t) => t.cogs), gross = revenue - cogs;
  const directOrder = sum(ts, (t) => t.direct);
  const directExp = sum(expIn(period, (e) => e.scope === 'direct' && (!f.segmentId || e.segmentId === f.segmentId) && (!f.scope || f.scope.includes(e.segmentId))), (e) => e.amount);
  const direct = directOrder + directExp;
  const sharedAll = sum(expIn(period, (e) => e.scope === 'shared'), (e) => e.amount);
  let shared = sharedAll;
  if (f.segmentId || f.scope) { const ids = f.segmentId ? [f.segmentId] : f.scope; shared = sum(ids, (s) => profitBySegment(period).find((x) => x.id === s)?.allocated || 0); }
  return { revenue, cogs, gross, margin: revenue ? (gross / revenue) * 100 : null, direct, contribution: gross - direct, shared, profit: gross - direct - shared, orders: os.length };
}
export function profitBySegment(period, range = null) {
  const pds = range || [period];
  const rows = D().segments.map((s) => {
    const os = pds.flatMap((p) => ordersIn(p, { segmentId: s.id })), ts = os.map(orderTotals);
    const revenue = sum(ts, (t) => t.net), cogs = sum(ts, (t) => t.cogs);
    const direct = sum(ts, (t) => t.direct) + sum(pds.flatMap((p) => expIn(p, (e) => e.scope === 'direct' && e.segmentId === s.id)), (e) => e.amount);
    return { id: s.id, name: s.name, color: s.color, revenue, cogs, gross: revenue - cogs, margin: revenue ? ((revenue - cogs) / revenue) * 100 : null, direct, contribution: revenue - cogs - direct };
  });
  const shared = sum(pds.flatMap((p) => expIn(p, (e) => e.scope === 'shared')), (e) => e.amount);
  const st = settings(), al = allocateShared(shared, rows.map((r) => r.id), st.allocationMethod, { revenue: Object.fromEntries(rows.map((r) => [r.id, r.revenue])), direct: Object.fromEntries(rows.map((r) => [r.id, r.direct])), manual: st.manualAlloc });
  rows.forEach((r) => { r.allocated = al[r.id]; r.profit = r.contribution - r.allocated; r.profitMargin = r.revenue ? (r.profit / r.revenue) * 100 : null; });
  return rows;
}
export const monthlySeries = (f = {}, n = 12) => months(n).map((m) => ({ month: m, ...periodStats(m, f) }));

// ---- Tiền ----
export const accountBalance = (id) => { const a = D().cashAccounts.find((x) => x.id === id); return a.opening + sum(D().cashTx.filter((t) => t.accountId === id), (t) => (t.direction === 'in' ? t.amount : -t.amount)); };
export const cashBalance = () => sum(D().cashAccounts, (a) => accountBalance(a.id));
export const unreconciled = () => D().cashTx.filter((t) => !t.reconciledAt);

// ---- Công nợ ----
export const arInvoices = () => D().invoices.filter((i) => i.direction === 'AR');
export const apInvoices = () => D().invoices.filter((i) => i.direction === 'AP');
export function arByCustomer(user) {
  const asOf = T(), bands = settings().agingBands, map = {};
  for (const inv of arInvoices()) {
    const bal = balance(inv); if (bal <= 0) continue;
    const c = D().customers.find((x) => x.id === inv.partyId); if (user?.role === 'kinhdoanh' && c.ownerId !== user.id) continue;
    const r = (map[c.id] ||= { id: c.id, name: c.name, customer: c, total: 0, overdue: 0, maxDays: 0, invoices: [], buckets: {} });
    const days = daysOverdue(inv, asOf), b = agingBucket(days, bands);
    r.total += bal; r.invoices.push({ inv, bal, days, bucket: b });
    r.buckets[b] = (r.buckets[b] || 0) + bal;
    if (days > 0) { r.overdue += bal; r.maxDays = Math.max(r.maxDays, days); }
  }
  return Object.values(map).map((r) => ({ ...r, status: r.overdue > 0 ? 'overdue' : 'ontime', overLimit: r.total > r.customer.creditLimit })).sort((a, b) => b.total - a.total);
}
export const arAging = (rows) => agingSummary(rows ? rows.flatMap((r) => r.invoices.map((x) => x.inv)) : arInvoices(), T(), settings().agingBands);
export const apAging = () => agingSummary(apInvoices(), T(), settings().agingBands);

// ---- Dự báo dòng tiền 13 tuần (FR-CF-*) ----
export function forecast(scenarioKey = 'base', overrides = null) {
  const st = settings(), sc = overrides || st.forecastScenarios[scenarioKey] || st.forecastScenarios.base, asOf = T();
  const inflows = [], outflows = [], unforecast = [];
  for (const inv of arInvoices()) {
    const cm = D().commitments.filter((c) => c.invoiceId === inv.id && c.status === 'open').sort((a, b) => b.promiseDate.localeCompare(a.promiseDate))[0];
    const e = expectedCollection(inv, cm, asOf, sc);
    if (e) inflows.push({ ...e, label: nameOf('customers', inv.partyId) + ' – ' + inv.no, ref: inv.id, committed: !!cm });
    else if (balance(inv) > 0) unforecast.push({ inv, amount: balance(inv) });
  }
  for (const inv of apInvoices()) { const bal = balance(inv); if (bal > 0) outflows.push({ date: addDays(inv.dueDate, 0) < asOf ? asOf : inv.dueDate, amount: bal, label: nameOf('suppliers', inv.partyId) + ' – ' + inv.no, ref: inv.id }); }
  // chi phí định kỳ
  for (let w = 0; w < 13 * 7; w++) { const d = addDays(asOf, w); for (const rc of D().recurring) if (+d.slice(8, 10) === rc.day) outflows.push({ date: d, amount: rc.amount * (sc.costPct ?? 1), label: rc.name, ref: rc.id, recurring: true }); }
  const fc = buildForecast({ opening: cashBalance(), startDate: asOf, inflows, outflows, minCash: st.minCash, attentionCash: st.attentionCash });
  return { ...fc, unforecast, scenario: sc, opening: cashBalance() };
}

// ---- Tồn kho ----
export function inventoryView() {
  const st = settings(), pos = stockPosition(), asOf = T(), out = [];
  const lastOut = {}; D().invTx.forEach((t) => { if (t.type === 'out' && (!lastOut[t.product] || t.date > lastOut[t.product])) lastOut[t.product] = t.date; });
  for (const p of D().products) {
    const ps = pos[p.id] || { qty: 0, value: 0, avg: 0, byWh: {} };
    const lots = p.expiryTracked ? lotsRemaining(D().invTx, p.id) : [];
    const expired = lots.filter((l) => l.expiry && l.expiry < asOf), expiring = lots.filter((l) => l.expiry && l.expiry >= asOf && diffDays(l.expiry, asOf) <= st.expiryDays);
    const idle = lastOut[p.id] ? diffDays(asOf, lastOut[p.id]) : 9999;
    let status = 'normal';
    if (expired.length) status = 'expired'; else if (ps.qty <= p.minQty) status = 'low'; else if (idle > st.slowDays && ps.qty > 0) status = 'slow'; else if (expiring.length) status = 'expiring';
    out.push({ p, qty: ps.qty, value: ps.value, avg: ps.avg, byWh: ps.byWh, lots, expired, expiring, idle, status });
  }
  return out;
}
export function workingCapital(period = monthKey(T())) {
  const inv = inventoryView(), invValue = sum(inv, (x) => x.value);
  const last3 = months(3, period).flatMap((m) => ordersIn(m)).map(orderTotals);
  const cogs3 = sum(last3, (t) => t.cogs), rev3 = sum(last3, (t) => t.net);
  const ar = sum(arInvoices(), balance), ap = sum(apInvoices(), balance);
  return { invValue, ar, ap, turnover: inventoryTurnover(cogs3 * 4, invValue), dso: dso(ar, rev3, 90), cogs3, rev3, net: invValue + ar - ap };
}

// ---- Ngân sách ----
export function budgetRows(period, f = {}) {
  const cats = new Map();
  for (const b of D().budgets.filter((x) => x.period === period && (!f.segmentId || x.segmentId === f.segmentId))) { const k = (b.segmentId || '') + '|' + b.category; cats.set(k, { segmentId: b.segmentId, category: b.category, budget: (cats.get(k)?.budget || 0) + b.amount }); }
  return [...cats.values()].map((r) => {
    const actual = sum(expIn(period, (e) => (r.segmentId ? e.segmentId === r.segmentId && e.scope === 'direct' : e.scope === 'shared' && e.category === r.category)), (e) => e.amount);
    return { ...r, actual, diff: actual - r.budget, ratio: r.budget ? (actual / r.budget) * 100 : null };
  }).sort((a, b) => (b.ratio || 0) - (a.ratio || 0));
}

// ---- Cảnh báo (rule-based, dẫn nguồn) – dùng cho dashboard & Trợ lý AI ----
export function buildAlerts() {
  const st = settings(), A = [], asOf = T(), M = (n) => (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' triệu';
  const fc = forecast('base');
  const bad = fc.weeks.filter((w) => w.status === 'risk' || w.status === 'alert');
  if (bad.length) { const w = bad[0]; A.push({ id: 'cash', sev: w.status === 'risk' ? 'high' : 'med', kind: 'forecast', title: `Dự báo tuần ${w.idx + 1} số dư ${w.closing < 0 ? 'âm' : 'dưới ngưỡng'} (${M(w.closing)})`, detail: `Số dư cuối tuần ${w.idx + 1} dự kiến ${M(w.closing)}, ngưỡng cấu hình ${M(st.minCash)}. Chi lớn nhất: ${[...w.outItems].sort((a, b) => b.amount - a.amount).slice(0, 2).map((x) => x.label + ' ' + M(x.amount)).join('; ') || 'n/a'}.`, page: 'cashflow', link: '#/cashflow', action: { text: 'Đẩy nhanh thu hồi công nợ quá hạn hoặc dời lịch chi không cấp thiết', owner: 'Kế toán', priority: 'Cao' } }); }
  const ar = arByCustomer(), ov = sum(ar, (r) => r.overdue), tot = sum(ar, (r) => r.total);
  if (ov > 0) { const top = [...ar].sort((a, b) => b.overdue - a.overdue).slice(0, 3); A.push({ id: 'ar', sev: ov / tot > 0.25 ? 'high' : 'med', kind: 'actual', title: `Nợ quá hạn ${M(ov)} (${tot ? ((ov / tot) * 100).toFixed(0) : 0}% tổng phải thu)`, detail: top.map((r) => `${r.name}: ${M(r.overdue)} (${r.maxDays} ngày)`).join('; '), page: 'ar', link: '#/ar', top, action: { text: 'Ưu tiên liên hệ nhóm khách quá hạn lớn nhất, ghi nhận cam kết thanh toán', owner: 'Kinh doanh / Kế toán', priority: 'Cao', impact: ov } }); }
  ar.filter((r) => r.overLimit).slice(0, 2).forEach((r) => A.push({ id: 'limit' + r.id, sev: 'med', kind: 'actual', title: `${r.name} vượt hạn mức tín dụng`, detail: `Dư nợ ${M(r.total)} > hạn mức ${M(r.customer.creditLimit)}.`, page: 'ar', link: '#/ar', action: { text: 'Tạm dừng đơn mới hoặc yêu cầu duyệt ngoại lệ', owner: 'Kinh doanh', priority: 'Trung bình' } }));
  const inv = inventoryView(), low = inv.filter((x) => x.status === 'low'), exp = inv.filter((x) => x.status === 'expired'), slow = inv.filter((x) => x.status === 'slow');
  if (exp.length) A.push({ id: 'exp', sev: 'high', kind: 'actual', title: `${exp.length} mặt hàng có lô quá hạn dùng`, detail: exp.slice(0, 3).map((x) => x.p.name).join('; '), page: 'inventory', link: '#/inventory?tab=expired', action: { text: 'Cách ly, xử lý theo quy định; không bán', owner: 'Kho', priority: 'Cao' } });
  if (low.length) A.push({ id: 'low', sev: 'med', kind: 'actual', title: `${low.length} mặt hàng sắp hết (dưới mức tối thiểu)`, detail: low.slice(0, 3).map((x) => `${x.p.name} (${x.qty})`).join('; '), page: 'inventory', link: '#/inventory?tab=low', action: { text: 'Lập đề nghị mua bổ sung', owner: 'Thu mua', priority: 'Trung bình' } });
  if (slow.length) A.push({ id: 'slow', sev: 'low', kind: 'actual', title: `${slow.length} mặt hàng chậm luân chuyển (> ${st.slowDays} ngày không xuất)`, detail: `Vốn nằm trong tồn: ${M(sum(slow, (x) => x.value))}.`, page: 'inventory', link: '#/inventory?tab=slow', action: { text: 'Xem xét khuyến mãi/trả hàng NCC', owner: 'Quản lý mảng', priority: 'Thấp', impact: sum(slow, (x) => x.value) } });
  const cur = monthKey(asOf), over = budgetRows(cur).filter((r) => r.ratio != null && r.ratio > st.budgetWarnPct);
  if (over.length) A.push({ id: 'bud', sev: 'med', kind: 'actual', title: `${over.length} khoản chi vượt ngân sách tháng ${cur.slice(5)}`, detail: over.slice(0, 3).map((r) => `${r.segmentId ? nameOf('segments', r.segmentId) : r.category}: ${r.ratio.toFixed(0)}%`).join('; '), page: 'budget', link: '#/budget', action: { text: 'Yêu cầu giải trình', owner: 'Quản lý mảng', priority: 'Trung bình' } });
  const lowMargin = D().salesOrders.filter((o) => isRevenue(o) && monthKey(revDate(o)) === cur).filter((o) => { const m = orderTotals(o).margin; return m != null && m < st.marginThreshold; });
  if (lowMargin.length) A.push({ id: 'margin', sev: 'low', kind: 'actual', title: `${lowMargin.length} đơn tháng này có biên lãi gộp dưới ${st.marginThreshold}%`, detail: lowMargin.slice(0, 4).map((o) => o.id).join(', '), page: 'sales', link: '#/sales', action: { text: 'Rà soát giá bán/chiết khấu', owner: 'Kinh doanh', priority: 'Thấp' } });
  const apDue = apInvoices().filter((i) => balance(i) > 0 && diffDays(i.dueDate, asOf) <= 7);
  if (apDue.length) A.push({ id: 'apdue', sev: 'med', kind: 'actual', title: `Phải trả đến hạn trong 7 ngày: ${M(sum(apDue, balance))}`, detail: `${apDue.length} chứng từ; số dư tiền hiện có ${M(cashBalance())}.`, page: 'ap', link: '#/ap', action: { text: 'Lập đề nghị thanh toán theo thứ tự ưu tiên', owner: 'Kế toán', priority: 'Trung bình' } });
  const un = unreconciled(); if (un.length) A.push({ id: 'recon', sev: 'low', kind: 'actual', title: `${un.length} giao dịch tiền chưa đối soát`, detail: 'Số dư tiền hiện tại gồm giao dịch chưa đối soát – chưa phải số chốt.', page: 'cashflow', link: '#/cashflow?tab=txs', action: { text: 'Đối soát với sao kê ngân hàng', owner: 'Kế toán', priority: 'Thấp' } });
  return A.sort((a, b) => ({ high: 0, med: 1, low: 2 }[a.sev] - { high: 0, med: 1, low: 2 }[b.sev]));
}
