import { h, clear, badge, toast, openModal, $ } from './ui/dom.js';
import { init, state, login, logout, subscribe, resetDemo, roleCan } from './core/store.js';
import { ROLES, can } from './core/rbac.js';
import { fmtDate } from './core/dates.js';
import { pendingFor } from './pages/approvals.js';

const PAGES = [
  ['dashboard', '🏠', 'Trang chủ', 'dashboard'], ['cashflow', '💵', 'Dòng tiền', 'cashflow'], ['ar', '📥', 'Công nợ phải thu', 'ar'], ['ap', '📤', 'Công nợ phải trả', 'ap'],
  ['profit', '📊', 'Lợi nhuận theo mảng', 'profit'], ['sales', '🛒', 'Bán hàng', 'sales'], ['purchase', '📦', 'Mua hàng', 'purchase'], ['inventory', '🏬', 'Kho hàng', 'inventory'],
  ['budget', '🧾', 'Ngân sách & chi phí', 'budget'], ['coffee', '☕', 'Thu mua cà phê', 'coffee'], ['catam', '🐟', 'Cá tầm', 'ops'], ['nhayen', '🏠', 'Nhà yến', 'ops'],
  ['scenario', '🧪', 'Kịch bản vốn', 'scenario'], ['ai', '🤖', 'Trợ lý AI', 'ai'], ['approvals', '✅', 'Phê duyệt', 'approvals'], ['reports', '📑', 'Báo cáo', 'reports'], ['system', '⚙️', 'Hệ thống', 'system'],
];
const loaders = {
  dashboard: () => import('./pages/dashboard.js'), cashflow: () => import('./pages/cashflow.js'), ar: () => import('./pages/ar.js'), ap: () => import('./pages/ap.js'), profit: () => import('./pages/profit.js'),
  sales: () => import('./pages/sales.js'), purchase: () => import('./pages/purchase.js'), inventory: () => import('./pages/inventory.js'), budget: () => import('./pages/budget.js'), coffee: () => import('./pages/coffee.js'),
  catam: () => import('./pages/ops.js'), nhayen: () => import('./pages/ops.js'), scenario: () => import('./pages/scenario.js'), ai: () => import('./pages/ai.js'), approvals: () => import('./pages/approvals.js'),
  reports: () => import('./pages/reports.js'), system: () => import('./pages/system.js'),
};
const app = document.getElementById('app');
export const route = () => { const [p, q = ''] = (location.hash.slice(2) || 'dashboard').split('?'); return { page: p || 'dashboard', params: Object.fromEntries(new URLSearchParams(q)) }; };
export const go = (page, params) => { location.hash = '#/' + page + (params ? '?' + new URLSearchParams(params) : ''); };
let mainEl = null, rendering = 0;

async function renderPage() {
  const { page, params } = route(), meta = PAGES.find((p) => p[0] === page);
  if (!mainEl) return;
  const mine = ++rendering;
  document.querySelectorAll('.overlay').forEach((o) => o.remove()); // đóng hộp thoại khi chuyển trang
  clear(mainEl);
  if (!meta) { mainEl.append(h('div', { class: 'state empty' }, 'Không tìm thấy trang. ', h('a', { href: '#/dashboard' }, 'Về trang chủ'))); return; }
  if (!can(state.user, meta[3], 'view')) { mainEl.append(h('div', { class: 'state error' }, `Vai trò "${ROLES[state.user.role].name}" không có quyền xem mục "${meta[2]}".`)); return; }
  mainEl.append(h('div', { class: 'state loading' }, 'Đang tải…'));
  try {
    const mod = await loaders[page]();
    if (mine !== rendering) return;
    const node = await mod.render(params, { go, refresh: renderPage, kind: page });
    if (mine !== rendering) return;
    clear(mainEl); mainEl.append(node); document.title = meta[2] + ' – Ong Vàng';
  } catch (e) { console.error(e); clear(mainEl); mainEl.append(h('div', { class: 'state error', role: 'alert' }, 'Không tải được trang: ' + e.message, ' ', h('button', { class: 'btn sm', onclick: renderPage }, 'Thử lại'))); }
  document.querySelectorAll('.nav-i').forEach((a) => a.classList.toggle('on', a.dataset.p === page));
  const n = pendingFor(state.user).length; ['pend-nav', 'pend-bell'].forEach((id) => { const e = document.getElementById(id); if (e) { e.textContent = n; e.hidden = !n; } });
  document.body.classList.remove('nav-open');
}

