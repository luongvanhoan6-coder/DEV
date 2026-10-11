// Lớp dữ liệu + dịch vụ nghiệp vụ. MỌI thao tác ghi đi qua đây: kiểm tra quyền, khóa kỳ, validation, audit log.
// Bản này lưu trong localStorage của trình duyệt (chế độ DEMO). Cùng giao diện hàm có thể chuyển sang API/Postgres (docs/schema.sql).
import { buildSeed, DB_VERSION } from './seed.js';
import { assertCan, can, canApprove, PermissionError, requiredRoles } from './rbac.js';
import { orderTotals, balance, inventoryPosition, paid, coffeeLotResult } from './calc.js';
import { today, addDays, monthKey } from './dates.js';
import { uid, sum, fmt } from './format.js';

const KEY = 'ongvang.erp.v3', SKEY = 'ongvang.erp.session';
export const state = { db: null, user: null };
const subs = new Set();
export const subscribe = (f) => (subs.add(f), () => subs.delete(f));
let timer;
export function notify() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state.db)); } catch (e) { console.warn('Không lưu được:', e); } }, 60);
  subs.forEach((f) => f());
}
export async function hashPw(pw, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function init() {
  recent.clear(); let db = null;
  try { const raw = localStorage.getItem(KEY); if (raw) { db = JSON.parse(raw); if (db.version !== DB_VERSION) db = null; } } catch { db = null; }
  if (!db) { db = await buildSeed(hashPw); localStorage.setItem(KEY, JSON.stringify(db)); }
  state.db = db;
  const uidS = sessionStorage.getItem(SKEY);
  state.user = db.users.find((u) => u.id === uidS && u.active) || null;
}
export async function resetDemo() { localStorage.removeItem(KEY); state.db = await buildSeed(hashPw); localStorage.setItem(KEY, JSON.stringify(state.db)); logout(); }
export async function login(email, pw) {
  const u = state.db.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase() && x.active);
  if (!u || (await hashPw(pw, u.salt)) !== u.pwHash) { log('login_failed', 'user', email, null, null, '', { id: 'anon', name: email }); notify(); throw new Error('Sai email hoặc mật khẩu'); }
  recent.clear(); state.user = u; sessionStorage.setItem(SKEY, u.id); log('login', 'user', u.id); notify(); return u;
}
export function logout() { if (state.user) log('logout', 'user', state.user.id); state.user = null; sessionStorage.removeItem(SKEY); notify(); }

// ---- tiện ích nội bộ ----
const D = () => state.db;
export const settings = () => D().settings;
const me = () => state.user;
function log(action, entity, entityId, before = null, after = null, reason = '', who = me()) {
  const trim = (o) => (o == null ? o : JSON.parse(JSON.stringify(o, (k, v) => (k === 'pwHash' || k === 'salt' ? '***' : v))));
  D().audit.unshift({ id: uid('AU'), at: new Date().toISOString(), userId: who?.id || 'system', userName: who?.name || 'Hệ thống', action, entity, entityId, before: trim(before), after: trim(after), reason });
  if (D().audit.length > 3000) D().audit.length = 3000;
}
function assertOpen(date) {
  const lk = settings().lockedThrough;
  if (lk && date && date <= lk) throw new Error(`Kỳ đã khóa đến ${lk}. Cần admin mở khóa (có ghi log).`);
}
const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const num = (v, name, { min = 0, max = Infinity, int = false } = {}) => {
  const n = Number(v); need(Number.isFinite(n), `${name} phải là số`); need(n >= min, `${name} phải ≥ ${min}`); need(n <= max, `${name} quá lớn`);
  if (int) need(Number.isInteger(n), `${name} phải là số nguyên`); return n;
};
const byId = (coll, id) => D()[coll].find((x) => x.id === id);
function done() { if (pendingKey) { recent.set(pendingKey, Date.now()); pendingKey = null; } notify(); }
// chống tạo trùng do bấm lặp: cùng khóa trong 3 giây bị từ chối
// Khóa chỉ được ghi nhận khi thao tác THÀNH CÔNG (done), nên người dùng sửa lỗi rồi gửi lại không bị chặn nhầm.
const recent = new Map();
let pendingKey = null;
function dedupe(key) { if (recent.get(key) > Date.now() - 3000) throw new Error('Thao tác vừa được ghi nhận, vui lòng không bấm lặp'); pendingKey = key; }

// ---- Tồn kho ----
export const stockPosition = () => inventoryPosition(D().invTx, settings().costMethod);
export const stockOf = (productId, wh) => { const p = stockPosition()[productId]; return p ? (wh ? p.byWh[wh] || 0 : p.qty) : 0; };
let txSeq = 0;
function addInvTx(t) { D().invTx.push({ id: 'IX' + Date.now().toString(36) + (++txSeq), seq: 6, ...t }); }

