import { h, clear, stateBox, download } from './dom.js';
import { csvStringify } from '../core/store.js';
// Bảng dữ liệu: tìm kiếm, lọc, sắp xếp, phân trang, chọn nhiều dòng (tuỳ chọn), xuất CSV theo quyền
export function dataTable({ cols, rows, pageSize = 8, searchText, placeholder = 'Tìm kiếm...', filters = [], onRow, exportName, canExport = false, empty = 'Không có dữ liệu', toolbar, rowClass, footer, initialFilters = {} }) {
  const st = { q: '', page: 1, sort: null, dir: 1, f: { ...initialFilters } };
  const root = h('div', { class: 'dt' }), tbody = h('tbody'), info = h('span', { class: 'muted' }), pager = h('div', { class: 'pager' });
  const view = () => {
    let r = rows.filter((x) => (!st.q || searchText(x).toLowerCase().includes(st.q.toLowerCase())) && filters.every((f) => !st.f[f.key] || st.f[f.key] === 'all' || f.test(x, st.f[f.key])));
    if (st.sort) { const c = cols.find((c) => c.key === st.sort), g = c.sortVal || ((x) => x[c.key]); r = [...r].sort((a, b) => { const A = g(a), B = g(b); return (A > B ? 1 : A < B ? -1 : 0) * st.dir; }); }
    return r;
  };
  const draw = () => {
    const r = view(), pages = Math.max(1, Math.ceil(r.length / pageSize)); st.page = Math.min(st.page, pages);
    const slice = r.slice((st.page - 1) * pageSize, st.page * pageSize);
    clear(tbody);
    if (!slice.length) tbody.append(h('tr', null, h('td', { colSpan: cols.length }, stateBox('empty', empty))));
    slice.forEach((x) => tbody.append(h('tr', { class: (onRow ? 'click ' : '') + (rowClass?.(x) || ''), onclick: onRow ? () => onRow(x) : null, tabIndex: onRow ? 0 : null, onkeydown: onRow ? (e) => e.key === 'Enter' && onRow(x) : null }, cols.map((c) => h('td', { class: c.align || '' }, c.render ? c.render(x) : x[c.key])))));
    info.textContent = r.length ? `Hiển thị ${(st.page - 1) * pageSize + 1}-${(st.page - 1) * pageSize + slice.length} của ${r.length}` : '';
    clear(pager);
    const pb = (label, p, on, dis) => h('button', { class: 'pg' + (on ? ' on' : ''), disabled: dis, 'aria-label': 'Trang ' + label, onclick: () => { st.page = p; draw(); } }, label);
    pager.append(pb('‹', st.page - 1, false, st.page === 1));
    const win = [...new Set([1, st.page - 1, st.page, st.page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
    win.forEach((p, i) => { if (i && p - win[i - 1] > 1) pager.append(h('span', { class: 'muted' }, '…')); pager.append(pb(String(p), p, p === st.page)); });
    pager.append(pb('›', st.page + 1, false, st.page === pages));
    root._count = r.length; root._rows = r;
    if (footer) { footerEl.replaceChildren(footer(r)); }
  };
  const thead = h('thead', null, h('tr', null, cols.map((c) => h('th', { class: (c.align || '') + (c.sortable === false || c.noSort ? '' : ' sortable'), onclick: c.noSort ? null : () => { st.dir = st.sort === c.key ? -st.dir : 1; st.sort = c.key; draw(); } }, c.label, st.sort === c.key ? (st.dir > 0 ? ' ▲' : ' ▼') : ''))));
  const footerEl = h('div', { class: 'dt-foot' });
  const search = searchText ? h('input', { class: 'search', type: 'search', placeholder, 'aria-label': 'Tìm kiếm', oninput: (e) => { st.q = e.target.value; st.page = 1; draw(); } }) : null;
  const tb = h('div', { class: 'dt-bar' }, search, filters.map((f) => h('select', { 'aria-label': f.label, onchange: (e) => { st.f[f.key] = e.target.value; st.page = 1; draw(); } }, h('option', { value: 'all' }, f.label), f.options.map(([v, l]) => h('option', { value: v, selected: st.f[f.key] === v }, l)))), h('span', { class: 'grow' }), toolbar, exportName && canExport ? h('button', { class: 'btn ghost sm', onclick: () => { const rr = root._rows; download(exportName + '.csv', csvStringify([cols.filter((c) => !c.noExport).map((c) => c.label), ...rr.map((x) => cols.filter((c) => !c.noExport).map((c) => (c.csv ? c.csv(x) : c.sortVal ? c.sortVal(x) : x[c.key])))])); } }, '⬇ Xuất CSV') : null);
  root.append(tb, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, thead, tbody)), footerEl, h('div', { class: 'dt-pg' }, pager, info));
  draw(); root.redraw = draw; root.setFilter = (k, v) => { st.f[k] = v; draw(); };
  return root;
}