function shell() {
  const u = state.user, pend = pendingFor(u).length;
  const side = h('aside', { class: 'side' }, h('a', { class: 'logo', href: '#/dashboard' }, h('span', { class: 'logo-ic', html: '<svg width="40" height="40" viewBox="0 0 48 48"><g fill="#e6b422"><path d="M24 4c5 5 6 11 0 17-6-6-5-12 0-17z"/><path d="M8 14c7-1 13 2 14 9-7 1-13-2-14-9z"/><path d="M40 14c-7-1-13 2-14 9 7 1 13-2 14-9z"/><path d="M23 25h2v17h-2z"/><path d="M24 36c-6 0-10-3-12-7 6-1 10 1 12 7zM24 36c6 0 10-3 12-7-6-1-10 1-12 7z"/></g></svg>' }), h('span', null, h('b', null, 'ONG VÀNG'), h('small', null, 'KẾT NỐI GIÁ TRỊ NÔNG NGHIỆP'))),
    h('nav', { 'aria-label': 'Điều hướng chính' }, PAGES.filter((p) => can(u, p[3], 'view')).map(([id, ic, label]) => h('a', { class: 'nav-i', href: '#/' + id, 'data-p': id }, h('i', null, ic), label, id === 'approvals' ? h('em', { class: 'dot', id: 'pend-nav', hidden: !pend }, pend) : null))),
    h('div', { class: 'side-foot' }, h('span', { class: 'demo' }, 'DỮ LIỆU DEMO'), h('small', null, 'Chưa phải số liệu thực')));
  const results = h('div', { class: 'gs-res', hidden: true });
  const gs = h('input', { type: 'search', placeholder: 'Tìm khách hàng, đơn, sản phẩm…', 'aria-label': 'Tìm kiếm chung', oninput: (e) => globalSearch(e.target.value, results), onblur: () => setTimeout(() => (results.hidden = true), 200) });
  const top = h('header', { class: 'top' }, h('button', { class: 'burger', 'aria-label': 'Mở menu', onclick: () => document.body.classList.toggle('nav-open') }, '☰'), h('div', { class: 'gs' }, gs, results), h('span', { class: 'grow' }),
    h('a', { class: 'bell', href: '#/approvals', title: 'Việc chờ duyệt', 'aria-label': `${pend} việc chờ duyệt` }, '🔔', h('em', { class: 'dot', id: 'pend-bell', hidden: !pend }, pend)),
    h('div', { class: 'me' }, h('div', { class: 'av' }, u.name.split(' ').at(-1)[0]), h('div', null, h('b', null, u.name), h('small', null, u.title)), h('button', { class: 'btn ghost sm', onclick: () => { logout(); } }, 'Đăng xuất')));
  mainEl = h('main', { class: 'main', id: 'main' });
  clear(app).append(h('div', { class: 'layout' }, side, h('div', { class: 'col' }, top, mainEl, h('footer', { class: 'foot' }, 'Ong Vàng – Báo cáo quản trị, không thay thế sổ sách/báo cáo pháp định. Dữ liệu DEMO.')), h('div', { class: 'scrim', onclick: () => document.body.classList.remove('nav-open') })));
  renderPage();
}
function globalSearch(q, box) {
  q = q.trim().toLowerCase(); box.replaceChildren(); if (q.length < 2) { box.hidden = true; return; }
  const d = state.db, hits = [];
  if (can(state.user, 'ar', 'view')) d.customers.filter((c) => (c.name + c.code).toLowerCase().includes(q)).slice(0, 4).forEach((c) => hits.push(['Khách hàng', c.name, '#/ar?q=' + encodeURIComponent(c.name)]));
  if (can(state.user, 'sales', 'view')) d.salesOrders.filter((o) => o.id.toLowerCase().includes(q)).slice(0, 3).forEach((o) => hits.push(['Đơn hàng', o.id, '#/sales?q=' + o.id]));
  if (can(state.user, 'inventory', 'view')) d.products.filter((p) => (p.name + p.sku).toLowerCase().includes(q)).slice(0, 4).forEach((p) => hits.push(['Sản phẩm', p.name, '#/inventory?q=' + encodeURIComponent(p.sku)]));
  box.hidden = false; if (!hits.length) box.append(h('div', { class: 'gs-i muted' }, 'Không có kết quả'));
  hits.forEach(([k, t, href]) => box.append(h('a', { class: 'gs-i', href }, h('small', null, k), t)));
}
function loginView() {
  const err = h('div', { class: 'form-err', role: 'alert' }), email = h('input', { type: 'email', required: true, autocomplete: 'username', placeholder: 'admin@ongvang.demo', value: 'admin@ongvang.demo' }), pw = h('input', { type: 'password', required: true, autocomplete: 'current-password', placeholder: 'Mật khẩu', value: 'demo123' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Đăng nhập');
  const submit = async (e) => { e?.preventDefault(); err.textContent = ''; btn.disabled = true; try { await login(email.value, pw.value); } catch (ex) { err.textContent = ex.message; btn.disabled = false; } };
  clear(app).append(h('div', { class: 'login' }, h('div', { class: 'login-hero' }, h('h1', null, 'ONG VÀNG'), h('p', null, 'Quản trị lợi nhuận & dòng tiền'), h('small', null, 'Kết nối giá trị nông nghiệp Tây Nguyên')),
    h('form', { class: 'login-card', onsubmit: submit }, h('h2', null, 'Đăng nhập'), h('p', { class: 'note' }, 'Bản DEMO: dữ liệu mẫu lưu trên trình duyệt của bạn, tách biệt dữ liệu thật. Mật khẩu tài khoản demo: demo123.'), h('label', { class: 'fld' }, h('span', null, 'Email'), email), h('label', { class: 'fld' }, h('span', null, 'Mật khẩu'), pw), err, btn,
      h('div', { class: 'demo-users' }, h('small', null, 'Đăng nhập nhanh theo vai trò:'), h('div', null, state.db.users.filter((u) => u.active).map((u) => h('button', { type: 'button', class: 'chip', onclick: () => { email.value = u.email; pw.value = 'demo123'; submit(); } }, ROLES[u.role].name.split(' / ')[0]))),
      h('button', { type: 'button', class: 'link', onclick: async () => { if (confirm('Khôi phục toàn bộ dữ liệu DEMO ban đầu? Mọi thay đổi trên trình duyệt này sẽ mất.')) { await resetDemo(); toast('Đã khôi phục dữ liệu DEMO'); } } }, 'Khôi phục dữ liệu DEMO')))));
}
let lastUser = undefined;
async function boot() {
  await init();
  const draw = () => { if (!state.user) { lastUser = null; loginView(); } else if (lastUser !== state.user.id) { lastUser = state.user.id; shell(); } };
  subscribe(() => { if (state.user?.id !== lastUser) draw(); });
  window.addEventListener('hashchange', () => state.user && renderPage());
  draw();
  window.__refresh = renderPage;
}
boot().catch((e) => { console.error(e); app.textContent = 'Lỗi khởi động: ' + e.message; });