// ---- Phê duyệt ----
function createApproval({ type, refId, amount, title, reasons = [], note = '' }) {
  const a = { id: 'AP-' + String(D().approvals.length + 1).padStart(4, '0'), type, refId, amount, requesterId: me().id, status: 'pending', createdAt: today(), title, reasons, note };
  D().approvals.unshift(a); log('approval_request', 'approval', a.id, null, a, note); return a;
}
const HANDLERS = {
  order_margin: { ok: (a) => { const o = byId('salesOrders', a.refId); o.status = 'processing'; }, no: (a) => { byId('salesOrders', a.refId).status = 'rejected'; } },
  order_credit: { ok: (a) => { byId('salesOrders', a.refId).status = 'processing'; }, no: (a) => { byId('salesOrders', a.refId).status = 'rejected'; } },
  po: { ok: (a) => { byId('purchaseOrders', a.refId).status = 'approved'; }, no: (a) => { byId('purchaseOrders', a.refId).status = 'rejected'; } },
  payment: { ok: (a) => { byId('invoices', a.refId).requestStatus = 'approved'; }, no: (a) => { byId('invoices', a.refId).requestStatus = 'rejected'; } },
  inv_adjust: {
    ok: (a) => { const s = byId('stocktakes', a.refId); assertOpen(s.date); s.status = 'approved'; s.lines.filter((l) => l.diff !== 0).forEach((l) => addInvTx({ date: today(), type: 'adjust', product: l.productId, wh: s.whId, qty: l.diff, reason: 'Kiểm kê: ' + s.reason, ref: s.id, approvedBy: me().id })); },
    no: (a) => { byId('stocktakes', a.refId).status = 'rejected'; },
  },
  expense: { ok: (a) => { byId('expenses', a.refId).status = 'approved'; }, no: (a) => { byId('expenses', a.refId).status = 'rejected'; } },
};
export function decide(approvalId, decision, note = '') {
  const a = byId('approvals', approvalId); need(a, 'Không tìm thấy yêu cầu');
  need(a.status === 'pending', 'Yêu cầu đã được xử lý');
  const err = canApprove(me(), a, settings()); if (err) throw new PermissionError(err);
  if (decision === 'reject') need(note.trim(), 'Cần nhập lý do từ chối');
  dedupe('decide' + approvalId);
  const before = { ...a };
  HANDLERS[a.type][decision === 'approve' ? 'ok' : 'no'](a);
  Object.assign(a, { status: decision === 'approve' ? 'approved' : 'rejected', approverId: me().id, decidedAt: new Date().toISOString(), decisionNote: note });
  log('approval_' + decision, 'approval', a.id, before, a, note); done();
}
export const approvalOwnerRoles = (amount) => requiredRoles(settings(), amount);

// ---- Bán hàng ----
export const customerOutstanding = (cid) => sum(D().invoices.filter((i) => i.direction === 'AR' && i.partyId === cid), balance);
export function saveOrder(input) {
  assertCan(me(), 'sales', 'edit');
  need(input.customerId && byId('customers', input.customerId), 'Chọn khách hàng');
  need(input.lines?.length, 'Đơn hàng cần ít nhất 1 dòng sản phẩm');
  assertOpen(input.date);
  const lines = input.lines.map((l, i) => {
    const p = byId('products', l.productId); need(p, `Dòng ${i + 1}: chọn sản phẩm`);
    return { productId: p.id, qty: num(l.qty, `Dòng ${i + 1}: số lượng`, { min: 0.0001 }), price: num(l.price, `Dòng ${i + 1}: đơn giá`, { min: 0 }), discount: (need(Number.isFinite(Number(l.discount || 0)) && Number(l.discount || 0) >= 0 && Number(l.discount || 0) <= 100, `Dòng ${i + 1}: chiết khấu phải từ 0 đến 100%`), Number(l.discount || 0) / 100), cost: stockPosition()[p.id]?.avg || p.stdCost };
  });
  dedupe('order' + input.customerId + input.date + JSON.stringify(lines));
  const o = { id: genOrderId(input.date), date: input.date, customerId: input.customerId, segmentId: byId('products', lines[0].productId).segmentId, ownerId: me().id, lines, returns: num(input.returns || 0, 'Hàng trả lại', { min: 0 }), directCost: num(input.directCost || 0, 'Chi phí trực tiếp', { min: 0 }), status: input.quote ? 'quote' : 'processing', whId: input.whId || 'K1', note: input.note || '' };
  const t = orderTotals(o), reasons = [];
  if (!input.quote) {
    if (t.margin != null && t.margin < settings().marginThreshold) reasons.push(`Biên lãi gộp ${t.margin.toFixed(1)}% thấp hơn ngưỡng ${settings().marginThreshold}%`);
    const cust = byId('customers', o.customerId);
    if (customerOutstanding(cust.id) + t.net > cust.creditLimit) reasons.push(`Vượt hạn mức tín dụng ${fmt(cust.creditLimit)}đ`);
    if (reasons.length) {
      need((input.justification || '').trim(), 'Đơn dưới ngưỡng/vượt hạn mức: cần nhập giải trình để gửi duyệt');
      o.status = 'pending_approval';
    }
  }
  D().salesOrders.unshift(o);
  if (o.status === 'pending_approval') createApproval({ type: reasons.some((r) => r.includes('hạn mức')) ? 'order_credit' : 'order_margin', refId: o.id, amount: t.net, title: `Đơn ${o.id} cần duyệt ngoại lệ`, reasons, note: input.justification });
  log('create', 'salesOrder', o.id, null, o); done(); return o;
}
function genOrderId(date) { const k = 'DH' + date.slice(2, 4) + date.slice(5, 7); const n = D().salesOrders.filter((o) => o.id.startsWith(k)).length + 1; let id = k + String(n).padStart(2, '0'); while (byId('salesOrders', id)) id = k + String(+id.slice(6) + 1).padStart(2, '0'); return id; }
export function convertQuote(id) { assertCan(me(), 'sales', 'edit'); const o = byId('salesOrders', id); need(o?.status === 'quote', 'Không phải báo giá'); o.status = 'processing'; log('update', 'salesOrder', id, { status: 'quote' }, { status: 'processing' }, 'Chuyển báo giá thành đơn'); done(); }
export function deliverOrder(id) {
  assertCan(me(), 'sales', 'edit');
  const o = byId('salesOrders', id); need(o, 'Không tìm thấy đơn'); need(o.status === 'processing', 'Chỉ giao được đơn đang xử lý (đã duyệt)');
  const date = today(); assertOpen(date);
  for (const l of o.lines) { const have = stockOf(l.productId, o.whId); if (!settings().allowNegativeStock) need(have >= l.qty, `Không đủ tồn "${byId('products', l.productId).name}" (còn ${have}) tại kho ${o.whId}`); }
  dedupe('deliver' + id);
  const cust = byId('customers', o.customerId), t = orderTotals(o);
  const pos = stockPosition(); o.actualCogs = 0;
  o.lines.forEach((l) => { const c = pos[l.productId]?.avg ?? l.cost; o.actualCogs += l.qty * c; addInvTx({ date, type: 'out', product: l.productId, wh: o.whId, qty: l.qty, unitCost: c, ref: o.id, reason: 'Bán hàng', approvedBy: me().id }); });
  const inv = { id: 'HD' + String(D().invoices.length + 1).padStart(5, '0') + '-' + Date.now().toString(36).slice(-3), direction: 'AR', partyId: cust.id, orderId: o.id, date, dueDate: addDays(date, cust.terms), amount: Math.round(t.net * (1 + settings().vatRate)), payments: [], source: 'order', ownerId: cust.ownerId, segmentId: o.segmentId };
  inv.no = inv.id; D().invoices.push(inv); o.invoiceId = inv.id; o.status = 'delivered'; o.deliveredAt = date;
  log('deliver', 'salesOrder', id, { status: 'processing' }, { status: 'delivered', invoice: inv.id }); done(); return inv;
}

