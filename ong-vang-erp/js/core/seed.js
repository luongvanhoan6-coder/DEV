// Dữ liệu DEMO (có nhãn DEMO, tách khỏi dữ liệu thật). Sinh tất định theo ngày hôm nay.
import { today, addDays, addMonths, monthKey, diffDays, monthEnd } from './dates.js';
import { DEFAULT_AGING, orderTotals } from './calc.js';

export const DB_VERSION = 3;
export const DEFAULT_SETTINGS = {
  // Các giá trị dưới đây là MẶC ĐỊNH DEMO – cần doanh nghiệp xác nhận (BRD mục 12)
  confirmed: false,
  minCash: 500_000_000, // ngưỡng tiền mặt tối thiểu (cảnh báo)
  attentionCash: 1_000_000_000, // ngưỡng "cần chú ý"
  costMethod: 'avg', // avg: bình quân gia quyền | fifo
  vatRate: 0, // thuế GTGT trên hóa đơn (chưa xác nhận cách xử lý thuế)
  agingBands: DEFAULT_AGING,
  marginThreshold: 10, // % biên lãi gộp tối thiểu của đơn hàng; dưới ngưỡng cần duyệt
  slowDays: 90, // hàng chậm luân chuyển nếu không xuất trong N ngày
  expiryDays: 60, // cảnh báo gần hết hạn trong N ngày
  allowNegativeStock: false,
  allocationMethod: 'revenue', // revenue | direct | equal | manual
  manualAlloc: {},
  budgetWarnPct: 100, // % ngân sách; vượt cần giải trình/duyệt
  approvalTiers: [
    { upTo: 50_000_000, roles: ['ketoan', 'admin'] },
    { upTo: 1e15, roles: ['admin'] },
  ],
  dualControl: true,
  lockedThrough: null,
  coffeeMaxMoisture: 13, // %
  coffeeMaxImpurity: 1, // %
  forecastScenarios: {
    base: { name: 'Cơ sở', collectionPct: 1, delayDays: 0, costPct: 1 },
    good: { name: 'Tốt', collectionPct: 1, delayDays: -3, costPct: 0.97 },
    bad: { name: 'Xấu', collectionPct: 0.8, delayDays: 10, costPct: 1.05 },
  },
};

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (n, w = 2) => String(n).padStart(w, '0');

