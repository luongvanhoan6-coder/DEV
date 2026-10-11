// E2E luồng chính trên trình duyệt: tạo đơn → duyệt → giao hàng → thu tiền; lô cà phê; phê duyệt; mobile. node tests/e2e.mjs <baseUrl> <outDir>
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/'); const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8777/', out = process.argv[3] || '/tmp/shots2'; import fs from 'fs'; fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errs = []; let ok = 0; const check = (c, m) => { if (c) ok++; else errs.push('FAIL: ' + m); };
async function session(email, viewport = { width: 1360, height: 900 }) { const ctx = await b.newContext({ viewport }), p = await ctx.newPage(); p.on('pageerror', (e) => errs.push('pageerror ' + e.message)); p.on('console', (m) => m.type() === 'error' && errs.push('console ' + m.text())); p.on('dialog', (d) => d.accept()); await p.goto(base); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'demo123'); await p.click('.login-card .btn'); await p.waitForSelector('.layout'); return { p, ctx }; }
// 1) Kinh doanh tạo đơn dưới ngưỡng
let { p, ctx } = await session('kinhdoanh@ongvang.demo');
await p.goto(base + '#/sales'); await p.waitForSelector('.dt'); await p.click('text=+ Tạo đơn hàng'); await p.waitForSelector('.modal');
await p.locator('.modal tbody input[type=number]').nth(1).fill('1000'); // đơn giá thấp
await p.locator('.modal textarea').fill('Khách chiến lược'); await p.click('.modal button[type=submit]'); await p.waitForSelector('.toast');
check(/gửi duyệt|Đơn DH/.test(await p.locator('.toast').first().innerText()), 'tạo đơn ngoại lệ gửi duyệt');
await p.screenshot({ path: out + '/order-created.png' }); await ctx.close();
// 2) Admin duyệt
({ p, ctx } = await session('admin@ongvang.demo'));
await p.goto(base + '#/approvals'); await p.waitForSelector('.dt');
const n0 = await p.locator('.tbl tbody tr').count(); check(n0 >= 2, 'có yêu cầu chờ duyệt: ' + n0);
await p.locator('.tbl tbody tr').first().click(); await p.waitForSelector('.modal'); await p.locator('.modal button.btn:not(.ghost)', { hasText: /^Duyệt$/ }).click(); await p.waitForTimeout(500);
check((await p.locator('.toast').allInnerTexts()).some((t) => /Đã duyệt/.test(t)), 'duyệt thành công');
// 3) Cà phê: nhập lô
await p.goto(base + '#/coffee?tab=new'); await p.waitForSelector('form.card');
await p.fill('input[name=supplier]', 'Hộ nông dân - Anh Tuấn'); await p.fill('input[name=kg]', '5000'); await p.fill('input[name=pricePerKg]', '42000'); await p.fill('input[name=transport]', '2500000'); await p.fill('input[name=drying]', '3000000'); await p.fill('input[name=labor]', '500000'); await p.fill('input[name=other]', '200000');
const txt = await p.locator('.cost-box').innerText(); check(txt.includes('43,240') && txt.includes('216,200,000'), 'giá vốn thực tế 43,240 / 216,200,000: ' + txt.replace(/\n/g, ' '));
await p.screenshot({ path: out + '/coffee-form.png', fullPage: true }); await p.click('form.card button[type=submit]'); await p.waitForTimeout(600);
check((await p.locator('.toast').allInnerTexts()).some((t) => /Đã lưu lô/.test(t)), 'lưu lô cà phê');
// 4) Công nợ: mở khách, ghi cam kết
await p.goto(base + '#/ar'); await p.waitForSelector('.dt'); await p.locator('.tbl tbody tr').first().click(); await p.waitForSelector('.modal'); await p.screenshot({ path: out + '/ar-modal.png' });
await p.click('text=+ Ghi cam kết thanh toán'); await p.waitForSelector('.modal >> nth=1'); await p.locator('.modal').nth(1).locator('input[name=amount]').fill('1000'); await p.locator('.modal').nth(1).locator('input[name=contact]').fill('Anh B'); await p.locator('.modal').nth(1).locator('button[type=submit]').click(); await p.waitForTimeout(500);
check((await p.locator('.toast').allInnerTexts()).some((t) => /Đã ghi cam kết/.test(t)), 'ghi cam kết');
// 5) AI
await p.goto(base + '#/ai'); await p.waitForSelector('.chat'); await p.fill('.chat ~ div input, input[placeholder^="Hỏi"]', 'Phân tích tình hình công nợ'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
check((await p.locator('.msg.a').last().innerText()).includes('SỐ THỰC TẾ'), 'AI trả lời có nhãn nguồn'); await p.screenshot({ path: out + '/ai.png', fullPage: true });
// 6) Hệ thống: audit có log
await p.goto(base + '#/system?tab=audit'); await p.waitForSelector('.dt'); check((await p.locator('.tbl tbody tr').count()) > 3, 'audit có bản ghi');
await ctx.close();
// 7) Mobile
({ p, ctx } = await session('admin@ongvang.demo', { width: 390, height: 800 }));
for (const pg of ['dashboard', 'cashflow', 'approvals', 'sales']) { await p.goto(base + '#/' + pg); await p.waitForTimeout(500); const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check(ov <= 2, `mobile ${pg} không tràn ngang (${ov}px)`); await p.screenshot({ path: `${out}/m-${pg}.png`, fullPage: false }); }
await ctx.close(); await b.close();
console.log(errs.length ? errs.join('\n') : 'E2E OK', '| checks passed:', ok);