// ---- Công nợ / thu chi ----
export function recordPayment(invoiceId, { date, amount, accountId, note }) {
  const inv = byId('invoices', invoiceId); need(inv, 'Không tìm thấy chứng từ');
  assertCan(me(), inv.direction === 'AR' ? 'ar' : 'ap', 'edit'); assertOpen(date);
  const amt = num(amount, 'Số tiền', { min: 1 }); need(amt <= balance(inv) + 0.5, `Số tiền vượt số còn lại (${fmt(balance(inv))})`);
  need(byId('cashAccounts', accountId), 'Chọn tài khoản tiền');
  if (inv.direction === 'AP') need(inv.requestStatus === 'approved', 'Khoản phải trả chưa được duyệt đề nghị thanh toán (FR-AP-05)');
  dedupe('pay' + invoiceId + amt);
  const before = { balance: balance(inv) };
  const ct = { id: 'CT' + Date.now().toString(36), date, direction: inv.direction === 'AR' ? 'in' : 'out', amount: amt, category: inv.direction === 'AR' ? 'Thu tiền bán hàng' : 'Thanh toán nhà cung cấp', accountId, ref: inv.id, reconciledAt: null, note };
  D().cashTx.push(ct); inv.payments.push({ date, amount: amt, by: me().id, cashTxId: ct.id, note });
  if (inv.orderId && inv.direction === 'AR' && balance(inv) <= 0.5) { const o = byId('salesOrders', inv.orderId); if (o) o.status = 'completed'; }
  if (inv.direction === 'AR') D().commitments.filter((c) => c.invoiceId === inv.id && c.status === 'open').forEach((c) => { if (amt >= c.amount) c.status = 'kept'; });
  log('payment', 'invoice', inv.id, before, { balance: balance(inv), cashTx: ct.id }, note); done();
}
export function addCommitment({ invoiceId, promiseDate, amount, contact, note }) {
  assertCan(me(), 'ar', 'edit'); const inv = byId('invoices', invoiceId); need(inv, 'Chọn khoản phải thu');
  need(promiseDate && promiseDate >= today(), 'Ngày hứa trả phải từ hôm nay trở đi'); const amt = num(amount, 'Số tiền cam kết', { min: 1 }); need(amt <= balance(inv) + 0.5, 'Cam kết vượt số còn lại');
  need((contact || '').trim(), 'Nhập người liên hệ'); dedupe('cm' + invoiceId + promiseDate + amt);
  const c = { id: uid('CM'), invoiceId, customerId: inv.partyId, promiseDate, amount: amt, contact, status: 'open', reminders: [{ at: today(), by: me().id, result: note || 'Ghi nhận cam kết' }], createdBy: me().id, createdAt: today() };
  D().commitments.push(c); log('create', 'commitment', c.id, null, c, note); done();
}
export function addReminder(commitmentId, result) { assertCan(me(), 'ar', 'edit'); const c = byId('commitments', commitmentId); need(c, 'Không tìm thấy'); need((result || '').trim(), 'Nhập kết quả liên hệ'); c.reminders.push({ at: today(), by: me().id, result }); log('update', 'commitment', c.id, null, { reminder: result }); done(); }
export function createPaymentRequest(invoiceId, note = '') {
  assertCan(me(), 'ap', 'edit'); const inv = byId('invoices', invoiceId); need(inv && inv.direction === 'AP', 'Chọn khoản phải trả');
  need(inv.requestStatus === 'none' || inv.requestStatus === 'rejected', 'Đã có đề nghị thanh toán'); need(balance(inv) > 0, 'Khoản đã thanh toán hết');
  dedupe('pr' + invoiceId); inv.requestStatus = 'pending';
  createApproval({ type: 'payment', refId: inv.id, amount: balance(inv), title: `Đề nghị thanh toán ${inv.no} – ${byId('suppliers', inv.partyId)?.name}`, note }); done();
}
export function addTask({ title, ownerId, due, refType, refId, note }) {
  need(me(), 'Chưa đăng nhập'); const t = { id: uid('TK'), title, ownerId: ownerId || me().id, due, refType, refId, note, status: 'open', createdBy: me().id, createdAt: today() };
  D().tasks.unshift(t); log('create', 'task', t.id, null, t); done(); return t;
}
export function setTaskStatus(id, status) { const t = byId('tasks', id); need(t, 'Không có'); const b = t.status; t.status = status; log('update', 'task', id, { status: b }, { status }); done(); }