const SEGMENTS = [
  { id: 'PB', code: 'PB', name: 'Phân bón', color: '#0f7a3f', w: 30, margin: 0.2 },
  { id: 'BVTV', code: 'BVTV', name: 'Thuốc BVTV', color: '#2b9fd8', w: 8, margin: 0.22 },
  { id: 'TACT', code: 'TACT', name: 'Thức ăn thủy sản', color: '#7b6fd6', w: 7, margin: 0.18 },
  { id: 'CF', code: 'CF', name: 'Cà phê', color: '#c0792b', w: 22, margin: 0.12 },
  { id: 'CTR', code: 'CTR', name: 'Cây trồng', color: '#9acb3b', w: 9, margin: 0.15 },
  { id: 'CT', code: 'CT', name: 'Cá tầm', color: '#1c8aa8', w: 12, margin: 0.3 },
  { id: 'NY', code: 'NY', name: 'Nhà yến', color: '#e6b422', w: 8, margin: 0.45 },
  { id: 'KHAC', code: 'KHAC', name: 'Khác', color: '#9aa39c', w: 4, margin: 0.1 },
];
// seg, group, name, unit, price, minQty, expiry
const PRODUCT_BASE = [
  ['PB', 'Phân bón', 'NPK 16-16-8 Bình Điền', 'Bao', 520000], ['PB', 'Phân bón', 'NPK 20-20-15 Phú Mỹ', 'Bao', 640000],
  ['PB', 'Phân bón', 'Đạm Urê Phú Mỹ', 'Bao', 480000], ['PB', 'Phân bón', 'Kali Clorua', 'Bao', 560000],
  ['PB', 'Phân bón', 'Lân Super Lâm Thao', 'Bao', 210000], ['PB', 'Phân bón', 'NPK 15-15-15 Tiến Nông', 'Bao', 610000],
  ['PB', 'Phân bón', 'Phân hữu cơ vi sinh Cà Mau', 'Bao', 180000], ['PB', 'Phân bón', 'DAP Cà Mau', 'Bao', 950000],
  ['BVTV', 'Thuốc BVTV', 'Thuốc trừ sâu Abamectin 500ml', 'Chai', 165000], ['BVTV', 'Thuốc BVTV', 'Thuốc trừ bệnh Mancozeb 1kg', 'Gói', 120000],
  ['BVTV', 'Thuốc BVTV', 'Thuốc cỏ Glyphosate 1L', 'Chai', 95000], ['BVTV', 'Thuốc BVTV', 'Thuốc nấm Azoxystrobin 250ml', 'Chai', 340000],
  ['BVTV', 'Thuốc BVTV', 'Thuốc BVTV An Phát 500ml', 'Chai', 210000], ['BVTV', 'Thuốc BVTV', 'Thuốc kích rễ 250ml', 'Chai', 135000],
  ['TACT', 'Thức ăn thủy sản', 'Thức ăn cá tầm Dabaco 42%', 'Bao', 980000], ['TACT', 'Thức ăn thủy sản', 'Thức ăn Việt Nhất cá tầm giống', 'Bao', 1150000],
  ['TACT', 'Thức ăn thủy sản', 'Thức ăn cá tầm ABC 40%', 'Bao', 890000], ['TACT', 'Thức ăn thủy sản', 'Thức ăn cá tầm thương phẩm 38%', 'Bao', 820000],
  ['CF', 'Nguyên liệu', 'Cà phê nhân Robusta loại 1', 'Kg', 48000], ['CF', 'Nguyên liệu', 'Cà phê nhân Robusta R2', 'Kg', 45000], ['CF', 'Nguyên liệu', 'Cà phê nhân Arabica', 'Kg', 85000],
  ['CTR', 'Khác', 'Cây giống sầu riêng Ri6', 'Cây', 55000], ['CTR', 'Khác', 'Cây giống hồ tiêu', 'Cây', 18000], ['CTR', 'Khác', 'Cây giống cà phê TR4', 'Cây', 12000],
  ['CT', 'Khác', 'Cá tầm thương phẩm', 'Kg', 185000], ['CT', 'Khác', 'Cá tầm giống', 'Con', 16000],
  ['NY', 'Khác', 'Tổ yến thô', 'Kg', 21000000], ['NY', 'Khác', 'Tổ yến tinh chế', 'Kg', 32000000], ['NY', 'Khác', 'Máy phun ẩm nhà yến', 'Cái', 4500000],
  ['KHAC', 'Bao bì', 'Bao bì PP 50kg', 'Cái', 9000], ['KHAC', 'Bao bì', 'Bao bì PE đựng cà phê', 'Cái', 14000], ['KHAC', 'Khác', 'Màng phủ nông nghiệp', 'Cuộn', 780000], ['KHAC', 'Khác', 'Dây tưới nhỏ giọt', 'Cuộn', 650000],
];
const SIZES = ['', ' (Lô A)', ' (Lô B)'];
const CUSTOMERS_NAMED = [
  ['CTY Đại Phát', 45, [[800e6, -45], [400e6, 10]], 2500e6], ['Nông trại Tây Nguyên', 30, [[650e6, 12]], 1500e6],
  ['CTY Nông Nghiệp Xanh', 30, [[150e6, -12], [330e6, 18]], 1200e6], ['Đại lý Minh Tâm', 30, [[320e6, 9]], 800e6],
  ["HTX Cà phê Ea H'Leo", 30, [[90e6, -18], [190e6, 14]], 700e6], ['Cửa hàng Thành Đạt', 15, [[260e6, 6]], 600e6],
  ['CTY Thịnh Vượng', 30, [[200e6, -60], [40e6, 5]], 500e6], ['Đại lý Nam Việt', 30, [[180e6, 20]], 600e6],
];
const SUPPLIERS = [
  ['Công ty phân bón Phú Mỹ', 'PB'], ['Công ty Thuốc BVTV An Phát', 'BVTV'], ['Nhà cung cấp thức ăn cá tầm', 'TACT'], ['Công ty Bao bì Việt Nam', 'KHAC'],
  ['Công ty Vận tải Tây Nguyên', null], ['Công ty Bình Điền', 'PB'], ['Công ty Tiến Nông', 'PB'], ['Công ty Dabaco', 'TACT'],
  ['Công ty Việt Nhất', 'TACT'], ['Hộ nông dân - Anh Tuấn', 'CF'], ['HTX Cà phê Cư M\'gar', 'CF'], ['Trại giống Lâm Đồng', 'CT'],
];
const LASTN = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ'];
const MID = ['Văn', 'Thị', 'Minh', 'Hữu', 'Quốc', 'Ngọc'];
const FIRST = ['An', 'Bình', 'Cường', 'Dũng', 'Hà', 'Hải', 'Khoa', 'Lan', 'Nam', 'Phúc', 'Sơn', 'Tâm', 'Thảo', 'Tuấn', 'Vinh'];
const DIST = ['Lâm Hà', 'Đức Trọng', 'Di Linh', 'Bảo Lộc', 'Đắk Lắk', 'Buôn Ma Thuột', 'Gia Lai', 'Đắk Nông'];

