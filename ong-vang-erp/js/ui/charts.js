import { h } from './dom.js';
import { fmtShort } from '../core/format.js';
const NS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); kids.flat().forEach((c) => c != null && e.append(c.nodeType ? c : document.createTextNode(c))); return e; };
const nice = (max) => { if (max <= 0) return [1, 4]; const p = Math.pow(10, Math.floor(Math.log10(max / 4))); const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => max / s <= 5) || p * 10; return [step * Math.ceil(max / step), step]; };
const yFmt = (v, unit) => (unit === 'tỷ' ? (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : unit === 'triệu' ? (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) : v.toLocaleString('vi-VN'));
const legend = (items) => h('div', { class: 'legend' }, items.map((i) => h('span', null, h('i', { style: { background: i.color } }), i.name)));
// Cột + đường (tuỳ chọn). unit: 'tỷ' | 'triệu' | ''. Mọi cột có <title> tooltip.
export function barChart({ labels, bars, line, unit = 'tỷ', height = 230, stacked = false, ariaLabel = 'Biểu đồ' }) {
  const W = 640, H = height, m = { l: 44, r: 12, t: 12, b: 26 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const all = [...bars.flatMap((b) => b.data), ...(line ? line.data : [])], mx = stacked ? Math.max(...labels.map((_, i) => bars.reduce((a, b) => a + (b.data[i] || 0), 0))) : Math.max(...all, 0), mn = Math.min(0, ...all);
  const [top, step] = nice(Math.max(mx, 1)); const lo = mn < 0 ? -nice(-mn)[0] : 0; const y = (v) => m.t + ih - ((v - lo) / (top - lo)) * ih;
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': ariaLabel });
  for (let v = lo; v <= top + 1e-6; v += step) { svg.append(S('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }), S('text', { x: m.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, yFmt(v, unit))); }
  const gw = iw / labels.length, bw = stacked ? Math.min(30, gw * 0.6) : Math.min(24, (gw * 0.7) / bars.length);
  labels.forEach((lb, i) => {
    const cx = m.l + gw * i + gw / 2; svg.append(S('text', { x: cx, y: H - 8, class: 'axis', 'text-anchor': 'middle' }, lb));
    let acc = 0;
    bars.forEach((b, j) => { const v = b.data[i] || 0; const x = stacked ? cx - bw / 2 : cx - (bw * bars.length) / 2 + bw * j; const y0 = stacked ? y(acc + v) : y(Math.max(v, 0)); const hh = stacked ? y(acc) - y(acc + v) : Math.abs(y(v) - y(0)); acc += v; svg.append(S('rect', { x, y: y0, width: bw - 2, height: Math.max(hh, 0), fill: b.color, rx: 2 }, S('title', {}, `${lb} – ${b.name}: ${fmtShort(v)}`))); });
  });
  if (line) { const pts = line.data.map((v, i) => [m.l + gw * i + gw / 2, y(v)]); svg.append(S('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: line.color, 'stroke-width': 2.2 })); pts.forEach((p, i) => svg.append(S('circle', { cx: p[0], cy: p[1], r: 3.5, fill: line.color }, S('title', {}, `${labels[i]} – ${line.name}: ${fmtShort(line.data[i])}`)))); }
  return h('div', { class: 'chart-box' }, svg, legend([...bars, ...(line ? [line] : [])]), h('div', { class: 'chart-u' }, unit ? 'Đơn vị: ' + (unit === 'tỷ' ? 'tỷ đồng' : unit === 'triệu' ? 'triệu đồng' : unit) : ''));
}
export function lineChart({ labels, series, unit = '', height = 200, ariaLabel = 'Biểu đồ đường' }) {
  const W = 640, H = height, m = { l: 40, r: 12, t: 12, b: 26 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const mx = Math.max(...series.flatMap((s) => s.data), 1); const [top, step] = nice(mx); const y = (v) => m.t + ih - (v / top) * ih;
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': ariaLabel });
  for (let v = 0; v <= top + 1e-6; v += step) svg.append(S('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }), S('text', { x: m.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, +v.toFixed(2)));
  const gw = iw / Math.max(labels.length - 1, 1);
  labels.forEach((lb, i) => svg.append(S('text', { x: m.l + gw * i, y: H - 8, class: 'axis', 'text-anchor': 'middle' }, lb)));
  series.forEach((s) => { const pts = s.data.map((v, i) => [m.l + gw * i, y(v)]); svg.append(S('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2.4 })); pts.forEach((p, i) => svg.append(S('circle', { cx: p[0], cy: p[1], r: 3.5, fill: s.color }, S('title', {}, `${labels[i]} – ${s.name}: ${s.data[i]} ${unit}`)))); });
  return h('div', { class: 'chart-box' }, svg, legend(series), unit ? h('div', { class: 'chart-u' }, 'Đơn vị: ' + unit) : null);
}
export function donut({ items, center, size = 170, fmtVal = (v, t) => ((v / t) * 100).toFixed(0) + '%' }) {
  const tot = items.reduce((a, i) => a + Math.max(i.value, 0), 0) || 1, r = 60, c = 2 * Math.PI * r; let off = 0;
  const svg = S('svg', { viewBox: '0 0 160 160', width: size, height: size, role: 'img', 'aria-label': 'Biểu đồ tròn cơ cấu' });
  svg.append(S('circle', { cx: 80, cy: 80, r, fill: 'none', stroke: '#eef2ee', 'stroke-width': 28 }));
  items.forEach((i) => { const len = (Math.max(i.value, 0) / tot) * c; svg.append(S('circle', { cx: 80, cy: 80, r, fill: 'none', stroke: i.color, 'stroke-width': 28, 'stroke-dasharray': `${len} ${c - len}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 80 80)' }, S('title', {}, `${i.label}: ${fmtShort(i.value)} (${((i.value / tot) * 100).toFixed(1)}%)`))); off += len; });
  if (center) svg.append(S('text', { x: 80, y: 78, 'text-anchor': 'middle', class: 'dn-c' }, center[0]), S('text', { x: 80, y: 94, 'text-anchor': 'middle', class: 'dn-s' }, center[1] || ''));
  return h('div', { class: 'donut' }, svg, h('ul', { class: 'dn-leg' }, items.map((i) => h('li', null, h('i', { style: { background: i.color } }), h('span', null, i.label), h('b', null, fmtVal(i.value, tot))))));
}
export const PALETTE = ['#0f7a3f', '#c8901a', '#2b9fd8', '#7b6fd6', '#e06c3a', '#9acb3b', '#1c8aa8', '#9aa39c'];
