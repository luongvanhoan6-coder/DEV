export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && k !== 'form') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c.nodeType ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const badge = (text, tone = 'gray') => h('span', { class: 'badge ' + tone }, text);
export const STATUS = {
  normal: ['Bình thường', 'green'], low: ['Sắp hết', 'amber'], slow: ['Chậm luân chuyển', 'red'], expired: ['Quá hạn dùng', 'red'], expiring: ['Gần hết hạn', 'amber'],
  overdue: ['Quá hạn', 'red'], ontime: ['Đúng hạn', 'green'], safe: ['An toàn', 'green'], watch: ['Cần chú ý', 'amber'], alert: ['Cảnh báo', 'red'], risk: ['Nguy cơ', 'darkred'],
  processing: ['Đang xử lý', 'blue'], delivered: ['Đã giao', 'green'], completed: ['Hoàn tất', 'green'], quote: ['Báo giá', 'gray'], pending_approval: ['Chờ duyệt', 'amber'], rejected: ['Từ chối', 'red'], pending: ['Chờ duyệt', 'amber'], approved: ['Đã duyệt', 'green'], draft: ['Nháp', 'gray'], received: ['Đã nhập kho', 'green'], none: ['Chưa đề nghị', 'gray'], open: ['Đang mở', 'blue'], kept: ['Đã thực hiện', 'green'], done: ['Hoàn thành', 'green'],
};
export const statusBadge = (s) => { const [t, tone] = STATUS[s] || [s, 'gray']; return badge(t, tone); };
export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map(([k, label]) => h('button', { class: 'tab' + (k === active ? ' on' : ''), role: 'tab', 'aria-selected': k === active, onclick: () => onChange(k) }, label)));
}
export const kpi = (label, value, tone = 'green', sub, href) => h(href ? 'a' : 'div', { class: 'kpi ' + tone, href }, h('div', { class: 'kpi-l' }, label), h('div', { class: 'kpi-v' }, value), sub ? h('div', { class: 'kpi-s' }, sub) : null);
export const card = (title, body, right, cls = '') => h('section', { class: 'card ' + cls }, title || right ? h('div', { class: 'card-h' }, h('h3', null, title), right || null) : null, body);
export const stateBox = (kind, text) => h('div', { class: 'state ' + kind, role: kind === 'error' ? 'alert' : 'status' }, text);
export function toast(msg, kind = 'ok') {
  let box = document.getElementById('toasts'); if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, msg); box.append(t); setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3200);
}
export function openModal({ title, body, wide, onClose }) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => e.key === 'Escape' && close();
  const ov = h('div', { class: 'overlay', onclick: (e) => e.target === ov && close() }, h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'modal-h' }, h('h3', null, title), h('button', { class: 'x', 'aria-label': 'Đóng', onclick: close }, '×')), h('div', { class: 'modal-b' }, body)));
  document.body.append(ov); document.addEventListener('keydown', esc); ov.querySelector('input,select,textarea,button.btn')?.focus(); return { close, el: ov };
}
export function confirmBox(title, text, okLabel = 'Xác nhận') {
  return new Promise((res) => { const m = openModal({ title, body: h('div', null, h('p', null, text), h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => { m.close(); res(false); } }, 'Hủy'), h('button', { class: 'btn', onclick: () => { m.close(); res(true); } }, okLabel))), onClose: () => res(false) }); });
}
// Form modal có validation; onSubmit có thể ném Error => hiển thị tại chỗ; nút khóa khi đang xử lý (chống bấm lặp)
export function formModal({ title, fields, initial = {}, submitLabel = 'Lưu', onSubmit, wide, note }) {
  const inputs = {}, err = h('div', { class: 'form-err', role: 'alert' });
  const mk = (f) => {
    const v = initial[f.name] ?? f.value ?? '';
    let el;
    if (f.type === 'select') el = h('select', { name: f.name, required: f.required }, (f.options || []).map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return h('option', { value: val, selected: String(val) === String(v) }, lab); }));
    else if (f.type === 'textarea') el = h('textarea', { name: f.name, rows: 3, required: f.required, placeholder: f.placeholder || '' }, v);
    else if (f.type === 'checkbox') el = h('input', { type: 'checkbox', name: f.name, checked: !!v });
    else el = h('input', { type: f.type || 'text', name: f.name, value: v, required: f.required, min: f.min, max: f.max, step: f.step || (f.type === 'number' ? 'any' : null), placeholder: f.placeholder || '', readOnly: f.readOnly, inputMode: f.type === 'number' ? 'decimal' : null });
    inputs[f.name] = el; return h('label', { class: 'fld' + (f.full ? ' full' : '') }, h('span', null, f.label + (f.required ? ' *' : '')), el, f.hint ? h('small', null, f.hint) : null);
  };
  const btn = h('button', { class: 'btn', type: 'submit' }, submitLabel);
  const form = h('form', { class: 'form-grid', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const vals = {}; for (const f of fields) { const el = inputs[f.name]; vals[f.name] = f.type === 'checkbox' ? el.checked : el.value; if (f.required && !String(vals[f.name]).trim()) { err.textContent = `Vui lòng nhập "${f.label}"`; el.focus(); return; } }
    btn.disabled = true; btn.textContent = 'Đang xử lý...';
    try { await onSubmit(vals); m.close(); } catch (ex) { err.textContent = ex.message || 'Có lỗi xảy ra'; btn.disabled = false; btn.textContent = submitLabel; }
  } }, fields.map(mk), note ? h('p', { class: 'note full' }, note) : null, err, h('div', { class: 'row end full' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'Hủy'), btn));
  const m = openModal({ title, body: form, wide }); return { m, inputs };
}
export const download = (name, text, type = 'text/csv;charset=utf-8') => { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); };
