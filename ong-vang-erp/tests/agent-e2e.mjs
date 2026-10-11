// E2E popup: node tests/agent-e2e.mjs <localUrl> <staticUrl> <outDir>  (cần claude đã đăng nhập để hỏi thật)
import { createRequire } from 'module'; const require = createRequire('/opt/node22/lib/node_modules/'); const { chromium } = require('playwright');
const [local, stat, out] = [process.argv[2] || 'http://localhost:8788/', process.argv[3] || 'http://localhost:8777/', process.argv[4] || '/tmp/ag']; import fs from 'fs'; fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] }); const errs = []; let ok = 0; const check = (c, m) => { c ? ok++ : errs.push('FAIL ' + m); };
const login = async (url, email, vp = { width: 1360, height: 900 }) => { const p = await (await b.newContext({ viewport: vp })).newPage(); p.on('pageerror', (e) => errs.push('pageerror ' + e.message)); await p.goto(url); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'demo123'); await p.click('.login-card .btn'); await p.waitForSelector('.layout'); return p; };
// 1) bản "hosted" (không có máy chủ cục bộ) => KHÔNG có popup
let p = await login(stat, 'admin@ongvang.demo'); await p.waitForTimeout(1200); check((await p.locator('.ag-root').count()) === 0, 'popup phải ẩn khi không có máy chủ cục bộ'); await p.context().close();
// 2) bản local
p = await login(local, 'admin@ongvang.demo'); await p.waitForSelector('.ag-fab'); check((await p.locator('.ag-fab').innerText()).includes('TRỢ LÝ XINH ĐẸP'), 'tên hiển thị'); await p.screenshot({ path: out + '/1-fab.png' });
await p.click('.ag-fab'); await p.waitForSelector('.ag-panel:not([hidden])'); check((await p.locator('.ag-h').innerText()).includes('TRỢ LÝ XINH ĐẸP'), 'tiêu đề panel'); check((await p.locator('.ag-msg.bot').first().innerText()).includes('Chào'), 'lời chào'); await p.screenshot({ path: out + '/2-open.png' });
await p.locator('.ag-chips .chip').first().click(); await p.waitForSelector('.ag-msg.bot:not(.typing):nth-of-type(3), .ag-msg.err', { timeout: 170000 });
const ans = (await p.locator('.ag-msg.bot').last().innerText()); console.log('--- TRẢ LỜI ---\n' + ans.slice(0, 1800)); check(!(await p.locator('.ag-msg.err').count()), 'không lỗi: ' + ans.slice(0, 200)); check(ans.length > 80, 'trả lời có nội dung'); await p.screenshot({ path: out + '/3-answer.png' });
// điều hướng giữ popup; đóng bằng Esc
await p.goto(local + '#/ar'); await p.waitForTimeout(500); check((await p.locator('.ag-root').count()) === 1, 'popup còn sau khi chuyển trang'); await p.keyboard.press('Escape');
await p.context().close();
// 3) xem-only: thấy ít dữ liệu hơn nhưng popup vẫn có; mobile
p = await login(local, 'xem@ongvang.demo', { width: 390, height: 800 }); await p.waitForSelector('.ag-fab'); await p.click('.ag-fab'); await p.waitForSelector('.ag-panel:not([hidden])'); await p.screenshot({ path: out + '/4-mobile.png' });
const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); check(ov <= 2, 'mobile không tràn ngang ' + ov);
await b.close(); console.log(errs.length ? errs.join('\n') : 'AGENT E2E OK', '| checks:', ok);