// ---- Mua hàng ----
export function savePO(input) {
  assertCan(me(), 'purchase', 'edit'); need(byId('suppliers', input.supplierId), 'Chọn nhà cung cấp'); need(input.lines?.length, 'Cần ít nhất 1 dòng'); assertOpen(input.date);
  const lines = input.lines.map((l, i) => ({ productId: (need(byId('products', l.productId), `Dòng ${i + 1}: chọn sản phẩm`), l.productId), qty: num(l.qty, `Dòng ${i + 1}: số lượng`, { min: 0.0001 }), cost: num(l.cost, `Dòng ${i + 1}: đơn giá`, { min: 0 }) }));
  dedupe('po' + input.supplierId + JSON.stringify(lines));
  const total = sum(lines, (l) => l.qty * l.cost);
  const po = { id: 'PO' + String(D().purchaseOrders.length + 1).padStart(4, '0') + Date.now().toString(36).slice(-2).toUpperCase(), date: input.date, supplierId: input.supplierId, segmentId: byId('products', lines[0].productId).segmentId, lines, status: 'pending_approval', whId: input.whId || 'K1', requesterId: me().id, note: input.note || '' };
  D().purchaseOrders.unshift(po); createApproval({ type: 'po', refId: po.id, amount: total, title: `Đề nghị mua ${po.id} – ${byId('suppliers', po.supplierId).name}`, note: po.note });
  log('create', 'purchaseOrder', po.id, null, po); done(); return po;
}
export function receivePO(id, { date, lots = {} } = {}) {
  assertCan(me(), 'inventory', 'edit'); const po = byId('purchaseOrders', id); need(po?.status === 'approved', 'Chỉ nhập kho đơn mua đã duyệt'); const d = date || today(); assertOpen(d);
  dedupe('recv' + id); const sup = byId('suppliers', po.supplierId);
  po.lines.forEach((l) => { const p = byId('products', l.productId); if (p.expiryTracked) need(lots[l.productId]?.lot && lots[l.productId]?.expiry, `"${p.name}" quản lý hạn dùng: nhập số lô và hạn dùng`); addInvTx({ date: d, type: 'in', product: l.productId, wh: po.whId, qty: l.qty, unitCost: l.cost, ref: po.id, reason: 'Nhập mua hàng', lot: lots[l.productId]?.lot, expiry: lots[l.productId]?.expiry, approvedBy: me().id }); });
  const amount = sum(po.lines, (l) => l.qty * l.cost); const n = D().invoices.length + 1;
  const inv = { id: 'HD' + String(n).padStart(5, '0') + '-' + Date.now().toString(36).slice(-3), no: 'AP' + (1200 + n), direction: 'AP', partyId: sup.id, orderId: po.id, date: d, dueDate: addDays(d, sup.terms), amount, payments: [], source: 'po', note: 'Thanh toán đơn mua ' + po.id, requestStatus: 'none' };
  D().invoices.push(inv); po.status = 'received'; log('receive', 'purchaseOrder', id, { status: 'approved' }, { status: 'received', invoice: inv.id }); done();
}