export async function buildSeed(hash) {
  const T = today();
  const R = rng(20241101);
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const db = { version: DB_VERSION, demo: true, createdAt: new Date().toISOString(), seq: {} };
  const salt = 'ongvang-demo';
  const pw = await hash('demo123', salt);
  const U = (id, name, title, role, segments = 'all') => ({ id, name, title, role, email: id.slice(2) + '@ongvang.demo', pwHash: pw, salt, segments, active: true });
  db.users = [
    U('u_admin', 'Nguyễn Văn A', 'Giám đốc', 'admin'), U('u_ketoan', 'Trần Thị B', 'Kế toán trưởng', 'ketoan'),
    U('u_kinhdoanh', 'Lê Văn C', 'Trưởng phòng kinh doanh', 'kinhdoanh'), U('u_thumua', 'Phạm Minh D', 'Phụ trách thu mua', 'thumua'),
    U('u_kho', 'Hoàng Hữu E', 'Thủ kho', 'kho'), U('u_quanlymang', 'Vũ Thị F', 'Quản lý mảng phân bón & BVTV', 'quanlymang', ['PB', 'BVTV']),
    U('u_xem', 'Đỗ Ngọc G', 'Quan sát viên', 'xem'),
  ];
  db.segments = SEGMENTS.map(({ id, code, name, color }) => ({ id, code, name, color, active: true }));
  db.warehouses = [{ id: 'K1', name: 'Kho Lâm Hà' }, { id: 'K2', name: 'Kho Đức Trọng' }, { id: 'K3', name: 'Kho cà phê Đắk Lắk' }];
  db.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

  // ---- Khách hàng / NCC ----
  db.customers = [];
  CUSTOMERS_NAMED.forEach(([name, terms, , limit], i) => db.customers.push({ id: 'KH' + pad(i + 1, 3), code: 'KH' + pad(i + 1, 3), name, terms, creditLimit: limit, ownerId: 'u_kinhdoanh', phone: '09' + ri(10000000, 99999999), address: pick(DIST), taxCode: '58' + ri(10000000, 99999999) }));
  for (let i = CUSTOMERS_NAMED.length; i < 42; i++) {
    const nm = R() < 0.5 ? 'Đại lý ' + pick(FIRST) + ' ' + pick(DIST) : pick(LASTN) + ' ' + pick(MID) + ' ' + pick(FIRST);
    db.customers.push({ id: 'KH' + pad(i + 1, 3), code: 'KH' + pad(i + 1, 3), name: nm + ' #' + (i + 1), terms: pick([7, 15, 30]), creditLimit: pick([100e6, 200e6, 300e6, 500e6]), ownerId: 'u_kinhdoanh', phone: '09' + ri(10000000, 99999999), address: pick(DIST), taxCode: '' });
  }
  db.suppliers = SUPPLIERS.map(([name, seg], i) => ({ id: 'NCC' + pad(i + 1, 3), code: 'NCC' + pad(i + 1, 3), name, segmentId: seg, terms: pick([15, 30, 30, 45]), contact: pick(FIRST), phone: '09' + ri(10000000, 99999999) }));

  // ---- Sản phẩm ----
  db.products = [];
  PRODUCT_BASE.forEach(([seg, group, name, unit, price], bi) => {
    const nSize = price > 1e6 && seg === 'NY' ? 1 : seg === 'CF' ? 1 : SIZES.length;
    for (let s = 0; s < nSize; s++) {
      const sg = SEGMENTS.find((x) => x.id === seg);
      const idx = db.products.length + 1;
      const base = price * (1 + s * 0.015);
      db.products.push({
        id: 'P' + pad(idx, 3), sku: ({ PB: 'NPK', BVTV: 'TBVTV', TACT: 'TS', CF: 'CF', CTR: 'CAY', CT: 'CT', NY: 'NY', KHAC: 'VT' })[seg] + '-' + pad(idx, 3),
        name: name + SIZES[s], group, segmentId: seg, unit, price: Math.round(base / 1000) * 1000 || base, stdCost: Math.round(base * (1 - sg.margin)),
        minQty: Math.max(2, Math.round(30e6 / base)), expiryTracked: seg === 'BVTV' || seg === 'TACT' || (seg === 'PB' && s === 2), active: true,
      });
    }
  });
  const prodBySeg = (s) => db.products.filter((p) => p.segmentId === s);

  // ---- Đơn hàng bán + tồn kho xuất + công nợ phải thu + thu tiền ----
  db.salesOrders = []; db.invTx = []; db.invoices = []; db.cashTx = []; db.commitments = []; db.approvals = []; db.tasks = [];
  const slowProducts = new Set(db.products.filter((_, i) => i % 11 === 5).map((p) => p.id));
  let seq = 0, invSeq = 0, ctSeq = 0;
  const addCash = (date, direction, amount, category, ref, accountId = 'TK2') => db.cashTx.push({ id: 'CT' + pad(++ctSeq, 5), date, direction, amount, category, accountId, ref, reconciledAt: diffDays(T, date) > 7 ? date : null });
  const startM = addMonths(monthKey(T), -11);
  const monthlyBase = 36;
  const demand = {}, dmonth = {}; // product -> qty out
  for (let m = 0; m < 12; m++) {
    const mk = addMonths(startM, m);
    const first = mk + '-01', last = monthEnd(mk) > T ? T : monthEnd(mk);
    const days = diffDays(last, first) + 1;
    const nOrders = Math.round((monthlyBase + m * 0.9) * (days / 30));
    const used = {};
    for (let k = 0; k < nOrders; k++) {
      // chọn mảng theo trọng số
      let r = R() * 100, seg = SEGMENTS[0];
      for (const s of SEGMENTS) { if ((r -= s.w) < 0) { seg = s; break; } }
      const date = addDays(first, ri(0, days - 1));
      const cust = db.customers[Math.floor(Math.pow(R(), 1.6) * db.customers.length)];
      const target = Math.max(8e6, (R() < 0.9 ? 250e6 : 600e6) * (0.4 + R()));
      const nl = ri(1, 2);
      const lines = [];
      for (let l = 0; l < nl; l++) {
        let pool = prodBySeg(seg.id);
        if (diffDays(T, date) < 120) pool = pool.filter((p) => !slowProducts.has(p.id)) || pool;
        if (!pool.length) pool = prodBySeg(seg.id);
        const p = pick(pool);
        if (lines.some((x) => x.productId === p.id)) continue;
        const price = Math.round(p.price * (0.97 + R() * 0.06) / 100) * 100 || p.price;
        const cost = Math.round(p.stdCost * (0.98 + R() * 0.05));
        const qty = Math.max(1, Math.round(target / nl / price));
        lines.push({ productId: p.id, qty, price, discount: R() < 0.25 ? 0.01 * ri(1, 3) : 0, cost });
        demand[p.id] = (demand[p.id] || 0) + qty;
        const dk = p.id + '|' + mk; dmonth[dk] = (dmonth[dk] || 0) + qty;
      }
      if (!lines.length) continue;
      const mkey = date.slice(2, 4) + date.slice(5, 7);
      used[mkey] = (used[mkey] || 0) + 1;
      const o = { id: 'DH' + mkey + pad(used[mkey]), date, customerId: cust.id, segmentId: seg.id, ownerId: 'u_kinhdoanh', lines, returns: 0, directCost: Math.round(target * 0.012), status: 'delivered', whId: seg.id === 'CF' ? 'K3' : pick(['K1', 'K2']), note: '' };
      // một số đơn bị giảm giá mạnh => biên thấp
      if (R() < 0.04) o.lines.forEach((l) => (l.discount = 0.12));
      db.salesOrders.push(o);
      const tot = orderTotals(o);
      const amount = Math.round(tot.net * (1 + db.settings.vatRate));
      const inv = { id: 'HD' + pad(++invSeq, 5), no: 'HD' + pad(invSeq, 5), direction: 'AR', partyId: cust.id, orderId: o.id, date, dueDate: addDays(date, cust.terms), amount, payments: [], source: 'order', ownerId: cust.ownerId, segmentId: seg.id };
      o.invoiceId = inv.id;
      // thu tiền
      const age = diffDays(T, date);
      const late = R() < 0.05 ? ri(20, 50) : 0;
      const pd = ri(1, Math.max(2, Math.ceil(cust.terms / 3))) + late;
      if (age > pd) { const pdate = addDays(date, pd); inv.payments.push({ date: pdate, amount, by: 'u_ketoan' }); addCash(pdate, 'in', amount, 'Thu tiền bán hàng', inv.id, pick(['TK1', 'TK2', 'TK2'])); o.status = 'completed'; }
      else if (age > pd / 2 && R() < 0.3) { const part = Math.round(amount * 0.4); inv.payments.push({ date: addDays(date, 1), amount: part, by: 'u_ketoan' }); addCash(addDays(date, 1), 'in', part, 'Thu tiền bán hàng', inv.id, 'TK2'); }
      db.invoices.push(inv);
      lines.forEach((l) => db.invTx.push({ id: 'IX' + pad(db.invTx.length + 1, 6), date, type: 'out', product: l.productId, wh: o.whId, qty: l.qty, unitCost: l.cost, ref: o.id, reason: 'Bán hàng', seq: 5 }));
    }
  }
  // Đơn đang xử lý / chờ duyệt / báo giá
  const mkOrder = (status, cust, seg, amount, discount) => {
    const p = prodBySeg(seg)[0];
    const price = p.price, qty = Math.max(1, Math.round(amount / price));
    const date = addDays(T, -ri(0, 2)), mkey = date.slice(2, 4) + date.slice(5, 7);
    const id = 'DH' + mkey + pad(90 + db.salesOrders.length % 9);
    db.salesOrders.push({ id, date, customerId: cust, segmentId: seg, ownerId: 'u_kinhdoanh', lines: [{ productId: p.id, qty, price, discount, cost: p.stdCost }], returns: 0, directCost: 0, status, whId: 'K1', note: '' });
    return id;
  };
  ['processing', 'processing', 'processing', 'quote', 'quote'].forEach((s, i) => mkOrder(s, db.customers[i + 1].id, ['PB', 'BVTV', 'TACT', 'PB', 'CTR'][i], 120e6 + i * 40e6, 0));
  const lowId = mkOrder('pending_approval', 'KH004', 'PB', 180e6, 0.2);
  db.approvals.push({ id: 'AP-0001', type: 'order_margin', refId: lowId, amount: 180e6 * 0.8, requesterId: 'u_kinhdoanh', status: 'pending', createdAt: T, title: 'Đơn ' + lowId + ' dưới ngưỡng biên lợi nhuận', reasons: ['Biên lãi gộp thấp hơn ngưỡng cấu hình'], note: 'Khách ký hợp đồng khung' });

  // Công nợ đầu kỳ cho khách có số liệu mô phỏng theo màn hình mẫu
  CUSTOMERS_NAMED.forEach(([, terms, items], ci) => items.forEach(([amt, dd]) => {
    const due = addDays(T, dd);
    db.invoices.push({ id: 'HD' + pad(++invSeq, 5), no: 'HD' + pad(invSeq, 5), direction: 'AR', partyId: db.customers[ci].id, orderId: null, date: addDays(due, -terms), dueDate: due, amount: amt, payments: [], source: 'opening', ownerId: 'u_kinhdoanh', segmentId: 'PB', note: 'Số dư đầu kỳ (DEMO)' });
  }));
  // cam kết thanh toán
  db.invoices.filter((i) => i.direction === 'AR' && i.source === 'opening' && diffDays(T, i.dueDate) > 0).forEach((inv, k) => {
    if (k % 2 === 0) db.commitments.push({ id: 'CM' + pad(k + 1, 3), invoiceId: inv.id, customerId: inv.partyId, promiseDate: addDays(T, 5 + k * 2), amount: Math.round(inv.amount * 0.5), contact: 'Anh/chị phụ trách mua hàng', status: 'open', reminders: [{ at: addDays(T, -3), by: 'u_kinhdoanh', result: 'Hứa trả sau 1 tuần' }], createdBy: 'u_kinhdoanh', createdAt: addDays(T, -3) });
  });

  // ---- Mua hàng, nhập kho, công nợ phải trả ----
  db.purchaseOrders = []; db.suppliers.forEach(() => 0);
  const segSupplier = (seg) => db.suppliers.filter((s) => s.segmentId === seg);
  let poSeq = 0;
  const addAP = (supplierId, poId, date, amount, terms, note, noPrefix = 'AP') => {
    const no = noPrefix + (1200 + ++invSeq);
    const inv = { id: 'HD' + pad(invSeq, 5), no, direction: 'AP', partyId: supplierId, orderId: poId, date, dueDate: addDays(date, terms), amount, payments: [], source: 'po', note, requestStatus: 'none' };
    db.invoices.push(inv); return inv;
  };
  const lotSeq = {};
  for (const p of db.products) {
    const d = demand[p.id] || 0;
    const sup = segSupplier(p.segmentId)[0] || db.suppliers[3];
    const nPO = 6;
    for (let mi = 0; mi < 12; mi++) {
      const mk = addMonths(startM, mi);
      const date = mk + '-01';
      const qty = Math.ceil((dmonth[p.id + '|' + mk] || 0) * (1 + R() * 0.05));
      if (qty < 1 || date > T) continue;
      const cost = Math.round(p.stdCost * (0.98 + R() * 0.05));
      const po = { id: 'PO' + pad(++poSeq, 4), date, supplierId: sup.id, segmentId: p.segmentId, lines: [{ productId: p.id, qty, cost }], status: 'received', whId: p.segmentId === 'CF' ? 'K3' : 'K1', requesterId: 'u_thumua', note: '' };
      db.purchaseOrders.push(po);
      const lot = p.expiryTracked ? 'L' + date.replace(/-/g, '').slice(2) + '-' + pad((lotSeq[p.id] = (lotSeq[p.id] || 0) + 1)) : undefined;
      db.invTx.push({ id: 'IX' + pad(db.invTx.length + 1, 6), date, type: 'in', product: p.id, wh: po.whId, qty, unitCost: cost, ref: po.id, reason: 'Nhập mua hàng', seq: 2, lot, expiry: lot ? addDays(date, ri(200, 500)) : undefined });
      const amount = qty * cost;
      const inv = addAP(sup.id, po.id, date, amount, sup.terms, 'Thanh toán đơn mua ' + po.id);
      const age = diffDays(T, date), pd = ri(1, Math.ceil(sup.terms * 0.35));
      inv.requestStatus = 'approved';
      if (age > pd) { const pdate = addDays(date, pd); inv.payments.push({ date: pdate, amount, by: 'u_ketoan' }); addCash(pdate, 'out', amount, 'Thanh toán nhà cung cấp', inv.id, 'TK2'); }
    }
    // nhập đầu kỳ: đủ để không bao giờ âm kho trong 12 tháng + tồn an toàn
    {
      let cum = 0, minCum = 0;
      db.invTx.filter((t) => t.product === p.id).sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => { cum += t.type === 'out' ? -t.qty : t.qty; minCum = Math.min(minCum, cum); });
      db.invTx.push({ id: 'IX' + pad(db.invTx.length + 1, 6), date: addDays(T, -370), type: 'in', product: p.id, wh: p.segmentId === 'CF' ? 'K3' : 'K1', qty: Math.ceil(-minCum + p.minQty * 0.8 + d / 24), unitCost: p.stdCost, ref: 'TON-DAU-KY', reason: 'Tồn đầu kỳ DEMO', seq: 1, lot: p.expiryTracked ? 'L-OPEN-' + p.sku : undefined, expiry: p.expiryTracked ? addDays(T, ri(150, 420)) : undefined });
    }
  }
  // Hàng sắp hết, hàng gần/ quá hạn (điều chỉnh mô phỏng để có dữ liệu cảnh báo)
  const pos0 = (await import('./calc.js')).inventoryPosition(db.invTx, 'avg');
  const lowTargets = db.products.filter((_, i) => i % 7 === 3);
  for (const p of lowTargets) {
    const q = pos0[p.id]?.qty || 0; const goal = Math.round(p.minQty * 0.5);
    if (q > goal) db.invTx.push({ id: 'IX' + pad(db.invTx.length + 1, 6), date: addDays(T, -2), type: 'adjust', product: p.id, wh: p.segmentId === 'CF' ? 'K3' : 'K1', qty: -(q - goal), reason: 'Điều chỉnh kiểm kê DEMO', seq: 9 });
  }
  db.products.filter((p) => p.expiryTracked).forEach((p, i) => {
    const d = i % 3 === 0 ? -ri(5, 40) : i % 3 === 1 ? ri(10, 50) : null; // quá hạn / gần hết hạn
    if (d == null) return;
    db.invTx.push({ id: 'IX' + pad(db.invTx.length + 1, 6), date: addDays(T, -60), type: 'in', product: p.id, wh: 'K1', qty: Math.max(5, Math.round((demand[p.id] || 100) / 24)) + Math.ceil(p.minQty / 3), unitCost: p.stdCost, ref: 'NK-DEMO', reason: 'Nhập lô DEMO', seq: 3, lot: 'L-EXP-' + p.sku, expiry: addDays(T, d) });
  });
  // đơn mua đang chờ duyệt
  db.purchaseOrders.push({ id: 'PO' + pad(++poSeq, 4), date: T, supplierId: 'NCC001', segmentId: 'PB', lines: [{ productId: 'P002', qty: 800, cost: db.products[1].stdCost }], status: 'pending_approval', whId: 'K1', requesterId: 'u_thumua', note: 'Nhập bổ sung mùa vụ' });
  const po = db.purchaseOrders.at(-1);
  db.approvals.push({ id: 'AP-0002', type: 'po', refId: po.id, amount: 800 * po.lines[0].cost, requesterId: 'u_thumua', status: 'pending', createdAt: T, title: 'Đề nghị mua ' + po.id + ' – ' + db.suppliers[0].name, reasons: [], note: po.note });

  // Phải trả theo màn hình mẫu: lịch thanh toán sắp tới
  [[2, 0, 320e6, 'Thanh toán lô hàng NPK', 'AP'], [4, 1, 180e6, 'Hóa đơn #AP1245', 'AP'], [6, 2, 250e6, 'Hóa đơn #CAT789', 'CAT'], [9, 3, 120e6, 'Hóa đơn #BB456', 'BB'], [14, 4, 95e6, 'Chi phí vận chuyển', 'VT']].forEach(([dd, si, amt, note, pre]) => {
    const inv = addAP(db.suppliers[si].id, null, addDays(T, dd - 30), amt, 30, note, pre);
    inv.requestStatus = si < 2 ? 'approved' : 'none'; inv.dueDate = addDays(T, dd); inv.source = 'manual';
  });
  // tồn đọng phải trả khác (quá hạn nhẹ)
  [[-8, 5, 110e6], [-3, 6, 90e6], [20, 7, 130e6], [25, 8, 110e6]].forEach(([dd, si, amt]) => {
    const inv = addAP(db.suppliers[si].id, null, addDays(T, dd - 30), amt, 30, 'Công nợ NCC (DEMO)', 'AP'); inv.source = 'manual'; inv.requestStatus = 'none';
  });
  // đề nghị thanh toán đang chờ duyệt
  const reqInv = db.invoices.find((i) => i.direction === 'AP' && i.note === 'Chi phí vận chuyển');
  reqInv.requestStatus = 'pending';
  db.approvals.push({ id: 'AP-0003', type: 'payment', refId: reqInv.id, amount: reqInv.amount, requesterId: 'u_ketoan', status: 'pending', createdAt: T, title: 'Đề nghị thanh toán ' + reqInv.no + ' – Vận tải Tây Nguyên', reasons: [], note: '' });

  // ---- Tài khoản tiền & chi phí ----
  db.cashAccounts = [{ id: 'TK1', name: 'Tiền mặt tại quỹ', opening: 0 }, { id: 'TK2', name: 'Ngân hàng Vietcombank', opening: 0 }, { id: 'TK3', name: 'Ngân hàng Agribank', opening: 0 }];
  db.recurring = [
    { id: 'RC1', name: 'Lương nhân sự', category: 'Nhân sự', amount: 420e6, freq: 'monthly', day: 5, segmentId: null, scope: 'shared' },
    { id: 'RC2', name: 'Thuê kho & văn phòng', category: 'Thuê mặt bằng', amount: 65e6, freq: 'monthly', day: 1, segmentId: null, scope: 'shared' },
    { id: 'RC3', name: 'Điện nước, internet', category: 'Điện nước', amount: 28e6, freq: 'monthly', day: 10, segmentId: null, scope: 'shared' },
    { id: 'RC4', name: 'Trả lãi vay ngân hàng', category: 'Lãi vay', amount: 85e6, freq: 'monthly', day: 20, segmentId: null, scope: 'shared' },
    { id: 'RC5', name: 'Bảo hiểm & thuế phí', category: 'Thuế phí', amount: 40e6, freq: 'monthly', day: 25, segmentId: null, scope: 'shared' },
  ];
  db.expenses = [];
  let exSeq = 0;
  const catDirect = ['Vận chuyển', 'Bốc xếp', 'Nhân công mảng', 'Marketing mảng'];
  for (let m = 0; m < 12; m++) {
    const mk = addMonths(startM, m);
    for (const rc of db.recurring) {
      const date = mk + '-' + pad(rc.day);
      if (date > T) continue;
      const amount = Math.round(rc.amount * (0.95 + R() * 0.12));
      db.expenses.push({ id: 'CP' + pad(++exSeq, 5), date, category: rc.category, segmentId: null, scope: 'shared', amount, requesterId: 'u_ketoan', status: 'approved', note: rc.name, recurringId: rc.id });
      addCash(date, 'out', amount, 'Chi phí: ' + rc.category, 'CP' + pad(exSeq, 5), 'TK2');
    }
    for (const s of SEGMENTS) for (let k = 0; k < 2; k++) {
      const date = mk + '-' + pad(ri(3, 27));
      if (date > T) continue;
      const amount = Math.round((6e6 + R() * 22e6) * (s.w / 15 + 0.5));
      db.expenses.push({ id: 'CP' + pad(++exSeq, 5), date, category: pick(catDirect), segmentId: s.id, scope: 'direct', amount, requesterId: 'u_ketoan', status: 'approved', note: 'Chi phí trực tiếp mảng ' + s.name });
      addCash(date, 'out', amount, 'Chi phí trực tiếp', 'CP' + pad(exSeq, 5), 'TK1');
    }
  }
  // Ngân sách
  db.budgets = [];
  for (let m = -11; m <= 3; m++) {
    const mk = addMonths(monthKey(T), m);
    for (const rc of db.recurring) db.budgets.push({ id: 'NS-' + mk + '-' + rc.id, period: mk, segmentId: null, category: rc.category, amount: Math.round(rc.amount * 1.03) });
    for (const s of SEGMENTS) db.budgets.push({ id: 'NS-' + mk + '-D-' + s.id, period: mk, segmentId: s.id, category: 'Chi phí trực tiếp', amount: Math.round((20e6 + s.w * 1.2e6)) });
  }
  // Chi phí trực tiếp dùng nhiều danh mục => gộp danh mục "Chi phí trực tiếp" khi so ngân sách (xem queries)
  // Số dư tài khoản: khóa để tổng tiền hiện tại ≈ 3,8 tỷ (DEMO)
  const net = db.cashTx.reduce((a, t) => a + (t.direction === 'in' ? t.amount : -t.amount), 0);
  db.cashAccounts[1].opening = Math.round(3.8e9 - net - 0.15e9);
  db.cashAccounts[0].opening = 0; db.cashAccounts[2].opening = 0;
  db.cashTx.push({ id: 'CT' + pad(++ctSeq, 5), date: addDays(T, -1), direction: 'in', amount: 150e6, category: 'Rút/gửi nội bộ', accountId: 'TK3', ref: 'DEMO', reconciledAt: null });

  // ---- Thu mua cà phê theo lô ----
  db.coffeeLots = [];
  const farmers = ['Hộ nông dân - Anh Tuấn', 'Hộ nông dân - Chị Lan', 'HTX Cà phê Cư M\'gar', 'Hộ nông dân - Anh Sơn'];
  for (let i = 0; i < 14; i++) {
    const date = addDays(T, -i * 9 - 1);
    const kg = ri(2, 8) * 1000, price = ri(41, 46) * 1000;
    const outKg = Math.round(kg * (0.97 + R() * 0.02));
    const lot = {
      id: 'CF' + date.replace(/-/g, '') + '-' + pad(1 + (i % 3)), date, supplier: farmers[i % 4], location: pick(['Ea H\'leo, Đắk Lắk', 'Cư M\'gar, Đắk Lắk', 'Krông Pắc, Đắk Lắk']),
      kg, pricePerKg: price, outKg, moisture: +(11.5 + R() * 2).toFixed(1), impurity: +(0.4 + R() * 0.9).toFixed(1), type: 'Robusta', grade: 'Loại 1',
      costs: [{ type: 'Vận chuyển', amount: ri(2, 4) * 1e6 }, { type: 'Sấy/phơi', amount: ri(2, 4) * 1e6 }, { type: 'Nhân công', amount: 500000 }, { type: 'Khác', amount: 200000 }],
      advance: i % 4 === 0 ? Math.round(kg * price * 0.3) : 0, createdBy: 'u_thumua',
    };
    if (i >= 5) lot.sale = { date: addDays(date, 10), kg: outKg, pricePerKg: Math.round(price * 1.1 / 100) * 100, buyer: 'Đối tác xuất khẩu A' };
    db.coffeeLots.push(lot);
  }
  // ---- Cá tầm & nhà yến ----
  db.opsUnits = [];
  for (let i = 1; i <= 8; i++) db.opsUnits.push({ id: 'AO' + i, kind: 'catam', name: 'Ao ' + i, fishCount: ri(900, 1500), startDate: addDays(T, -ri(150, 330)), area: ri(300, 600), active: true });
  for (let i = 1; i <= 3; i++) db.opsUnits.push({ id: 'NY' + i, kind: 'nhayen', name: 'Nhà yến ' + String.fromCharCode(64 + i), startDate: addDays(T, -ri(300, 700)), area: ri(150, 350), active: true });
  db.opsRecords = []; let orx = 0;
  const cats = [['Thức ăn', 0.52], ['Giống', 0.18], ['Nhân công', 0.12], ['Điện nước', 0.08], ['Thuốc/vật tư', 0.06], ['Khác', 0.04]];
  for (let m = -5; m <= 0; m++) {
    const mk = addMonths(monthKey(T), m);
    for (const u of db.opsUnits.filter((x) => x.kind === 'catam')) {
      const total = u.fishCount * 20000 * (0.9 + R() * 0.2);
      for (const [c, w] of cats) db.opsRecords.push({ id: 'OR' + ++orx, type: 'cost', kind: 'catam', unitId: u.id, date: mk + '-15', category: c, amount: Math.round(total * w), cls: 'opex', source: 'Nhập tay (DEMO)' });
      db.opsRecords.push({ id: 'OR' + ++orx, type: 'weight', kind: 'catam', unitId: u.id, date: mk + '-28', avgKg: +(0.6 + (m + 5) * 0.45 + R() * 0.1).toFixed(2), alive: Math.round(u.fishCount * (1 - 0.015 * (m + 6))), source: 'Cân mẫu' });
      if (m >= -1 && R() < 0.6) db.opsRecords.push({ id: 'OR' + ++orx, type: 'output', kind: 'catam', unitId: u.id, date: mk + '-20', kg: ri(800, 1800), pricePerKg: 180000, source: 'Phiếu thu hoạch' });
    }
    for (const u of db.opsUnits.filter((x) => x.kind === 'nhayen')) {
      const base = [['Nhân công', 14e6], ['Điện nước', 6e6], ['Vật tư', 4e6], ['Khác', 2e6]];
      for (const [c, a] of base) db.opsRecords.push({ id: 'OR' + ++orx, type: 'cost', kind: 'nhayen', unitId: u.id, date: mk + '-15', category: c, amount: Math.round(a * (0.9 + R() * 0.3)), cls: 'opex', source: 'Nhập tay (DEMO)' });
      db.opsRecords.push({ id: 'OR' + ++orx, type: 'output', kind: 'nhayen', unitId: u.id, date: mk + '-25', kg: +(2 + R() * 3).toFixed(1), pricePerKg: 21000000, source: 'Phiếu thu hoạch' });
    }
  }
  db.opsRecords.push({ id: 'OR' + ++orx, type: 'cost', kind: 'catam', unitId: 'AO1', date: addDays(T, -200), category: 'Đầu tư hệ thống lọc', amount: 120e6, cls: 'capex', source: 'Đầu tư tài sản – không tính vào chi phí/kg' });

  db.scenarios = [{ id: 'SC1', name: 'Giá phân bón tăng 5%, thu tiền chậm 7 ngày (DEMO)', createdBy: 'u_ketoan', createdAt: T, note: 'Giả định minh họa – không phải dữ liệu thực', vars: { sellPricePct: 0, buyPricePct: 5, revenuePct: 0, costPct: 0, collectionPct: 100, delayDays: 7, inventoryPct: 0 } }];
  db.stocktakes = []; db.audit = []; db.aiRuns = []; db.imports = []; db.periodLog = [];
  db.audit.push({ id: 'AU-0', at: new Date().toISOString(), userId: 'system', userName: 'Hệ thống', action: 'seed', entity: 'database', entityId: '-', reason: 'Khởi tạo dữ liệu DEMO' });
  return db;
}
