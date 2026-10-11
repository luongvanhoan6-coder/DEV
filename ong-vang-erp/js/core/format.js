export const fmt = (n) => (n == null || Number.isNaN(n) ? '–' : Math.round(n).toLocaleString('en-US'));
export function fmtShort(n) {
  if (n == null || Number.isNaN(n)) return '–';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + (a / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' Tỷ';
  if (a >= 1e6) return s + Math.round(a / 1e6).toLocaleString('en-US') + ' Triệu';
  return s + Math.round(a).toLocaleString('en-US');
}
// Tỷ lệ phần trăm; null => "N/A" (BR-02: doanh thu bằng 0 thì N/A)
export const pct = (n, d = 1) => (n == null || Number.isNaN(n) ? 'N/A' : n.toLocaleString('vi-VN', { maximumFractionDigits: d }) + '%');
export const num = (n, d = 0) => (n == null ? '–' : n.toLocaleString('vi-VN', { maximumFractionDigits: d }));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