// ---- Kho ----
export function saveReceipt(i) {
  assertCan(me(), 'inventory', 'edit'); const p = byId('products', i.productId); need(p, 'Chọn sản phẩm'); assertOpen(i.date);
  const qty = num(i.qty, 'Số lượng', { min: 0.0001 }), cost = num(i.unitCost, 'Đơn giá vốn', { min: 0 });
  if (p.expiryTracked) need(i.lot && i.expiry, 'Hàng quản lý hạn dùng: nhập số lô và hạn dùng');
  dedupe('rc' + i.productId + qty + i.date);
  addInvTx({ date: i.date, type: 'in', product: p.id, wh: i.wh, qty, unitCost: cost, ref: i.ref || 'NK-TAY', reason: i.reason || 'Nhập kho', lot: i.lot || undefined, expiry: i.expiry || undefined, approvedBy: me().id });
  log('create', 'invTx', p.id, null, { type: 'in', qty, wh: i.wh }); done();
}
export function saveIssue(i) {
  assertCan(me(), 'inventory', 'edit'); const p = byId('products', i.productId); need(p, 'Chọn sản phẩm'); assertOpen(i.date);
  const qty = num(i.qty, 'Số lượng', { min: 0.0001 }); need((i.reason || '').trim(), 'Nhập lý do xuất kho');
  if (!settings().allowNegativeStock) need(stockOf(p.id, i.wh) >= qty, `Không đủ tồn (còn ${fmt(stockOf(p.id, i.wh))})`);
  dedupe('is' + i.productId + qty + i.date); const avg = stockPosition()[p.id]?.avg ?? p.stdCost;
  addInvTx({ date: i.date, type: i.reason.startsWith('Hao hụt') || i.reason.startsWith('Hư hỏng') ? 'adjust' : 'out', product: p.id, wh: i.wh, qty: i.reason.startsWith('Hao hụt') || i.reason.startsWith('Hư hỏng') ? -qty : qty, unitCost: avg, ref: 'XK-TAY', reason: i.reason, approvedBy: me().id });
  log('create', 'invTx', p.id, null, { type: 'out', qty, wh: i.wh }, i.reason); done();
}
export function submitStocktake({ whId, counts, reason }) {
  assertCan(me(), 'inventory', 'edit'); need((reason || '').trim(), 'Điều chỉnh tồn phải có lý do'); assertOpen(today());
  const lines = counts.filter((c) => c.counted !== '' && c.counted != null).map((c) => ({ productId: c.productId, book: stockOf(c.productId, whId), counted: num(c.counted, 'Số kiểm kê', { min: 0 }), diff: num(c.counted, '', { min: 0 }) - stockOf(c.productId, whId) }));
  need(lines.length, 'Chưa nhập số kiểm kê nào'); const diffs = lines.filter((l) => l.diff !== 0); need(diffs.length, 'Số liệu khớp sổ – không cần điều chỉnh');
  dedupe('st' + whId + JSON.stringify(diffs));
  const pos = stockPosition(); const val = sum(diffs, (l) => Math.abs(l.diff) * (pos[l.productId]?.avg || 0));
  const st = { id: 'KK' + String((D().stocktakes ||= []).length + 1).padStart(4, '0'), date: today(), whId, lines, reason, status: 'pending', createdBy: me().id };
  D().stocktakes.push(st); createApproval({ type: 'inv_adjust', refId: st.id, amount: Math.round(val), title: `Điều chỉnh kiểm kê ${st.id} – kho ${whId} (${diffs.length} mặt hàng)`, note: reason }); done();
}

// ---- Chi phí & ngân sách ----
export function budgetFor(period, segmentId, category) {
  const bs = D().budgets.filter((b) => b.period === period && (segmentId ? b.segmentId === segmentId : !b.segmentId) && (b.category === category || (segmentId && b.category === 'Chi phí trực tiếp')));
  return sum(bs, (b) => b.amount);
}
export function actualFor(period, segmentId, category) {
  return sum(D().expenses.filter((e) => e.status === 'approved' && monthKey(e.date) === period && (segmentId ? e.segmentId === segmentId : !e.segmentId) && (segmentId ? true : e.category === category)), (e) => e.amount);
}
export function saveExpense(i) {
  assertCan(me(), 'budget', 'edit'); assertOpen(i.date); need(i.category, 'Nhập danh mục chi phí'); const amt = num(i.amount, 'Số tiền', { min: 1 });
  const seg = i.scope === 'direct' ? i.segmentId : null; if (i.scope === 'direct') need(seg, 'Chi phí trực tiếp cần chọn mảng');
  dedupe('ex' + i.date + i.category + amt + seg);
  const period = monthKey(i.date), bud = budgetFor(period, seg, i.category), act = actualFor(period, seg, i.category);
  const over = bud > 0 && act + amt > (bud * settings().budgetWarnPct) / 100;
  if (over) need((i.note || '').trim(), 'Vượt ngân sách: cần nhập giải trình');
  const e = { id: 'CP' + String(D().expenses.length + 1).padStart(5, '0') + Date.now().toString(36).slice(-2), date: i.date, category: i.category, segmentId: seg, scope: i.scope, amount: amt, requesterId: me().id, status: over ? 'pending' : 'approved', note: i.note || '', ref: i.ref || '' };
  D().expenses.push(e);
  if (over) createApproval({ type: 'expense', refId: e.id, amount: amt, title: `Chi phí vượt ngân sách: ${i.category} (${period})`, reasons: [`Ngân sách ${fmt(bud)}, đã chi ${fmt(act)}, khoản này ${fmt(amt)}`], note: i.note });
  else D().cashTx.push({ id: 'CT' + Date.now().toString(36), date: i.date, direction: 'out', amount: amt, category: 'Chi phí: ' + i.category, accountId: i.accountId || 'TK2', ref: e.id, reconciledAt: null });
  log('create', 'expense', e.id, null, e); done(); return e;
}
export function saveBudget({ period, segmentId, category, amount }) {
  assertCan(me(), 'budget', 'edit'); const amt = num(amount, 'Ngân sách', { min: 0 }); const seg = segmentId || null;
  const ex = D().budgets.find((b) => b.period === period && (b.segmentId || null) === seg && b.category === category);
  if (ex) { const b = ex.amount; ex.amount = amt; log('update', 'budget', ex.id, { amount: b }, { amount: amt }); } else { const x = { id: uid('NS'), period, segmentId: seg, category, amount: amt }; D().budgets.push(x); log('create', 'budget', x.id, null, x); }
  done();
}

