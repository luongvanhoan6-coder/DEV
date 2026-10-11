import test from 'node:test';
import assert from 'node:assert/strict';
import { store, q, fresh } from './helpers.mjs';
import { can, canApprove, requiredRoles, PermissionError } from '../js/core/rbac.js';
import { balance } from '../js/core/calc.js';
import { today, addDays } from '../js/core/dates.js';
const S = store, D = () => S.state.db;
const login = async (r) => { await fresh(r + '@ongvang.demo'); };

test('UAT-01 RBAC: người dùng chỉ làm đúng quyền; thao tác trái quyền bị từ chối ở lớp dịch vụ', async () => {
  await login('xem');
  assert.throws(() => S.recordPayment(D().invoices.find((i) => i.direction === 'AR').id, { date: today(), amount: 1, accountId: 'TK1' }), PermissionError);
  assert.throws(() => S.saveSettings({ minCash: 1 }, 'x'), PermissionError);
  assert.throws(() => S.exportBackup());
  await login('kho'); assert.throws(() => S.saveOrder({}), PermissionError); assert.throws(() => S.saveExpense({}), PermissionError);
  await login('kinhdoanh'); assert.ok(can(S.state.user, 'sales', 'edit')); assert.ok(!can(S.state.user, 'ap', 'view')); assert.ok(!can(S.state.user, 'approvals', 'approve'));
  assert.ok(q.arByCustomer(S.state.user).every((r) => r.customer.ownerId === 'u_kinhdoanh'));
});
test('UAT-02/04: KPI công nợ khớp dữ liệu nguồn', async () => {
  await login('ketoan');
  const total = D().invoices.filter((i) => i.direction === 'AR').reduce((a, i) => a + balance(i), 0);
  const rows = q.arByCustomer(S.state.user); assert.equal(Math.round(rows.reduce((a, r) => a + r.total, 0)), Math.round(total));
  const ag = q.arAging(rows); assert.equal(Math.round(ag.current + ag.overdue), Math.round(total));
  const m = today().slice(0, 7); const st = q.periodStats(m); const segs = q.profitBySegment(m);
  assert.ok(Math.abs(segs.reduce((a, r) => a + r.revenue, 0) - st.revenue) < 1, 'tổng doanh thu theo mảng = doanh thu kỳ');
  assert.ok(Math.abs(segs.reduce((a, r) => a + r.profit, 0) - st.profit) < 1, 'tổng LN sau phân bổ = LN kỳ (không cộng trùng)');
});
test('UAT-03: dự báo 13 tuần số dư đầu + thu − chi từng tuần', async () => {
  await login('ketoan'); const fc = q.forecast('base'); let b = fc.opening;
  for (const w of fc.weeks) { assert.ok(Math.abs(w.closing - (b + w.in - w.out)) < 1e-6); b = w.closing; }
  assert.equal(fc.weeks.length, 13);
  const bad = q.forecast('x', { collectionPct: 0, delayDays: 0, costPct: 3 }); assert.ok(bad.totalIn < fc.totalIn && bad.totalOut > fc.totalOut);
});
test('UAT-07/FR-AP-05: thanh toán phải trả cần duyệt; kiểm soát kép; thẩm quyền theo số tiền', async () => {
  await login('ketoan'); const inv = D().invoices.find((i) => i.direction === 'AP' && i.requestStatus === 'none' && balance(i) > 0 && balance(i) > 50e6);
  assert.throws(() => S.recordPayment(inv.id, { date: today(), amount: 1000, accountId: 'TK2' }), /chưa được duyệt/);
  S.createPaymentRequest(inv.id); assert.equal(inv.requestStatus, 'pending');
  const ap = D().approvals.find((a) => a.refId === inv.id);
  assert.match(canApprove(S.state.user, ap, D().settings), /Kiểm soát kép|vượt thẩm quyền/);
  assert.throws(() => S.createPaymentRequest(inv.id), /Đã có đề nghị/);
  assert.throws(() => S.decide(ap.id, 'approve'), PermissionError);
  await S.login('admin@ongvang.demo', 'demo123'); S.decide(ap.id, 'approve'); assert.equal(inv.requestStatus, 'approved'); assert.throws(() => S.decide(ap.id, 'approve'), /đã được xử lý/);
  const before = balance(inv); S.recordPayment(inv.id, { date: today(), amount: 1000, accountId: 'TK2' }); assert.equal(balance(inv), before - 1000);
  assert.throws(() => S.recordPayment(inv.id, { date: today(), amount: before * 2, accountId: 'TK2' }), /vượt số còn lại/);
  assert.throws(() => S.decide(D().approvals.find((a) => a.status === 'pending').id, 'reject', ''), /lý do/);
});
test('Thẩm quyền duyệt theo số tiền', async () => {
  await fresh(); const st = D().settings;
  assert.deepEqual(requiredRoles(st, 10e6), ['ketoan', 'admin']); assert.deepEqual(requiredRoles(st, 500e6), ['admin']);
  const ketoan = D().users.find((u) => u.role === 'ketoan');
  assert.match(canApprove(ketoan, { amount: 200e6, requesterId: 'x' }, st), /vượt thẩm quyền/); assert.equal(canApprove(ketoan, { amount: 20e6, requesterId: 'x' }, st), null);
});
test('Đơn hàng dưới ngưỡng biên cần giải trình và duyệt; không giao khi chưa duyệt (UAT-07)', async () => {
  await login('kinhdoanh'); const p = D().products.find((x) => x.segmentId === 'PB');
  const line = { productId: p.id, qty: 5, price: Math.round(p.stdCost * 1.02), discount: 0 };
  assert.throws(() => S.saveOrder({ customerId: 'KH008', date: today(), lines: [line] }), /giải trình/);
  const o = S.saveOrder({ customerId: 'KH008', date: today(), lines: [line], justification: 'Khách chiến lược' }); assert.equal(o.status, 'pending_approval');
  assert.throws(() => S.deliverOrder(o.id), /đang xử lý/);
  const ap = D().approvals.find((a) => a.refId === o.id); assert.equal(ap.status, 'pending');
  assert.throws(() => S.saveOrder({ customerId: 'KH008', date: today(), lines: [line], justification: 'x' }), /không bấm lặp/);
  await S.login('admin@ongvang.demo', 'demo123'); S.decide(ap.id, 'approve'); assert.equal(o.status, 'processing');
  const stockBefore = S.stockOf(p.id, o.whId); await S.login('kinhdoanh@ongvang.demo', 'demo123');
  const inv = S.deliverOrder(o.id); assert.equal(o.status, 'delivered'); assert.equal(S.stockOf(p.id, o.whId), stockBefore - 5); assert.equal(inv.amount, Math.round(5 * line.price)); assert.ok(o.actualCogs > 0);
});
test('Không giao hàng khi thiếu tồn; kiểm tra số liệu đầu vào', async () => {
  await login('kinhdoanh'); const p = D().products[0];
  assert.throws(() => S.saveOrder({ customerId: 'KH001', date: today(), lines: [{ productId: p.id, qty: -1, price: 1, discount: 0 }] }), /≥/);
  assert.throws(() => S.saveOrder({ customerId: 'KH001', date: today(), lines: [{ productId: p.id, qty: 'abc', price: 1, discount: 0 }] }), /phải là số/);
  assert.throws(() => S.saveOrder({ customerId: '', date: today(), lines: [] }), /khách hàng/);
  const o = S.saveOrder({ customerId: 'KH002', date: today(), lines: [{ productId: p.id, qty: 1e9, price: p.price * 2, discount: 0 }], justification: 'test' }); assert.ok(['pending_approval', 'processing'].includes(o.status));
  o.status = 'processing'; assert.throws(() => S.deliverOrder(o.id), /Không đủ tồn/);
});
test('Khóa kỳ chặn giao dịch; mở khóa cần lý do và có log (UAT-08, FR-SEC-04)', async () => {
  await login('ketoan'); const inv = D().invoices.find((i) => i.direction === 'AR' && balance(i) > 100);
  await S.login('admin@ongvang.demo', 'demo123'); S.lockPeriod(today(), 'Chốt kỳ');
  await S.login('ketoan@ongvang.demo', 'demo123'); assert.throws(() => S.recordPayment(inv.id, { date: today(), amount: 1, accountId: 'TK1' }), /Kỳ đã khóa/);
  assert.throws(() => S.lockPeriod(null, 'x'), /admin|quyền/i);
  await S.login('admin@ongvang.demo', 'demo123'); assert.throws(() => S.lockPeriod(null, ' '), /lý do/); S.lockPeriod(null, 'Điều chỉnh sai sót');
  const log = D().audit.find((a) => a.action === 'unlock_period'); assert.ok(log && log.reason === 'Điều chỉnh sai sót' && log.before.lockedThrough === today());
});
test('Audit: ghi người, thời gian, trước/sau, lý do; không lộ mật khẩu', async () => {
  await login('admin'); S.saveSettings({ marginThreshold: 12 }, 'Theo họp BGĐ');
  const a = D().audit.find((x) => x.action === 'settings'); assert.equal(a.userId, 'u_admin'); assert.equal(a.before.marginThreshold, 10); assert.equal(a.after.marginThreshold, 12); assert.equal(a.reason, 'Theo họp BGĐ'); assert.ok(a.at);
  assert.equal(D().settings.confirmed, true); assert.throws(() => S.saveSettings({ minCash: 1 }, ''), /lý do/);
  S.saveUser({ id: 'u_xem', name: 'Đỗ Ngọc G', title: 'x', role: 'xem', segments: 'all', active: true, email: 'xem@ongvang.demo', reason: 'test' });
  const ul = D().audit.find((x) => x.entity === 'user'); assert.ok(!JSON.stringify(ul).includes(D().users[0].pwHash));
});
test('Kiểm kê: điều chỉnh tồn chỉ có hiệu lực sau duyệt, cần lý do (FR-INV-06)', async () => {
  await login('kho'); const p = D().products.find((x) => S.stockOf(x.id, 'K1') > 10), book = S.stockOf(p.id, 'K1');
  assert.throws(() => S.submitStocktake({ whId: 'K1', counts: [{ productId: p.id, counted: book - 3 }], reason: '' }), /lý do/);
  assert.throws(() => S.submitStocktake({ whId: 'K1', counts: [{ productId: p.id, counted: book }], reason: 'x' }), /khớp sổ/);
  S.submitStocktake({ whId: 'K1', counts: [{ productId: p.id, counted: book - 3 }], reason: 'Kiểm kê cuối kỳ' }); assert.equal(S.stockOf(p.id, 'K1'), book);
  const ap = D().approvals.find((a) => a.type === 'inv_adjust' && a.status === 'pending'); await S.login('admin@ongvang.demo', 'demo123'); S.decide(ap.id, 'approve'); assert.equal(S.stockOf(p.id, 'K1'), book - 3);
});
test('UAT-09 Import: báo lỗi từng dòng, chặn trùng, không ghi dòng lỗi; export CSV', async () => {
  await login('ketoan'); const before = D().customers.length;
  const rows = S.csvParse('ma,ten,mst,sdt,dia_chi,han_thanh_toan,han_muc\nKH900,Đại lý A,1,2,Lâm Hà,30,1000\nKH900,Trùng mã,1,2,x,30,1\n,Thiếu mã,1,2,x,30,1\nKH901,Sai số,1,2,x,abc,1\nKH001,Trùng hệ thống,1,2,x,30,1');
  const r = S.importCustomers(rows); assert.equal(r.good.length, 1); assert.equal(r.errs.length, 4); assert.equal(D().customers.length, before); r.commit(); assert.equal(D().customers.length, before + 1); assert.equal(D().imports[0].ok, 1);
  const c = S.importCashTx(S.csvParse('ngay,thu_chi,so_tien,tai_khoan,noi_dung,tham_chieu\n2024-01-01,thu,5000,TK1,A,R1\n2024-01-01,thu,5000,TK1,A,R1\n2024-01-01,xx,5000,TK1,A,R2\n2024-01-01,chi,-5,TK1,A,R3\nbad,chi,5,TK1,A,R4\n2024-01-01,chi,5,TK9,A,R5'));
  assert.equal(c.good.length, 1); assert.equal(c.errs.length, 5);
  assert.equal(S.csvStringify([['a', 'b,c'], ['"x"', 'y\nz']]), '﻿a,"b,c"\r\n"""x""",“y\nz”'.replace(/[“”]/g, '"'));
  assert.deepEqual(S.csvParse('﻿a,b\n"1,5",2\n'), [{ a: '1,5', b: '2' }]);
});
test('Sao lưu/khôi phục (UAT-12): khôi phục đúng dữ liệu, từ chối file sai', async () => {
  await login('admin'); const dump = S.exportBackup(); const n = D().customers.length;
  S.importCustomers(S.csvParse('ma,ten,han_thanh_toan,han_muc\nKHX1,Tạm,30,1')).commit(); assert.equal(D().customers.length, n + 1);
  S.restoreBackup(dump); assert.equal(D().customers.length, n); assert.ok(D().audit.some((a) => a.action === 'restore'));
  assert.throws(() => S.restoreBackup('{bad'), /JSON/); assert.throws(() => S.restoreBackup('{"version":1}'), /phiên bản/);
  await login('ketoan'); assert.throws(() => S.restoreBackup(dump), /admin/);
});
test('Chi phí vượt ngân sách cần giải trình và duyệt; không ghi tiền cho đến khi duyệt', async () => {
  await login('ketoan'); const period = today().slice(0, 7); const b = D().budgets.find((x) => x.period === period && !x.segmentId);
  assert.throws(() => S.saveExpense({ date: today(), scope: 'shared', category: b.category, amount: b.amount * 10 }), /giải trình/);
  const cash = q.cashBalance(); const e = S.saveExpense({ date: today(), scope: 'shared', category: b.category, amount: b.amount * 10, note: 'Phát sinh đột xuất' }); assert.equal(e.status, 'pending'); assert.equal(q.cashBalance(), cash);
});
test('Lô cà phê: tạo công nợ NCC, ứng trước, giá vốn thực tế; bán lô', async () => {
  await login('thumua'); const n = D().invoices.length;
  const lot = S.saveCoffeeLot({ date: today(), supplier: 'Hộ nông dân - Anh Tuấn', location: 'Ea H\'leo', kg: 5000, pricePerKg: 42000, moisture: 12.5, impurity: 0.8, type: 'Robusta', grade: 'Loại 1', transport: 2500000, drying: 3000000, labor: 500000, other: 200000, advance: 50000000 });
  const { coffeeLotResult } = await import('../js/core/calc.js'); assert.equal(coffeeLotResult(lot).unitCost, 43240);
  const inv = D().invoices[n]; assert.equal(inv.amount, 210000000); assert.equal(balance(inv), 160000000);
  assert.throws(() => S.saveCoffeeLot({ date: today(), supplier: 'x', kg: 100, pricePerKg: 1000, moisture: 150, impurity: 1 }), /Độ ẩm/);
  S.sellCoffeeLot(lot.id, { date: today(), kg: 5000, pricePerKg: 50000, buyer: 'A' }); assert.equal(coffeeLotResult(lot).provisional, false); assert.throws(() => S.sellCoffeeLot(lot.id, { date: today(), kg: 1, pricePerKg: 1 }), /đã bán/);
});
test('AI: trả lời có nguồn, không bịa; ghi log; không có hàm hành động tài chính', async () => {
  await login('admin'); const { answer } = await import('../js/core/ai.js'); const a = answer('Phân tích công nợ'); assert.match(a.text, /SỐ THỰC TẾ/); assert.match(a.text, /DỰ BÁO/); assert.match(a.text, /SUY LUẬN/); assert.ok(a.sources.length);
  assert.equal(answer('thời tiết hôm nay').intent, 'unknown'); const r = S.logAiRun({ question: 'x', intent: 'ar', sources: [], summary: 's' }); assert.ok(D().aiRuns.includes(r));
  assert.ok(!Object.keys(S).some((k) => /transfer|chuyenTien|payOut|aiApprove/i.test(k)));
});
