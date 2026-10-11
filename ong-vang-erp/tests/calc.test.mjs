import test from 'node:test';
import assert from 'node:assert/strict';
import { orderTotals, marginPct, balance, daysOverdue, agingBucket, agingSummary, buildForecast, weekStatus, inventoryPosition, allocateShared, coffeeLotResult, expectedCollection, lotsRemaining, inventoryTurnover, dso } from '../js/core/calc.js';
import { addDays, weekStart, diffDays } from '../js/core/dates.js';

test('BR-01/02: doanh thu thuần, lãi gộp, biên (N/A khi doanh thu = 0)', () => {
  const o = { lines: [{ qty: 100, price: 1000, discount: 0.1, cost: 700 }], returns: 5000, directCost: 2000 };
  const t = orderTotals(o);
  assert.equal(t.gross, 100000); assert.equal(t.discount, 10000); assert.equal(t.net, 100000 - 10000 - 5000);
  assert.equal(t.cogs, 70000); assert.equal(t.grossProfit, 85000 - 70000); assert.equal(t.contribution, 15000 - 2000);
  assert.ok(Math.abs(t.margin - (15000 / 85000) * 100) < 1e-9);
  assert.equal(marginPct(10, 0), null);
});
test('BR-04/05: còn phải thu, tuổi nợ; chưa đến hạn không bị đánh dấu quá hạn', () => {
  const inv = { amount: 1000, payments: [{ amount: 300 }], dueDate: '2024-11-10' };
  assert.equal(balance(inv), 700);
  assert.equal(daysOverdue(inv, '2024-11-20'), 10); assert.equal(daysOverdue(inv, '2024-11-01'), -9);
  assert.equal(agingBucket(-9), 'current'); assert.equal(agingBucket(0), 'current');
  assert.equal(agingBucket(1), 'b1'); assert.equal(agingBucket(7), 'b1'); assert.equal(agingBucket(8), 'b2'); assert.equal(agingBucket(30), 'b2'); assert.equal(agingBucket(31), 'b3'); assert.equal(agingBucket(61), 'b4'); assert.equal(agingBucket(500), 'b4');
  const s = agingSummary([inv, { amount: 500, payments: [], dueDate: '2024-12-01' }, { amount: 100, payments: [{ amount: 100 }], dueDate: '2024-01-01' }], '2024-11-20');
  assert.equal(s.overdue, 700); assert.equal(s.current, 500); assert.equal(s.total, 1200);
});
test('BR-03: số dư cuối tuần = đầu + thu − chi; trạng thái theo ngưỡng', () => {
  const start = '2024-11-04'; // thứ Hai
  const f = buildForecast({ opening: 1000, startDate: start, weeks: 3, minCash: 500, attentionCash: 800, inflows: [{ date: '2024-11-05', amount: 200 }, { date: '2024-11-12', amount: 100 }], outflows: [{ date: '2024-11-06', amount: 900 }, { date: '2024-11-20', amount: 400 }, { date: '2024-10-01', amount: 50 }] });
  assert.deepEqual(f.weeks.map((w) => w.closing), [1000 + 200 - 900 - 50, 250 + 100, 350 - 400]);
  assert.deepEqual(f.weeks.map((w) => w.status), ['alert', 'alert', 'risk']);
  assert.equal(f.totalIn, 300); assert.equal(f.totalOut, 1350);
  assert.equal(weekStatus(900, { minCash: 500, attentionCash: 800 }), 'safe'); assert.equal(weekStatus(700, { minCash: 500, attentionCash: 800 }), 'watch'); assert.equal(weekStatus(500, { minCash: 500, attentionCash: 800 }), 'watch'); assert.equal(weekStatus(499, { minCash: 500, attentionCash: 800 }), 'alert'); assert.equal(weekStatus(-1, { minCash: 0, attentionCash: 0 }), 'risk');
  assert.equal(weekStart('2024-11-10'), '2024-11-04'); assert.equal(weekStart('2024-11-04'), '2024-11-04');
});
test('Thu dự kiến: không tự đoán khoản quá hạn chưa cam kết', () => {
  const inv = { amount: 1000, payments: [], dueDate: '2024-11-01' };
  assert.equal(expectedCollection(inv, null, '2024-11-10'), null);
  assert.deepEqual(expectedCollection(inv, { promiseDate: '2024-11-15' }, '2024-11-10', { collectionPct: 0.5, delayDays: 7 }), { date: '2024-11-22', amount: 500 });
  assert.equal(expectedCollection({ ...inv, dueDate: '2024-11-20' }, null, '2024-11-10').date, '2024-11-20');
});
test('Tồn kho: bình quân gia quyền và FIFO', () => {
  const tx = [{ date: '2024-01-01', type: 'in', product: 'A', wh: 'K1', qty: 10, unitCost: 100 }, { date: '2024-01-02', type: 'in', product: 'A', wh: 'K1', qty: 10, unitCost: 200 }, { date: '2024-01-03', type: 'out', product: 'A', wh: 'K1', qty: 5 }];
  const avg = inventoryPosition(tx, 'avg').A; assert.equal(avg.qty, 15); assert.equal(avg.avg, 150); assert.equal(avg.value, 15 * 150);
  const fifo = inventoryPosition(tx, 'fifo').A; assert.equal(fifo.qty, 15); assert.equal(fifo.value, 5 * 100 + 10 * 200);
  const tr = inventoryPosition([...tx, { date: '2024-01-04', type: 'transfer', product: 'A', wh: 'K1', toWh: 'K2', qty: 4 }], 'avg').A; assert.equal(tr.byWh.K1, 11 - 0 - 0 + 0 - 0 + 0 - 0 + 0 - 0 + 0 - 0 + 0); assert.equal(tr.byWh.K2, 4); assert.equal(tr.qty, 15);
  const adj = inventoryPosition([...tx, { date: '2024-01-04', type: 'adjust', product: 'A', wh: 'K1', qty: -3 }], 'avg').A; assert.equal(adj.qty, 12);
  assert.equal(inventoryTurnover(1200, 100), 12); assert.equal(inventoryTurnover(1, 0), null); assert.equal(dso(50, 100, 90), 45);
});
test('Tồn theo lô FEFO', () => {
  const tx = [{ date: '2024-01-01', type: 'in', product: 'A', qty: 10, lot: 'L1', expiry: '2024-06-01' }, { date: '2024-01-02', type: 'in', product: 'A', qty: 10, lot: 'L2', expiry: '2024-03-01' }, { date: '2024-01-03', type: 'out', product: 'A', qty: 12 }];
  const r = lotsRemaining(tx, 'A'); assert.deepEqual(r.map((l) => [l.lot, l.qty]), [['L1', 8]]);
});
test('BR-09: phân bổ chi phí chung không cộng trùng (tổng phân bổ = tổng chi phí chung)', () => {
  const ids = ['a', 'b', 'c'];
  for (const m of ['revenue', 'direct', 'equal', 'manual']) { const r = allocateShared(900, ids, m, { revenue: { a: 1, b: 2, c: 3 }, direct: { a: 3, b: 3, c: 3 }, manual: { a: 50, b: 30, c: 20 } }); assert.ok(Math.abs(Object.values(r).reduce((x, y) => x + y, 0) - 900) < 1e-6, m); }
  assert.deepEqual(allocateShared(600, ids, 'revenue', { revenue: { a: 1, b: 2, c: 3 } }), { a: 100, b: 200, c: 300 });
  assert.deepEqual(allocateShared(100, ids, 'revenue', { revenue: {} }), { a: 0, b: 0, c: 0 });
});
test('Lô cà phê khớp màn hình mẫu: 5.000kg × 42.000 + 6,2 triệu => 43.240 đ/kg, 216,2 triệu', () => {
  const lot = { kg: 5000, pricePerKg: 42000, costs: [{ amount: 2500000 }, { amount: 3000000 }, { amount: 500000 }, { amount: 200000 }] };
  const r = coffeeLotResult(lot); assert.equal(r.total, 216200000); assert.equal(r.unitCost, 43240); assert.equal(r.provisional, true); assert.equal(r.profit, null);
  const sold = coffeeLotResult({ ...lot, outKg: 4900, sale: { kg: 4900, pricePerKg: 50000 } }); assert.equal(sold.profit, 4900 * 50000 - 216200000); assert.equal(sold.provisional, false);
});
