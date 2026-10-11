// Smoke test trình duyệt: đăng nhập từng vai trò, mở mọi trang, bắt lỗi console, chụp ảnh. Chạy: node tests/smoke.mjs <baseUrl> <outDir>
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8777/', out = process.argv[3] || '/tmp/shots';
import fs from 'fs'; fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = [];
const pages = ['dashboard', 'cashflow', 'ar', 'ap', 'profit', 'sales', 'purchase', 'inventory', 'budget', 'coffee', 'catam', 'nhayen', 'scenario', 'ai', 'approvals', 'reports', 'system'];
async function run(email, list, shot) {
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } }); const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errors.push(`[${email}] console: ${m.text()}`)); p.on('pageerror', (e) => errors.push(`[${email}] pageerror: ${e.message}`));
  await p.goto(base); await p.waitForSelector('.login-card'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'demo123'); await p.click('.login-card .btn'); await p.waitForSelector('.layout');
  for (const pg of list) {
    await p.goto(base + '#/' + pg); await p.waitForTimeout(700);
    const st = await p.evaluate(() => document.querySelector('.main')?.innerText.slice(0, 80));
    if (/Không tải được|Lỗi/.test(st || '')) errors.push(`[${email}] ${pg}: ${st}`);
    const n = await p.locator('.tabs .tab').count();
    for (let i = 0; i < n; i++) { await p.locator('.tabs .tab').nth(i).click(); await p.waitForTimeout(350); const t = await p.evaluate(() => document.querySelector('.main')?.innerText.slice(0, 120)); if (/Không tải được|Lỗi/.test(t || '')) errors.push(`[${email}] ${pg} tab ${i}: ${t}`); if (shot) await p.screenshot({ path: `${out}/${pg}-t${i}.png`, fullPage: true }); }
    if (shot) await p.screenshot({ path: `${out}/${pg}.png`, fullPage: true });
  }
  await ctx.close();
}
await run('admin@ongvang.demo', pages, true);
for (const r of ['ketoan', 'kinhdoanh', 'thumua', 'kho', 'quanlymang', 'xem']) await run(r + '@ongvang.demo', pages, false);
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
await b.close();