// ---- Thu mua cà phê ----
export function saveCoffeeLot(i) {
  assertCan(me(), 'coffee', 'edit'); assertOpen(i.date);
  const kg = num(i.kg, 'Khối lượng', { min: 1 }), price = num(i.pricePerKg, 'Đơn giá', { min: 1 });
  need((i.supplier || '').trim(), 'Nhập nhà cung cấp'); const outKg = i.outKg ? num(i.outKg, 'Khối lượng thành phẩm', { min: 1, max: kg * 1.0001 }) : undefined;
  const moisture = num(i.moisture, 'Độ ẩm', { min: 0, max: 100 }), impurity = num(i.impurity, 'Tạp chất', { min: 0, max: 100 });
  const id = 'CF' + i.date.replace(/-/g, '') + '-' + String(D().coffeeLots.filter((l) => l.date === i.date).length + 1).padStart(2, '0');
  dedupe('lot' + id + kg + price);
  const costs = [['Vận chuyển', i.transport], ['Sấy/phơi', i.drying], ['Nhân công', i.labor], ['Khác', i.other]].map(([type, v]) => ({ type, amount: num(v || 0, type, { min: 0 }) }));
  const adv = num(i.advance || 0, 'Ứng trước', { min: 0 }); need(adv <= kg * price, 'Ứng trước vượt giá trị lô');
  const lot = { id, date: i.date, supplier: i.supplier, location: i.location, kg, pricePerKg: price, outKg, moisture, impurity, type: i.type, grade: i.grade, costs, advance: adv, createdBy: me().id };
  D().coffeeLots.unshift(lot);
  // phải trả NCC: tiền mua – ứng trước (FR-COF-06)
  const sup = D().suppliers.find((s) => s.name === i.supplier);
  if (sup) { const n = D().invoices.length + 1; D().invoices.push({ id: 'HD' + String(n).padStart(5, '0') + '-' + Date.now().toString(36).slice(-3), no: 'LOT-' + id, direction: 'AP', partyId: sup.id, orderId: null, date: i.date, dueDate: addDays(i.date, sup.terms), amount: kg * price, payments: adv ? [{ date: i.date, amount: adv, by: me().id, note: 'Ứng trước' }] : [], source: 'coffee', note: 'Lô cà phê ' + id, requestStatus: 'approved' }); }
  log('create', 'coffeeLot', id, null, lot); done(); return lot;
}
export function sellCoffeeLot(id, { date, kg, pricePerKg, buyer }) {
  assertCan(me(), 'coffee', 'edit'); const lot = byId('coffeeLots', id); need(lot && !lot.sale, 'Lô không tồn tại hoặc đã bán');
  const k = num(kg, 'Khối lượng bán', { min: 1, max: (lot.outKg || lot.kg) * 1.0001 }), p = num(pricePerKg, 'Đơn giá bán', { min: 1 }); assertOpen(date);
  lot.sale = { date, kg: k, pricePerKg: p, buyer }; log('update', 'coffeeLot', id, { sale: null }, { sale: lot.sale }); done();
}

