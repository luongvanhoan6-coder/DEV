// Môi trường giả lập trình duyệt cho kiểm thử store trong Node
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };
globalThis.localStorage = mem(); globalThis.sessionStorage = mem();
export const store = await import('../js/core/store.js');
export const q = await import('../js/core/queries.js');
export async function fresh(email = 'admin@ongvang.demo') { localStorage.clear(); sessionStorage.clear(); await store.init(); await store.login(email, 'demo123'); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
