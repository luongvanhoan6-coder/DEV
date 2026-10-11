// Kiểm tra logic sâu: bất biến dữ liệu, đối soát chéo giữa các màn hình, ca biên, thử vượt quyền.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store as S, q, fresh } from './helpers.mjs';
import { balance, orderTotals, paid, inventoryPosition, daysOverdue } from '../js/core/calc.js';
import { today, addDays, diffDays } from '../js/core/dates.js';
const D = () => S.state.db, sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0), T = today();

test('Bất biến dữ liệu seed', async () => {
  await fresh();
  const bad = [];
  for (const i of D().invoices) {
    if (!(i.amount > 0)) bad.push('HĐ amount<=0 ' + i.id);
    if (i.dueDate < i.date) bad.push('due<date ' + i.id);
    if (balance(i) < -0.5) bad.push('balance âm ' + i.id);
    for (const p of i.payments) if (p.date > T || p.date < i.date) bad.push(`ngày thanh toán lệch ${i.id} ${p.date} (HĐ ${i.date})`);
  }
  for (const o of D().salesOrders) { const t = orderTotals(o); if (o.status !== 'quote' && !(t.net > 0)) bad.push('đơn net<=0 ' + o.id); if (t.margin != null && (t.margin < -50 || t.margin > 90)) bad.push(`biên bất thường ${o.id} ${t.margin.toFixed(0)}%`); if (o.date > T) bad.push('đơn ngày tương lai ' + o.id); }
  const ids = new Set(); for (const o of D().salesOrders) { if (ids.has(o.id)) bad.push('trùng mã đơn ' + o.id); ids.add(o.id); }
  const inos = new Set(); for (const i of D().invoices) { const k = i.direction + i.no; if (inos.has(k)) bad.push('trùng số HĐ ' + k); inos.add(k); }
  const pos = inventoryPosition(D().invTx, 'avg'); for (const [k, v] of Object.entries(pos)) { if (v.qty < -1e-6) bad.push('tồn âm ' + k); if (v.value < -1) bad.push('giá trị tồn âm ' + k); for (const [w, qy] of Object.entries(v.byWh)) if (qy < -1e-6) bad.push(`tồn âm ${k}@${w}: ${qy}`); }
  for (const a of D().approvals.filter((x) => x.status === 'pending')) { const coll = { order_margin: 'salesOrders', order_credit: 'salesOrders', po: 'purchaseOrders', payment: 'invoices', inv_adjust: 'stocktakes', expense: 'expenses' }[a.type]; if (!D()[coll].some((x) => x.id === a.refId)) bad.push('phê duyệt mồ côi ' + a.id); }
  for (const l of D().coffeeLots) if (l.outKg > l.kg) bad.push('thành phẩm > nhập ' + l.id);
  assert.deepEqual(bad, [], bad.slice(0, 15).join('\n'));
});
test('Đối soát chéo: công nợ, tiền, dự báo, lợi nhuận', async () => {
  await fresh();
  const ar = D().invoices.filter((i) => i.direction === 'AR'), arTot = sum(ar, balance);
  assert.equal(Math.round(sum(q.arByCustomer(S.state.user), (r) => r.total)), Math.round(arTot), 'AR theo khách = tổng sổ');
  const ag = q.arAging(q.arByCustomer(S.state.user)); assert.equal(Math.round(ag.current + ag.overdue), Math.round(arTot));
  assert.equal(Math.round(sum(['b1', 'b2', 'b3', 'b4'], (k) => ag[k])), Math.round(ag.overdue), 'tổng các dải = quá hạn');
  assert.equal(Math.round(q.cashBalance()), Math.round(sum(D().cashAccounts, (a) => q.accountBalance(a.id))));
  // mỗi đồng thu AR trong sổ phải có giao dịch tiền tương ứng
  const arPaid = sum(ar, paid), cashIn = sum(D().cashTx.filter((t) => t.direction === 'in' && D().invoices.some((i) => i.id === t.ref && i.direction === 'AR')), (t) => t.amount);
  assert.ok(Math.abs(arPaid - cashIn) < 1, `thu AR trong sổ ${arPaid} ≠ tiền vào ${cashIn}`);
  const ap = D().invoices.filter((i) => i.direction === 'AP'), apPaid = sum(ap, paid), cashOut = sum(D().cashTx.filter((t) => t.direction === 'out' && D().invoices.some((i) => i.id === t.ref && i.direction === 'AP')), (t) => t.amount);
  assert.ok(Math.abs(apPaid - cashOut) < 1, `chi AP trong sổ ${apPaid} ≠ tiền ra ${cashOut}`);
  const fc = q.forecast('base'); const inSum = sum(fc.weeks, (w) => w.in), items = sum(fc.weeks, (w) => sum(w.inItems, (x) => x.amount)); assert.ok(Math.abs(inSum - items) < 1);
  assert.ok(Math.abs(fc.closing - (fc.opening + fc.totalIn - fc.totalOut)) < 1, 'closing tuần 13 = đầu + Σthu − Σchi');
  const uf = sum(fc.unforecast, (x) => x.amount), inH = sum(fc.weeks, (w) => sum(w.inItems, (x) => x.amount));
  const arPos = sum(ar.filter((i) => balance(i) > 0), balance); assert.ok(inH + uf <= arPos + 1, 'thu dự báo + chưa dự báo ≤ tổng phải thu');
  for (const m of q.months(12)) { const st = q.periodStats(m), sg = q.profitBySegment(m); assert.ok(Math.abs(sum(sg, (r) => r.revenue) - st.revenue) < 1, m + ' DT'); assert.ok(Math.abs(sum(sg, (r) => r.profit) - st.profit) < 1, m + ' LN'); assert.ok(Math.abs(sum(sg, (r) => r.cogs) - st.cogs) < 1, m + ' GV'); assert.ok(Math.abs(st.gross - (st.revenue - st.cogs)) < 1e-6); }
  const pm = q.profitBySegment(null, q.months(12)); assert.ok(Math.abs(sum(pm, (r) => r.revenue) - sum(q.months(12), (m) => q.periodStats(m).revenue)) < 1, 'gộp 12 tháng');
  // lọc theo mảng: tổng các mảng = toàn công ty
  const bySeg = sum(D().segments, (s) => q.periodStats(q.months(1)[0], { segmentId: s.id }).profit), all = q.periodStats(q.months(1)[0]).profit; assert.ok(Math.abs(bySeg - all) < 1, `LN lọc theo từng mảng cộng lại ${bySeg} ≠ toàn công ty ${all}`);
  const inv = q.inventoryView(); assert.equal(Math.round(sum(inv, (x) => x.value)), Math.round(sum(Object.values(S.stockPosition()), (p) => p.value)));
  assert.equal(inv.filter((x) => x.status === 'expired').length, new Set(inv.filter((x) => x.expired.length).map((x) => x.p.id)).size);
  const wc = q.workingCapital(); assert.ok(Math.abs(wc.net - (wc.invValue + wc.ar - wc.ap)) < 1);
});
test('Luồng end-to-end: bán → giao → thu → công nợ/tiền/tồn/doanh thu cùng khớp', async () => {
  await fresh('admin@ongvang.demo'); const p = D().products.find((x) => x.segmentId === 'PB' && S.stockOf(x.id, 'K1') > 50), cust = 'KH020';
  const cash0 = q.cashBalance(), stock0 = S.stockOf(p.id, 'K1'), ar0 = sum(D().invoices.filter((i) => i.direction === 'AR' && i.partyId === cust), balance), rev0 = q.periodStats(T.slice(0, 7)).revenue;
  const price = Math.round(p.price * 1.2), o = S.saveOrder({ customerId: cust, date: T, whId: 'K1', lines: [{ productId: p.id, qty: 10, price, discount: 10 }], directCost: 100000 });
  assert.equal(o.status, 'processing'); assert.equal(q.periodStats(T.slice(0, 7)).revenue, rev0, 'chưa giao chưa ghi nhận doanh thu');
  const inv = S.deliverOrder(o.id); const net = 10 * price * 0.9; assert.equal(inv.amount, Math.round(net));
  assert.equal(S.stockOf(p.id, 'K1'), stock0 - 10); assert.equal(Math.round(q.periodStats(T.slice(0, 7)).revenue - rev0), Math.round(net), 'doanh thu tăng đúng net');
  assert.equal(Math.round(sum(D().invoices.filter((i) => i.direction === 'AR' && i.partyId === cust), balance) - ar0), Math.round(net));
  assert.equal(q.cashBalance(), cash0, 'giao hàng chưa làm đổi tiền');
  const half = Math.round(net / 2); S.recordPayment(inv.id, { date: T, amount: half, accountId: 'TK2' }); assert.equal(q.cashBalance(), cash0 + half); assert.equal(o.status, 'delivered');
  await new Promise((r) => setTimeout(r, 3100)); S.recordPayment(inv.id, { date: T, amount: balance(inv), accountId: 'TK2' }); assert.equal(balance(inv), 0); assert.equal(o.status, 'completed'); assert.equal(Math.round(q.cashBalance() - cash0), Math.round(net));
  assert.throws(() => S.recordPayment(inv.id, { date: T, amount: 1, accountId: 'TK2' }), /vượt số còn lại/);
});
test('Ca biên đầu vào', async () => {
  await fresh('admin@ongvang.demo'); const p = D().products[0], base = { customerId: 'KH001', date: T, lines: [{ productId: p.id, qty: 1, price: p.price, discount: 0 }] };
  const bad = (patch, re) => assert.throws(() => S.saveOrder({ ...base, ...patch }), re);
  bad({ lines: [{ ...base.lines[0], discount: 101 }] }, /hiết khấu/); bad({ lines: [{ ...base.lines[0], discount: -5 }] }, /hiết khấu/); bad({ lines: [{ ...base.lines[0], qty: 0 }] }, /≥/); bad({ lines: [{ ...base.lines[0], price: -1 }] }, /≥/); bad({ lines: [{ ...base.lines[0], price: 'x' }] }, /số/); bad({ lines: [{ ...base.lines[0], qty: Infinity }] }, /số/); bad({ lines: [{ ...base.lines[0], qty: NaN }] }, /số/); bad({ directCost: -1 }, /≥/); bad({ returns: -1 }, /≥/); bad({ customerId: 'KHNONE' }, /khách/); bad({ lines: [{ productId: 'NONE', qty: 1, price: 1, discount: 0 }] }, /sản phẩm/);
  const inv = D().invoices.find((i) => i.direction === 'AR' && balance(i) > 1000);
  for (const amt of [0, -1, NaN, 'abc', Infinity, balance(inv) + 1]) assert.throws(() => S.recordPayment(inv.id, { date: T, amount: amt, accountId: 'TK1' }), /./, 'amount ' + amt);
  assert.throws(() => S.recordPayment(inv.id, { date: T, amount: 1, accountId: 'NONE' }), /tài khoản/);
  assert.throws(() => S.recordPayment('NONE', { date: T, amount: 1, accountId: 'TK1' }), /Không tìm thấy/);
  assert.throws(() => S.addCommitment({ invoiceId: inv.id, promiseDate: addDays(T, -1), amount: 1, contact: 'a' }), /hôm nay/); assert.throws(() => S.addCommitment({ invoiceId: inv.id, promiseDate: addDays(T, 3), amount: balance(inv) * 2, contact: 'a' }), /vượt/); assert.throws(() => S.addCommitment({ invoiceId: inv.id, promiseDate: addDays(T, 3), amount: 1, contact: ' ' }), /liên hệ/);
  assert.throws(() => S.savePO({ supplierId: 'NCC001', date: T, lines: [{ productId: p.id, qty: 0, cost: 1 }] }), /≥/); assert.throws(() => S.savePO({ supplierId: 'NCC001', date: T, lines: [] }), /ít nhất/);
  assert.throws(() => S.saveReceipt({ productId: p.id, wh: 'K1', date: T, qty: -1, unitCost: 1 }), /≥/); assert.throws(() => S.saveIssue({ productId: p.id, wh: 'K1', date: T, qty: 1e12, reason: 'Xuất dùng nội bộ' }), /Không đủ tồn/); assert.throws(() => S.saveIssue({ productId: p.id, wh: 'K1', date: T, qty: 1, reason: '' }), /lý do/);
  const exp = D().products.find((x) => x.expiryTracked); assert.throws(() => S.saveReceipt({ productId: exp.id, wh: 'K1', date: T, qty: 1, unitCost: 1 }), /số lô/);
  assert.throws(() => S.saveExpense({ date: T, scope: 'direct', category: 'Khác', amount: 5 }), /chọn mảng/); assert.throws(() => S.saveExpense({ date: T, scope: 'shared', category: 'Khác', amount: -5 }), /≥|Số tiền/); assert.throws(() => S.saveExpense({ date: T, scope: 'shared', category: '', amount: 5 }), /danh mục/);
  assert.throws(() => S.saveCoffeeLot({ date: T, supplier: 'x', kg: 100, pricePerKg: 1000, outKg: 200, moisture: 12, impurity: 1 }), /thành phẩm/); assert.throws(() => S.saveCoffeeLot({ date: T, supplier: 'x', kg: 100, pricePerKg: 1000, moisture: 12, impurity: 1, advance: 1e9 }), /Ứng trước/); assert.throws(() => S.saveCoffeeLot({ date: T, supplier: '', kg: 100, pricePerKg: 1000, moisture: 12, impurity: 1 }), /nhà cung cấp/);
  assert.throws(() => S.saveOpsRecord({ type: 'cost', unitId: 'NONE', date: T }), /Chọn/); assert.throws(() => S.saveOpsRecord({ type: 'output', unitId: 'AO1', date: T, kg: 0 }), /≥/); assert.throws(() => S.saveOpsRecord({ type: 'weight', unitId: 'AO1', date: T, avgKg: 1, alive: 1.5 }), /nguyên/);
  assert.throws(() => S.saveScenario({ name: '', vars: {} }), /tên/); assert.throws(() => S.saveScenario({ name: 'x', vars: { a: 99999 } }), /lớn|≤/ );
});
test('Vượt quyền: mọi hàm ghi bị chặn với vai trò không đủ quyền và KHÔNG làm đổi dữ liệu', async () => {
  const P = { admin: 1 }; const inv = () => D().invoices.find((i) => i.direction === 'AR' && balance(i) > 100), ap = () => D().invoices.find((i) => i.direction === 'AP' && balance(i) > 100), prod = () => D().products[0];
  const calls = { // [hàm, quyền cần, args]
    saveOrder: ['sales', () => [{ customerId: 'KH001', date: T, lines: [{ productId: prod().id, qty: 1, price: prod().price, discount: 0 }] }]], recordPaymentAR: ['ar', () => [inv().id, { date: T, amount: 1, accountId: 'TK1' }], 'recordPayment'], addCommitment: ['ar', () => [{ invoiceId: inv().id, promiseDate: addDays(T, 2), amount: 1, contact: 'a' }]],
    createPaymentRequest: ['ap', () => [ap().id]], savePO: ['purchase', () => [{ supplierId: 'NCC001', date: T, lines: [{ productId: prod().id, qty: 1, cost: 1 }] }]], saveReceipt: ['inventory', () => [{ productId: prod().id, wh: 'K1', date: T, qty: 1, unitCost: 1 }]], saveIssue: ['inventory', () => [{ productId: prod().id, wh: 'K1', date: T, qty: 1, reason: 'Xuất dùng nội bộ' }]],
    saveExpense: ['budget', () => [{ date: T, scope: 'shared', category: 'Khác', amount: 1 }]], saveBudget: ['budget', () => [{ period: T.slice(0, 7), segmentId: null, category: 'X', amount: 1 }]], saveCoffeeLot: ['coffee', () => [{ date: T, supplier: 'x', kg: 1, pricePerKg: 1, moisture: 1, impurity: 1 }]], saveOpsRecord: ['ops', () => [{ type: 'output', unitId: 'AO1', date: T, kg: 1 }]], saveScenario: ['scenario', () => [{ name: 'x', vars: {} }]],
    saveOpening: ['cashflow', () => ['TK1', 1, 'x']], saveForecastScenario: ['cashflow', () => ['base', { collectionPct: 1, delayDays: 0, costPct: 1 }]], reconcile: ['cashflow', () => [[D().cashTx[0].id]]], saveSettings: ['system', () => [{ minCash: 1 }, 'x']], saveUser: ['system', () => [{ name: 'x', email: 'a@b.c', role: 'xem', segments: 'all' }]], lockPeriod: ['system', () => [T, 'x']], exportBackup: ['system', () => []],
  };
  const roles = ['ketoan', 'kinhdoanh', 'thumua', 'kho', 'quanlymang', 'xem']; const { can } = await import('../js/core/rbac.js'); let blocked = 0, allowed = 0;
  for (const r of roles) { await fresh(r + '@ongvang.demo'); for (const [name, [mod, args, fn]] of Object.entries(calls)) {
    const f = S[fn || name]; const snap = JSON.stringify(D(), (k, v) => (k === 'audit' ? undefined : v)); let threw = null; try { f(...args()); } catch (e) { threw = e; }
    const need = mod === 'system' || mod === 'cashflow' || mod === 'ap' || mod === 'ar' || true; const ok = can(S.state.user, mod, mod === 'budget' || true ? 'edit' : 'view') || (name === 'exportBackup' && false);
    if (!ok) { assert.ok(threw, `${r} đáng lẽ bị chặn ở ${name}`); assert.equal(JSON.stringify(D(), (k, v) => (k === 'audit' ? undefined : v)), snap, `${r}/${name} làm đổi dữ liệu dù bị chặn`); blocked++; } else allowed++;
  } }
  assert.ok(blocked > 60, 'số ca chặn ' + blocked); console.log(`   vượt quyền: ${blocked} ca bị chặn đúng, ${allowed} ca được phép`);
  // duyệt: chỉ vai trò có quyền & đúng thẩm quyền
  await fresh('kinhdoanh@ongvang.demo'); const ap1 = D().approvals.find((a) => a.status === 'pending'); assert.throws(() => S.decide(ap1.id, 'approve'), /quyền/);
  await fresh('xem@ongvang.demo'); assert.throws(() => S.decide(ap1.id, 'approve'), /./); await assert.rejects(() => S.resetPassword('u_admin', '12345678'), /quyền/);
});
test('Dedupe: bấm lặp bị chặn, nhưng sửa lỗi rồi gửi lại thì được', async () => {
  await fresh('admin@ongvang.demo'); const inv = D().invoices.find((i) => i.direction === 'AR' && balance(i) > 1000);
  assert.throws(() => S.recordPayment(inv.id, { date: T, amount: 0, accountId: 'TK1' }), /./); S.recordPayment(inv.id, { date: T, amount: 100, accountId: 'TK1' });
  assert.throws(() => S.recordPayment(inv.id, { date: T, amount: 100, accountId: 'TK1' }), /bấm lặp/);
});
test('Khóa kỳ chặn mọi đường ghi có ngày', async () => {
  await fresh('admin@ongvang.demo'); const p = D().products[0]; S.lockPeriod(T, 'test'); const inv = D().invoices.find((i) => i.direction === 'AR' && balance(i) > 100);
  const cases = [() => S.saveOrder({ customerId: 'KH001', date: T, lines: [{ productId: p.id, qty: 1, price: p.price, discount: 0 }] }), () => S.recordPayment(inv.id, { date: T, amount: 1, accountId: 'TK1' }), () => S.saveReceipt({ productId: p.id, wh: 'K1', date: T, qty: 1, unitCost: 1 }), () => S.saveIssue({ productId: p.id, wh: 'K1', date: T, qty: 1, reason: 'Hao hụt' }), () => S.saveExpense({ date: T, scope: 'shared', category: 'Khác', amount: 1 }), () => S.saveCoffeeLot({ date: T, supplier: 'x', kg: 1, pricePerKg: 1, moisture: 1, impurity: 1 }), () => S.saveOpsRecord({ type: 'output', unitId: 'AO1', date: T, kg: 1 }), () => S.savePO({ supplierId: 'NCC001', date: T, lines: [{ productId: p.id, qty: 1, cost: 1 }] }), () => S.importCashTx(S.csvParse(`ngay,thu_chi,so_tien,tai_khoan\n${T},thu,5,TK1`)).errs.length === 1 ? (() => { throw new Error('Kỳ đã khóa (import)'); })() : null];
  cases.forEach((c, i) => assert.throws(c, /Kỳ đã khóa/, 'ca ' + i));
});
test('Bảo mật hiển thị: tên có HTML không chạy script (dùng textContent)', async () => {
  const src = (await import('fs')).readFileSync(new URL('../js/ui/dom.js', import.meta.url), 'utf8'); assert.ok(!/innerHTML\s*=\s*[^'"\s]*\$\{/.test(src));
  const fs = await import('fs'), path = await import('path'); const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const bad = walk(new URL('../js', import.meta.url).pathname).filter((f) => f.endsWith('.js')).filter((f) => /innerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(fs.readFileSync(f, 'utf8')) && !f.endsWith('app.js') && !f.endsWith('dom.js'));
  assert.equal((fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').match(/html:/g) || []).length, 1, 'chỉ 1 chỗ dùng html: (logo hằng)');
  assert.deepEqual(bad, []); // app.js chỉ dùng html: cho SVG logo hằng
});
test('Công thức điểm yếu: ngày/tuần, định dạng', async () => {
  const { weekStart, addMonths, monthEnd, fmtDate } = await import('../js/core/dates.js'); const { fmtShort, pct, fmt } = await import('../js/core/format.js');
  assert.equal(addMonths('2024-01', -1), '2023-12'); assert.equal(addMonths('2024-12', 1), '2025-01'); assert.equal(monthEnd('2024-02'), '2024-02-29'); assert.equal(monthEnd('2023-02'), '2023-02-28'); assert.equal(weekStart('2024-01-01'), '2024-01-01'); assert.equal(weekStart('2023-12-31'), '2023-12-25');
  assert.equal(fmtShort(12.5e9), '12,5 Tỷ'); assert.equal(fmtShort(850e6), '850 Triệu'); assert.equal(fmtShort(-2.1e9), '-2,1 Tỷ'); assert.equal(fmtShort(null), '–'); assert.equal(pct(null), 'N/A'); assert.equal(pct(0), '0%'); assert.equal(fmt(NaN), '–');
});
