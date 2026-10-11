// QA "người dùng thật": bấm MỌI nút/tab/bộ lọc trên mọi trang, thử gửi form rỗng, tìm NaN/undefined/lỗi console.
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/'); const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8777/', roles = (process.argv[3] || 'admin').split(',');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const pages = (process.argv[4] || 'dashboard,cashflow,ar,ap,profit,sales,purchase,inventory,budget,coffee,catam,nhayen,scenario,ai,approvals,reports,system').split(',');
const issues = new Map(); const stats = { clicks: 0, modals: 0, submits: 0 };
const note = (k) => issues.set(k, (issues.get(k) || 0) + 1);
for (const role of roles) {
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } }), p = await ctx.newPage(); let where = '';
  p.on('pageerror', (e) => note(`[${role}] ${where} PAGEERROR ${e.message}`)); p.on('console', (m) => m.type() === 'error' && note(`[${role}] ${where} CONSOLE ${m.text().slice(0, 120)}`)); p.on('dialog', (d) => d.accept());
  await p.goto(base); await p.fill('input[type=email]', role + '@ongvang.demo'); await p.fill('input[type=password]', 'demo123'); await p.click('.login-card .btn'); await p.waitForSelector('.layout');
  const scan = async (tag) => { const t = await p.evaluate(() => document.querySelector('.main')?.innerText + ' ' + [...document.querySelectorAll('.modal')].map((m) => m.innerText).join(' ')); const m = t.match(/NaN|undefined|Infinity|\[object|null%|null đ/); if (m) note(`[${role}] ${where} ${tag} hiển thị "${m[0]}"`); if (/Không tải được/.test(t)) note(`[${role}] ${where} ${tag} trang lỗi`); };
  for (const pg of pages) {
    console.error('page', pg, new Date().toISOString().slice(11, 19)); where = pg; await p.goto(base + '#/' + pg); await p.waitForTimeout(500); await scan('load');
    const nTabs = await p.locator('.tabs .tab').count();
    for (let t = 0; t < Math.max(nTabs, 1); t++) {
      if (nTabs) { await p.locator('.tabs .tab').nth(t).click(); await p.waitForTimeout(250); }
      where = `${pg}/tab${t}`; await scan('tab');
      // select/filter: chọn từng option của mỗi select
      const selects = await p.locator('.main select').count();
      for (let s = 0; s < selects; s++) { const sel = p.locator('.main select').nth(s); const opts = await sel.locator('option').evaluateAll((o) => o.map((x) => x.value)); for (const v of opts.slice(0, 3)) { try { await sel.selectOption(v, { timeout: 1500 }); } catch { break; } await p.waitForTimeout(120); await scan('select'); } await p.goto(base + '#/' + pg); await p.waitForTimeout(250); if (nTabs) await p.locator('.tabs .tab').nth(t).click(); }
      // click từng button/link trong .main (trừ tab, đăng xuất)
      const btnCount = await p.locator('.main button:not(.tab):not(.pg), .main a.btn, .main a.kpi, .main tbody tr.click').count();
      for (let i = 0; i < Math.min(btnCount, 25); i++) {
        const el = p.locator('.main button:not(.tab):not(.pg), .main a.btn, .main a.kpi, .main tbody tr.click').nth(i);
        let label = ''; try { label = (await el.innerText({ timeout: 800 })).trim().slice(0, 30); } catch { continue; }
        if (/Xóa dữ liệu|Khôi phục từ file|Khôi phục DEMO/.test(label)) continue;
        try { await el.click({ timeout: 1500 }); stats.clicks++; } catch { continue; }
        await p.waitForTimeout(200); where = `${pg}/tab${t}/"${label}"`;
        if (await p.locator('.overlay').count()) {
          stats.modals++; await scan('modal');
          // thử gửi form rỗng: không được crash, phải báo lỗi hoặc xử lý hợp lệ
          const sub = p.locator('.overlay button[type=submit]').first();
          if (await sub.count()) { try { await sub.click({ timeout: 1000 }); stats.submits++; await p.waitForTimeout(250); await scan('submit-rỗng'); } catch {} }
          await p.keyboard.press('Escape'); await p.waitForTimeout(100); if (await p.locator('.overlay').count()) await p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => o.remove()));
        } else { await scan('click'); if (!(await p.url()).includes('#/' + pg)) { await p.goto(base + '#/' + pg); await p.waitForTimeout(250); if (nTabs) await p.locator('.tabs .tab').nth(t).click(); } }
      }
      await p.goto(base + '#/' + pg); await p.waitForTimeout(200); if (nTabs && t + 1 < nTabs) {} 
    }
  }
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(stats)); console.log(issues.size ? [...issues].map(([k, v]) => `${v}× ${k}`).join('\n') : 'KHÔNG PHÁT HIỆN LỖI');
