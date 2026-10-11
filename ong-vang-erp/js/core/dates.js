// Tiện ích ngày (ISO yyyy-mm-dd, tính theo UTC để không lệch múi giờ)
const MS = 86400000;
const toMs = (iso) => Date.parse(iso + 'T00:00:00Z');
export const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso, n) => fromMs(toMs(iso) + n * MS);
export const diffDays = (a, b) => Math.round((toMs(a) - toMs(b)) / MS); // a - b
export const monthKey = (iso) => iso.slice(0, 7);
export const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
export const fmtDate = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
export const fmtMonth = (key) => 'Tháng ' + key.slice(5, 7) + '/' + key.slice(0, 4);
export const monthEnd = (key) => addDays(addMonths(key, 1) + '-01', -1);
// Thứ Hai đầu tuần chứa ngày iso
export const weekStart = (iso) => {
  const dow = new Date(toMs(iso)).getUTCDay(); // 0=CN
  return addDays(iso, -((dow + 6) % 7));
};
