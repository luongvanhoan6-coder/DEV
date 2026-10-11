// Công thức nghiệp vụ thuần (không phụ thuộc UI/store) – được kiểm thử trong tests/
import { diffDays, addDays, weekStart } from './dates.js';
import { sum } from './format.js';

// ---- BR-01/02: doanh thu thuần, lãi gộp, biên ----
export const lineGross = (l) => l.qty * l.price;
export const lineDiscount = (l) => lineGross(l) * (l.discount || 0); // discount: tỷ lệ 0..1
export function orderTotals(o) {
  const gross = sum(o.lines, lineGross);
  const discount = sum(o.lines, lineDiscount);
  const returns = o.returns || 0;
  const net = gross - discount - returns; // doanh thu thuần = trước thuế
  const cogs = sum(o.lines, (l) => l.qty * (l.cost || 0)); // giá vốn theo snapshot
  const grossProfit = net - cogs;
  const direct = o.directCost || 0;
  return { gross, discount, returns, net, cogs, grossProfit, margin: marginPct(grossProfit, net), direct, contribution: grossProfit - direct };
}
export const marginPct = (profit, revenue) => (revenue ? (profit / revenue) * 100 : null);

// ---- BR-04/05: công nợ & tuổi nợ ----
export const paid = (inv) => sum(inv.payments || [], (p) => p.amount);
export const balance = (inv) => inv.amount - paid(inv);
export const daysOverdue = (inv, asOf) => diffDays(asOf, inv.dueDate); // >0 là quá hạn; <=0 chưa đến hạn
export const DEFAULT_AGING = [
  { key: 'b1', label: '1–7 ngày', from: 1, to: 7 },
  { key: 'b2', label: '8–30 ngày', from: 8, to: 30 },
  { key: 'b3', label: '31–60 ngày', from: 31, to: 60 },
  { key: 'b4', label: 'Trên 60 ngày', from: 61, to: null },
];
export function agingBucket(days, bands = DEFAULT_AGING) {
  if (days <= 0) return 'current'; // BR-05: chưa đến hạn không bị đánh dấu quá hạn
  const b = bands.find((x) => days >= x.from && (x.to == null || days <= x.to));
  return b ? b.key : bands[bands.length - 1].key;
}
export function agingSummary(invoices, asOf, bands = DEFAULT_AGING) {
  const out = { current: 0, overdue: 0, total: 0 };
  bands.forEach((b) => (out[b.key] = 0));
  for (const inv of invoices) {
    const bal = balance(inv);
    if (bal <= 0) continue;
    const k = agingBucket(daysOverdue(inv, asOf), bands);
    out[k] += bal;
    out.total += bal;
    if (k !== 'current') out.overdue += bal;
  }
  return out;
}

// ---- BR-03: dự báo dòng tiền 13 tuần cuốn chiếu ----
export function weekStatus(closing, { minCash, attentionCash }) {
  if (closing < 0) return 'risk'; // Nguy cơ
  if (closing < minCash) return 'alert'; // Cảnh báo
  if (closing < attentionCash) return 'watch'; // Cần chú ý
  return 'safe'; // An toàn
}
export function buildForecast({ opening, startDate, weeks = 13, inflows = [], outflows = [], minCash = 0, attentionCash = 0 }) {
  const start = weekStart(startDate);
  const rows = Array.from({ length: weeks }, (_, i) => ({ idx: i, start: addDays(start, i * 7), end: addDays(start, i * 7 + 6), in: 0, out: 0, inItems: [], outItems: [] }));
  const place = (it, key, list) => {
    let w = Math.floor(diffDays(it.date, start) / 7);
    if (w < 0) w = 0; // khoản đã đến hạn tính vào tuần đầu
    if (w >= weeks) return;
    rows[w][key] += it.amount;
    rows[w][list].push(it);
  };
  inflows.forEach((it) => place(it, 'in', 'inItems'));
  outflows.forEach((it) => place(it, 'out', 'outItems'));
  let bal = opening;
  for (const r of rows) {
    r.opening = bal;
    r.closing = bal + r.in - r.out; // số dư cuối = đầu + thu - chi
    bal = r.closing;
    r.status = weekStatus(r.closing, { minCash, attentionCash });
  }
  return { weeks: rows, totalIn: sum(rows, (r) => r.in), totalOut: sum(rows, (r) => r.out), closing: bal };
}
// Ngày thu dự kiến của 1 khoản phải thu theo cam kết/hạn + kịch bản. Trả null nếu quá hạn mà chưa cam kết (không tự đoán).
export function expectedCollection(inv, commitment, asOf, scenario = { collectionPct: 1, delayDays: 0 }) {
  const bal = balance(inv);
  if (bal <= 0) return null;
  const base = commitment && commitment.promiseDate >= asOf ? commitment.promiseDate : inv.dueDate >= asOf ? inv.dueDate : null;
  if (!base) return null;
  return { date: addDays(base, scenario.delayDays || 0), amount: bal * (scenario.collectionPct ?? 1) };
}

