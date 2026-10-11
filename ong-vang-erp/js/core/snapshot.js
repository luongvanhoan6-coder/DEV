// Bản tóm tắt TOÀN BỘ phần mềm dạng văn bản để đưa cho Trợ lý. Tôn trọng phân quyền: chỉ gồm module vai trò hiện tại được xem.
import { state } from './store.js';
import { can, ROLES } from './rbac.js';
import { balance, daysOverdue } from './calc.js';
import { periodStats, profitBySegment, monthlySeries, forecast, arByCustomer, arAging, apInvoices, apAging, inventoryView, workingCapital, budgetRows, buildAlerts, cashBalance, unreconciled, accountBalance, T } from './queries.js';
import { addMonths, monthKey, fmtDate } from './dates.js';
import { fmt, pct, sum } from './format.js';
import { coffeeLotResult } from './calc.js';
import { opsStats } from '../pages/ops.js';

const M = (n) => (n == null ? 'N/A' : fmt(n));
export function buildSnapshot(user = state.user) {
  const d = state.db, st = d.settings, now = T(), cur = monthKey(now), prev = addMonths(cur, -1), L = [], sec = (t) => L.push('', '## ' + t);
  const ok = (m) => can(user, m, 'view'), scope = user.segments === 'all' ? undefined : user.segments;
  L.push(`# Bản tóm tắt phần mềm Ong Vàng (quản trị lợi nhuận & dòng tiền)`, `Ngày dữ liệu: ${fmtDate(now)} (${d.demo ? 'DỮ LIỆU DEMO, không phải số thực' : 'dữ liệu thực'}). Người đang hỏi: ${user.name} – ${user.title} – vai trò ${ROLES[user.role].name}${scope ? ' – chỉ thấy mảng: ' + scope.join(', ') : ''}.`, `Cấu hình: giá vốn ${st.costMethod === 'avg' ? 'bình quân gia quyền' : 'FIFO'}; phân bổ chi phí chung theo ${st.allocationMethod}; ngưỡng tiền tối thiểu ${M(st.minCash)}; ngưỡng biên đơn hàng ${st.marginThreshold}%; ${st.confirmed ? 'thông số đã được admin xác nhận' : 'THÔNG SỐ ĐANG LÀ MẶC ĐỊNH DEMO, CHƯA XÁC NHẬN'}; khóa kỳ đến: ${st.lockedThrough || 'chưa khóa'}.`);
  L.push(`Các module bạn được xem: ${['dashboard', 'cashflow', 'ar', 'ap', 'profit', 'sales', 'purchase', 'inventory', 'budget', 'coffee', 'ops', 'scenario', 'ai', 'approvals', 'reports'].filter(ok).join(', ')}. Dữ liệu ngoài danh sách này KHÔNG có trong bản tóm tắt.`);
  if (ok('dashboard') || ok('profit')) {
    sec('KẾT QUẢ KINH DOANH (doanh thu thuần, lãi gộp, lợi nhuận quản trị = lãi gộp − CP trực tiếp − CP chung)');
    for (const m of [prev, cur]) { const s = periodStats(m, { scope }); L.push(`- ${m}${m === cur ? ' (tháng hiện tại, CHƯA CHỐT)' : ''}: doanh thu ${M(s.revenue)}; giá vốn ${M(s.cogs)}; lãi gộp ${M(s.gross)} (biên ${pct(s.margin)}); CP trực tiếp ${M(s.direct)}; CP chung ${M(s.shared)}; lợi nhuận ${M(s.profit)}; ${s.orders} đơn.`); }
    L.push('- 12 tháng gần nhất (doanh thu / lợi nhuận): ' + monthlySeries({ scope }, 12).map((x) => `${x.month.slice(2)}: ${Math.round(x.revenue / 1e6)}tr/${Math.round(x.profit / 1e6)}tr`).join('; '));
    L.push(`- Theo mảng, tháng ${prev} (doanh thu | lãi gộp | lợi nhuận sau phân bổ | tỷ suất): ` + profitBySegment(prev).filter((r) => (!scope || scope.includes(r.id)) && r.revenue > 0).map((r) => `${r.name} ${Math.round(r.revenue / 1e6)}tr|${Math.round(r.gross / 1e6)}tr|${Math.round(r.profit / 1e6)}tr|${pct(r.profitMargin)}`).join('; '));
  }
  if (ok('cashflow')) {
    const fc = forecast('base'); sec('TIỀN & DÒNG TIỀN 13 TUẦN (dự báo, kịch bản cơ sở)');
    L.push(`- Số dư hiện tại ${M(cashBalance())} (${d.cashAccounts.map((a) => a.name + ' ' + M(accountBalance(a.id))).join('; ')}); ${unreconciled().length} giao dịch chưa đối soát.`, `- Tổng thu dự kiến ${M(fc.totalIn)}; tổng chi dự kiến ${M(fc.totalOut)}; số dư cuối tuần 13 ${M(fc.closing)}.`, '- Theo tuần (thu/chi/số dư cuối/trạng thái): ' + fc.weeks.map((w) => `T${w.idx + 1} ${Math.round(w.in / 1e6)}/${Math.round(w.out / 1e6)}/${Math.round(w.closing / 1e6)}tr/${w.status}`).join('; '), `- Khoản phải thu quá hạn CHƯA có cam kết (không đưa vào dự báo): ${fc.unforecast.length} khoản, ${M(sum(fc.unforecast, (x) => x.amount))}.`);
  }
  if (ok('ar')) {
    const rows = arByCustomer(user), ag = arAging(rows); sec('CÔNG NỢ PHẢI THU');
    L.push(`- Tổng ${M(ag.total)}; chưa đến hạn ${M(ag.current)}; quá hạn ${M(ag.overdue)}; theo dải: ` + st.agingBands.map((b) => `${b.label} ${M(ag[b.key])}`).join('; '), '- Khách nợ lớn nhất (tổng | quá hạn | số ngày quá hạn tối đa | hạn mức): ' + rows.slice(0, 10).map((r) => `${r.name} ${M(r.total)}|${M(r.overdue)}|${r.maxDays}ng|${M(r.customer.creditLimit)}${r.overLimit ? ' VƯỢT HẠN MỨC' : ''}`).join('; '), `- Cam kết thanh toán đang mở: ${d.commitments.filter((c) => c.status === 'open').length}.`);
  }
  if (ok('ap')) {
    const ag = apAging(), open = apInvoices().filter((i) => balance(i) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)); sec('CÔNG NỢ PHẢI TRẢ');
    L.push(`- Tổng ${M(ag.total)}; quá hạn ${M(ag.overdue)}; chờ duyệt thanh toán: ${open.filter((i) => i.requestStatus === 'pending').length}.`, '- Sắp đến hạn: ' + open.slice(0, 8).map((i) => `${d.suppliers.find((s) => s.id === i.partyId)?.name} ${M(balance(i))} hạn ${fmtDate(i.dueDate)} (${i.requestStatus})`).join('; '));
  }
  if (ok('inventory')) {
    const v = inventoryView(), wc = workingCapital(); sec('TỒN KHO & VỐN LƯU ĐỘNG');
    L.push(`- Giá trị tồn ${M(sum(v, (x) => x.value))}; ${v.length} mặt hàng; sắp hết ${v.filter((x) => x.status === 'low').length}; có lô quá hạn dùng ${v.filter((x) => x.status === 'expired').length}; gần hết hạn ${v.filter((x) => x.status === 'expiring').length}; chậm luân chuyển ${v.filter((x) => x.status === 'slow').length}.`, `- Vòng quay tồn ${wc.turnover == null ? 'N/A' : wc.turnover.toFixed(1) + '/năm'}; DSO ${wc.dso == null ? 'N/A' : wc.dso.toFixed(0) + ' ngày'}; vốn lưu động ròng ${M(wc.net)}.`, '- Hàng cần chú ý: ' + v.filter((x) => x.status !== 'normal').slice(0, 12).map((x) => `${x.p.name} (${x.status}, tồn ${Math.round(x.qty)})`).join('; '));
  }
  if (ok('budget')) { sec('NGÂN SÁCH THÁNG ' + cur); const rows = budgetRows(cur); L.push(`- Tổng ngân sách ${M(sum(rows, (r) => r.budget))}; thực tế ${M(sum(rows, (r) => r.actual))}.`, '- Vượt ngân sách: ' + (rows.filter((r) => r.ratio > st.budgetWarnPct).map((r) => `${r.segmentId ? 'trực tiếp ' + r.segmentId : r.category} ${pct(r.ratio, 0)}`).join('; ') || 'không có')); }
  if (ok('sales')) { const os = d.salesOrders; sec('ĐƠN HÀNG BÁN'); L.push(`- Đang xử lý ${os.filter((o) => o.status === 'processing').length}; chờ duyệt ${os.filter((o) => o.status === 'pending_approval').length}; báo giá ${os.filter((o) => o.status === 'quote').length}; tổng số đơn ${os.length}.`); }
  if (ok('purchase')) { const ps = d.purchaseOrders; sec('MUA HÀNG'); L.push(`- Đề nghị mua chờ duyệt ${ps.filter((p) => p.status === 'pending_approval').length}; đã duyệt chờ nhập kho ${ps.filter((p) => p.status === 'approved').length}.`); }
  if (ok('coffee')) { const rs = d.coffeeLots.map(coffeeLotResult); sec('THU MUA CÀ PHÊ'); L.push(`- ${rs.length} lô; chưa bán (tạm tính) ${rs.filter((r) => r.provisional).length}; giá vốn thực tế TB ${M(sum(rs, (r) => r.total) / Math.max(sum(rs, (r) => r.outKg), 1))} đ/kg; lãi các lô đã bán ${M(sum(rs.filter((r) => !r.provisional), (r) => r.profit))}; lô vượt tiêu chí chất lượng ${d.coffeeLots.filter((l) => l.moisture > st.coffeeMaxMoisture || l.impurity > st.coffeeMaxImpurity).length}.`); }
  if (ok('ops')) for (const [k, n] of [['catam', 'CÁ TẦM'], ['nhayen', 'NHÀ YẾN']]) { const o = opsStats(k); sec(n + ' (6 tháng)'); L.push(`- ${d.opsUnits.filter((u) => u.kind === k).length} đơn vị; sản lượng ${Math.round(o.kg)} kg; chi phí vận hành ${M(o.cost)}; chi phí/kg ${M(o.costPerKg)}; doanh thu ${M(o.revenue)}; lợi nhuận ${M(o.profit)}; đầu tư tài sản (tách riêng) ${M(o.capex)}.`); }
  if (ok('scenario')) { sec('KỊCH BẢN (giả định, không phải số thực)'); L.push(d.scenarios.map((s) => `- ${s.name}: ${JSON.stringify(s.vars)}`).join('\n') || '- chưa có'); }
  if (ok('approvals')) { const p = d.approvals.filter((a) => a.status === 'pending'); sec('PHÊ DUYỆT ĐANG CHỜ'); L.push(p.map((a) => `- ${a.id} ${a.title} (${M(a.amount)})${a.reasons?.length ? ' – ' + a.reasons.join('; ') : ''}`).join('\n') || '- không có'); }
  if (ok('ai') || ok('dashboard')) { sec('CẢNH BÁO HỆ THỐNG (có nguồn)'); L.push(buildAlerts().filter((a) => ok(a.page === 'ar' ? 'ar' : a.page === 'cashflow' ? 'cashflow' : a.page === 'ap' ? 'ap' : a.page === 'inventory' ? 'inventory' : a.page === 'budget' ? 'budget' : 'sales')).map((a) => `- [${a.sev}] ${a.title}. ${a.detail} (trang ${a.page})`).join('\n') || '- không có'); }
  sec('GHI CHÚ VỀ ĐỘ TIN CẬY'); L.push('- Tháng hiện tại chưa chốt. Giao dịch tiền chưa đối soát vẫn nằm trong số dư. Dự báo ≠ thực tế. Báo cáo quản trị không thay thế sổ sách pháp định.');
  return L.join('\n');
}