// ---- Cá tầm / nhà yến ----
export function saveOpsRecord(i) {
  assertCan(me(), 'ops', 'edit'); assertOpen(i.date); const u = byId('opsUnits', i.unitId); need(u, 'Chọn ao/nhà yến');
  const r = { id: uid('OR'), type: i.type, kind: u.kind, unitId: u.id, date: i.date, source: i.source || 'Nhập tay' };
  if (i.type === 'cost') { r.category = i.category; r.amount = num(i.amount, 'Số tiền', { min: 1 }); r.cls = i.cls || 'opex'; need(r.category, 'Chọn nhóm chi phí'); }
  else if (i.type === 'output') { r.kg = num(i.kg, 'Sản lượng', { min: 0.0001 }); r.pricePerKg = num(i.pricePerKg || 0, 'Giá bán', { min: 0 }); }
  else if (i.type === 'weight') { r.avgKg = num(i.avgKg, 'Trọng lượng TB', { min: 0.001 }); r.alive = num(i.alive, 'Số cá còn sống', { min: 0, int: true }); }
  else if (i.type === 'loss') { r.kg = num(i.kg || 0, 'Hao hụt (kg)', { min: 0 }); r.count = num(i.count || 0, 'Số con hao hụt', { min: 0, int: true }); }
  dedupe('or' + JSON.stringify(r).replace(/"id":"[^"]+"/, '')); D().opsRecords.push(r); log('create', 'opsRecord', r.id, null, r); done();
}
export function saveOpsUnit(i) { assertCan(me(), 'ops', 'edit'); need((i.name || '').trim(), 'Nhập tên'); const u = { id: (i.kind === 'catam' ? 'AO' : 'NY') + (D().opsUnits.filter((x) => x.kind === i.kind).length + 1) + Date.now().toString(36).slice(-2), kind: i.kind, name: i.name, fishCount: num(i.fishCount || 0, 'Số cá', { min: 0, int: true }), startDate: i.startDate, area: num(i.area || 0, 'Diện tích', { min: 0 }), active: true }; D().opsUnits.push(u); log('create', 'opsUnit', u.id, null, u); done(); }

// ---- Kịch bản ----
export function saveScenario({ name, note, vars }) {
  assertCan(me(), 'scenario', 'edit'); need((name || '').trim(), 'Đặt tên kịch bản');
  const v = {}; for (const [k, val] of Object.entries(vars)) v[k] = num(val, k, { min: -100, max: 1000 });
  const s = { id: uid('SC'), name, note, vars: v, createdBy: me().id, createdAt: today() }; D().scenarios.unshift(s); log('create', 'scenario', s.id, null, s); done(); return s;
}

// ---- Cấu hình, người dùng, khóa kỳ ----
export function saveSettings(patch, reason) {
  assertCan(me(), 'system', 'edit'); need((reason || '').trim(), 'Thay đổi cấu hình cần lý do');
  const s = settings(), before = JSON.parse(JSON.stringify(s));
  for (const [k, v] of Object.entries(patch)) s[k] = v; s.confirmed = true; log('settings', 'settings', 'settings', before, s, reason); done();
}
export function lockPeriod(through, reason) {
  assertCan(me(), 'system', 'edit'); need(me().role === 'admin', 'Chỉ admin được khóa/mở kỳ'); const before = settings().lockedThrough;
  if (!through) need((reason || '').trim(), 'Mở khóa kỳ cần nhập lý do');
  settings().lockedThrough = through || null; log(through ? 'lock_period' : 'unlock_period', 'period', through || before, { lockedThrough: before }, { lockedThrough: through }, reason); done();
}
export function saveUser(i) {
  assertCan(me(), 'system', 'edit'); need(/^\S+@\S+$/.test(i.email || ''), 'Email không hợp lệ'); need((i.name || '').trim(), 'Nhập họ tên');
  const ex = i.id && byId('users', i.id);
  if (ex) { const b = { ...ex }; Object.assign(ex, { name: i.name, title: i.title, role: i.role, segments: i.segments, active: i.active }); log('update', 'user', ex.id, b, ex, i.reason || ''); }
  else { need(!D().users.some((u) => u.email === i.email), 'Email đã tồn tại'); const u = { id: 'u_' + i.email.split('@')[0], name: i.name, title: i.title, role: i.role, email: i.email, segments: i.segments, active: true, salt: uid('s'), pwHash: '' }; u.pwHash = 'PENDING'; D().users.push(u); log('create', 'user', u.id, null, u); }
  done();
}
export async function resetPassword(userId, newPw) {
  assertCan(me(), 'system', 'edit'); need((newPw || '').length >= 8, 'Mật khẩu tối thiểu 8 ký tự'); const u = byId('users', userId); need(u, 'Không có người dùng');
  u.salt = uid('s'); u.pwHash = await hashPw(newPw, u.salt); log('reset_password', 'user', userId); done();
}

// ---- Import / Backup ----
export function logImport(entity, file, ok, bad) { D().imports.unshift({ id: uid('IM'), at: new Date().toISOString(), by: me().id, entity, file, ok, bad }); log('import', entity, file, null, { ok, bad }); done(); }
export function importCustomers(rows) {
  assertCan(me(), 'ar', 'edit'); const errs = [], good = []; const seen = new Set(D().customers.map((c) => c.code.toLowerCase()));
  rows.forEach((r, i) => {
    const line = i + 2, code = (r.ma || '').trim(), name = (r.ten || '').trim(), terms = Number(r.han_thanh_toan || 30), limit = Number(r.han_muc || 0);
    if (!code || !name) return errs.push({ line, msg: 'Thiếu mã hoặc tên' });
    if (!Number.isFinite(terms) || terms < 0 || !Number.isFinite(limit) || limit < 0) return errs.push({ line, msg: 'Hạn thanh toán/hạn mức phải là số ≥ 0' });
    if (seen.has(code.toLowerCase())) return errs.push({ line, msg: `Trùng mã "${code}"` });
    seen.add(code.toLowerCase()); good.push({ id: code, code, name, taxCode: r.mst || '', phone: r.sdt || '', address: r.dia_chi || '', terms, creditLimit: limit, ownerId: me().role === 'kinhdoanh' ? me().id : 'u_kinhdoanh' });
  }); return { errs, good, commit: () => { good.forEach((g) => D().customers.push(g)); logImport('customers', 'csv', good.length, errs.length); } };
}
export function importInvoices(rows) {
  assertCan(me(), 'ar', 'edit'); const errs = [], good = []; const seen = new Set(D().invoices.map((i) => i.no.toLowerCase()));
  rows.forEach((r, i) => {
    const line = i + 2, no = (r.so_hd || '').trim(), cust = D().customers.find((c) => c.code === (r.ma_kh || '').trim()), amt = Number(r.so_tien), d = r.ngay, due = r.han_thanh_toan;
    if (!no) return errs.push({ line, msg: 'Thiếu số hóa đơn' }); if (!cust) return errs.push({ line, msg: `Không thấy khách hàng "${r.ma_kh}"` });
    if (!Number.isFinite(amt) || amt <= 0) return errs.push({ line, msg: 'Số tiền phải > 0' }); if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '') || !/^\d{4}-\d{2}-\d{2}$/.test(due || '')) return errs.push({ line, msg: 'Ngày phải dạng YYYY-MM-DD' });
    if (seen.has(no.toLowerCase())) return errs.push({ line, msg: `Trùng số hóa đơn "${no}"` }); seen.add(no.toLowerCase());
    try { assertOpen(d); } catch (e) { return errs.push({ line, msg: e.message }); }
    good.push({ id: 'HD-IMP-' + no, no, direction: 'AR', partyId: cust.id, orderId: null, date: d, dueDate: due, amount: amt, payments: [], source: 'import', ownerId: cust.ownerId, segmentId: null, note: 'Import CSV' });
  }); return { errs, good, commit: () => { good.forEach((g) => D().invoices.push(g)); logImport('invoices', 'csv', good.length, errs.length); } };
}
export function importCashTx(rows) {
  assertCan(me(), 'cashflow', 'edit'); const errs = [], good = []; const seen = new Set(D().cashTx.map((t) => t.date + '|' + t.amount + '|' + t.direction + '|' + (t.ref || '')));
  rows.forEach((r, i) => {
    const line = i + 2, amt = Number(r.so_tien), dir = r.thu_chi === 'thu' ? 'in' : r.thu_chi === 'chi' ? 'out' : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.ngay || '')) return errs.push({ line, msg: 'Ngày phải dạng YYYY-MM-DD' }); if (!dir) return errs.push({ line, msg: 'Cột thu_chi phải là "thu" hoặc "chi"' });
    if (!Number.isFinite(amt) || amt <= 0) return errs.push({ line, msg: 'Số tiền phải > 0' }); if (!D().cashAccounts.some((a) => a.id === r.tai_khoan)) return errs.push({ line, msg: `Tài khoản "${r.tai_khoan}" không tồn tại` });
    const k = r.ngay + '|' + amt + '|' + dir + '|' + (r.tham_chieu || ''); if (seen.has(k)) return errs.push({ line, msg: 'Giao dịch trùng (đã nhập trước đó)' }); seen.add(k);
    try { assertOpen(r.ngay); } catch (e) { return errs.push({ line, msg: e.message }); }
    good.push({ id: 'CT-IMP-' + uid(''), date: r.ngay, direction: dir, amount: amt, category: r.noi_dung || 'Sao kê ngân hàng', accountId: r.tai_khoan, ref: r.tham_chieu || '', reconciledAt: null, note: 'Import sao kê' });
  }); return { errs, good, commit: () => { good.forEach((g) => D().cashTx.push(g)); logImport('cashTx', 'csv', good.length, errs.length); } };
}
export function reconcile(txIds) { assertCan(me(), 'cashflow', 'edit'); txIds.forEach((id) => { const t = byId('cashTx', id); if (t) t.reconciledAt = today(); }); log('reconcile', 'cashTx', txIds.length + ' giao dịch'); done(); }
export function exportBackup() { assertCan(me(), 'system', 'view'); need(me().role === 'admin', 'Chỉ admin được sao lưu'); log('backup', 'database', '-'); notify(); return JSON.stringify(state.db); }
export function restoreBackup(text) {
  need(me().role === 'admin', 'Chỉ admin được khôi phục'); let db; try { db = JSON.parse(text); } catch { throw new Error('File không phải JSON hợp lệ'); }
  need(db && db.version === DB_VERSION && Array.isArray(db.users) && Array.isArray(db.invoices) && db.settings, 'File sao lưu không đúng phiên bản/cấu trúc');
  need(db.users.some((u) => u.role === 'admin' && u.active), 'Bản sao lưu phải có ít nhất 1 admin');
  const before = { counts: Object.fromEntries(Object.entries(state.db).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])) };
  const keepUser = me().id; state.db = db; state.user = db.users.find((u) => u.id === keepUser) || db.users.find((u) => u.role === 'admin'); sessionStorage.setItem(SKEY, state.user.id);
  log('restore', 'database', '-', before, { counts: Object.fromEntries(Object.entries(db).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])) }, 'Khôi phục từ file sao lưu'); done();
}
export const csvParse = (text) => {
  const rows = []; let cur = [], f = '', q = false; text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; } else if (c === '"') q = true; else if (c === ',' || c === ';') { cur.push(f); f = ''; } else if (c === '\n') { cur.push(f); rows.push(cur); cur = []; f = ''; } else if (c !== '\r') f += c; }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim())); if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase()); return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
};
export const csvStringify = (rows) => '﻿' + rows.map((r) => r.map((v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
export const roleCan = (mod, act) => can(me(), mod, act);

// ---- Dòng tiền: số dư đầu, kịch bản, snapshot dự báo ----
export function saveOpening(accountId, amount, reason) {
  assertCan(me(), 'cashflow', 'edit'); const a = byId('cashAccounts', accountId); need(a, 'Chọn tài khoản'); need((reason || '').trim(), 'Nhập lý do điều chỉnh số dư đầu');
  const b = a.opening; a.opening = num(amount, 'Số dư đầu', { min: -1e13 }); log('update', 'cashAccount', a.id, { opening: b }, { opening: a.opening }, reason); done();
}
export function saveForecastScenario(key, vals) {
  assertCan(me(), 'cashflow', 'edit'); const s = settings().forecastScenarios[key]; need(s, 'Kịch bản không tồn tại'); const b = { ...s };
  s.collectionPct = num(vals.collectionPct, 'Tỷ lệ thu', { min: 0, max: 1.5 }); s.delayDays = num(vals.delayDays, 'Số ngày trễ/sớm', { min: -60, max: 180 }); s.costPct = num(vals.costPct, 'Hệ số chi phí', { min: 0.5, max: 2 });
  log('update', 'forecastScenario', key, b, s, 'Giả định dự báo'); done();
}
export function snapshotForecast(fc, key) {
  assertCan(me(), 'cashflow', 'edit'); dedupe('snap' + today());
  (D().forecastSnapshots ||= []).unshift({ id: uid('FS'), date: today(), scenario: key, by: me().id, weeks: fc.weeks.map((w) => ({ start: w.start, end: w.end, in: w.in, out: w.out, closing: w.closing })), opening: fc.opening });
  log('create', 'forecastSnapshot', today(), null, { scenario: key }); done();
}

// ---- AI (rule-based, chạy tại trình duyệt; KHÔNG gọi LLM ngoài; không thực hiện hành động tài chính) ----
export function logAiRun({ question, intent, sources, summary }) {
  const r = { id: uid('AI'), at: new Date().toISOString(), userId: me().id, agent: 'rule-engine-v1', question: String(question).slice(0, 300), intent, sources, summary: String(summary).slice(0, 500), feedback: null };
  D().aiRuns.unshift(r); if (D().aiRuns.length > 300) D().aiRuns.length = 300; notify(); return r;
}
export function aiFeedback(id, val) { const r = D().aiRuns.find((x) => x.id === id); if (r) { r.feedback = val; notify(); } }