// ---- Tồn kho: định giá theo phương pháp cấu hình (BR-06) ----
// tx: {date,type:'in'|'out'|'adjust'|'transfer'|'return', product, wh, toWh, qty, unitCost}
export function inventoryPosition(txs, method = 'avg') {
  const sorted = [...txs].sort((a, b) => (a.date + (a.seq || 0)).localeCompare(b.date + (b.seq || 0)));
  const pos = {}; // product -> {qty, value, avg, layers, byWh, lastOut, lastIn}
  const P = (p) => (pos[p] ||= { qty: 0, value: 0, avg: 0, layers: [], byWh: {}, lastOut: null, lastIn: null });
  for (const t of sorted) {
    const p = P(t.product);
    const wh = (w, d) => (p.byWh[w] = (p.byWh[w] || 0) + d);
    if (t.type === 'transfer') { wh(t.wh, -t.qty); wh(t.toWh, t.qty); continue; }
    const delta = t.type === 'in' || t.type === 'return' ? t.qty : t.type === 'out' ? -t.qty : t.qty; // adjust: qty có dấu
    if (delta > 0) {
      const cost = t.unitCost ?? p.avg;
      p.layers.push({ qty: delta, cost });
      p.value += delta * cost;
      p.qty += delta;
      p.lastIn = t.date;
    } else if (delta < 0) {
      let need = -delta, val = 0;
      if (method === 'fifo') {
        while (need > 0 && p.layers.length) {
          const l = p.layers[0], take = Math.min(l.qty, need);
          val += take * l.cost; l.qty -= take; need -= take;
          if (l.qty <= 1e-9) p.layers.shift();
        }
        val += need * p.avg; // âm kho: dùng giá gần nhất
      } else val = -delta * p.avg;
      p.value -= val;
      p.qty += delta;
      if (t.type === 'out') p.lastOut = t.date;
    }
    wh(t.wh, delta);
    p.avg = method === 'fifo' ? (p.layers[0]?.cost ?? p.avg) : p.qty > 0 ? p.value / p.qty : p.avg;
    if (method !== 'fifo') p.layers = [{ qty: Math.max(p.qty, 0), cost: p.avg }];
  }
  return pos;
}
export const inventoryTurnover = (cogs, avgInventory) => (avgInventory ? cogs / avgInventory : null); // BR-07
export const dso = (arBalance, revenue, days) => (revenue ? (arBalance / revenue) * days : null); // BR-08

// ---- Phân bổ chi phí chung (BR-09) ----
export function allocateShared(total, segmentIds, method, { revenue = {}, direct = {}, manual = {} } = {}) {
  const w = {};
  segmentIds.forEach((s) => {
    w[s] = method === 'revenue' ? Math.max(revenue[s] || 0, 0) : method === 'direct' ? Math.max(direct[s] || 0, 0) : method === 'manual' ? manual[s] || 0 : 1;
  });
  const tw = sum(Object.values(w));
  const out = {};
  segmentIds.forEach((s) => (out[s] = tw ? (total * w[s]) / tw : 0));
  return out;
}

// ---- Ngân sách ----
export const budgetVariance = (budget, actual) => ({ budget, actual, diff: actual - budget, ratio: budget ? (actual / budget) * 100 : null });

// ---- Lô cà phê (FR-COF-01..06): giá vốn thực tế = (tiền mua + chi phí liên quan) / khối lượng thành phẩm ----
export function coffeeLotResult(lot) {
  const buy = lot.kg * lot.pricePerKg;
  const costs = sum(lot.costs || [], (c) => c.amount);
  const outKg = lot.outKg || lot.kg;
  const total = buy + costs;
  const sold = lot.sale ? lot.sale.kg * lot.sale.pricePerKg : 0;
  return {
    buy, costs, total, outKg,
    unitCost: outKg ? total / outKg : null,
    shrinkPct: lot.kg ? ((lot.kg - outKg) / lot.kg) * 100 : null,
    sold, profit: lot.sale ? sold - total : null,
    provisional: !lot.sale, // lô chưa bán => tạm tính
  };
}

// Tồn theo lô (FEFO: lô hết hạn sớm nhất xuất trước – quy tắc mặc định, cần xác nhận)
export function lotsRemaining(txs, product) {
  const ts = txs.filter((t) => t.product === product).sort((a, b) => a.date.localeCompare(b.date));
  const lots = [];
  for (const t of ts) {
    if (t.type === 'in' && t.lot) lots.push({ lot: t.lot, expiry: t.expiry || null, qty: t.qty });
    else if ((t.type === 'out' || (t.type === 'adjust' && t.qty < 0)) && lots.length) {
      let need = Math.abs(t.qty);
      const order = lots.filter((l) => l.qty > 0).sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
      for (const l of order) { const k = Math.min(l.qty, need); l.qty -= k; need -= k; if (need <= 0) break; }
    }
  }
  return lots.filter((l) => l.qty > 0);
}
