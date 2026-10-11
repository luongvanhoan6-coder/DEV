import { h, card, kpi, tabs, statusBadge, toast, formModal, openModal, download } from '../ui/dom.js';
import { barChart, donut } from '../ui/charts.js';
import { dataTable } from '../ui/table.js';
import { state, saveOpening, saveForecastScenario, snapshotForecast, importCashTx, csvParse, csvStringify, reconcile } from '../core/store.js';
import { forecast, accountBalance, cashBalance, unreconciled, T } from '../core/queries.js';
import { fmtDate } from '../core/dates.js';
import { fmt, fmtShort, sum } from '../core/format.js';
import { ph, allow, select, money } from '../ui/common.js';
const ST = { tab: 'forecast', sc: 'base' };
export async function render(params, nav) {
  if (params.tab) ST.tab = params.tab;
  const st = state.db.settings, fc = forecast(ST.sc), canEdit = allow('cashflow', 'edit');
  const body = h('div');
  const go = (t) => { ST.tab = t; nav.refresh(); };
  const head = ph('Dòng tiền', `Dự báo cuốn chiếu 13 tuần từ ${fmtDate(fc.weeks[0].start)} • Số dư đầu kỳ chưa đối soát được đánh dấu • Công thức: số dư cuối tuần = số dư đầu + tổng thu − tổng chi`, [
    select('sc', Object.entries(st.forecastScenarios).map(([k, v]) => [k, 'Kịch bản: ' + v.name]), ST.sc, (v) => { ST.sc = v; nav.refresh(); }, 'Kịch bản'),
    canEdit ? h('button', { class: 'btn ghost sm', onclick: () => editScenario(nav) }, 'Sửa giả định') : null,
    canEdit ? h('button', { class: 'btn ghost sm', onclick: () => { try { snapshotForecast(fc, ST.sc); toast('Đã lưu bản dự báo để đối chiếu sau'); nav.refresh(); } catch (e) { toast(e.message, 'err'); } } }, 'Lưu bản dự báo') : null]);
  const kp = h('div', { class: 'grid g4' }, kpi('Số dư hiện tại', fmt(fc.opening) + ' đ', 'blue', unreconciled().length + ' GD chưa đối soát'), kpi('Tổng thu dự kiến (13 tuần)', fmt(fc.totalIn) + ' đ', 'green', 'Theo cam kết/hạn thanh toán'), kpi('Tổng chi dự kiến (13 tuần)', fmt(fc.totalOut) + ' đ', 'red', 'Phải trả + chi phí định kỳ'), kpi('Số dư cuối tuần 13', fmt(fc.closing) + ' đ', fc.closing < st.minCash ? 'amber' : 'green', 'Ngưỡng tối thiểu ' + fmtShort(st.minCash)));
  const TABS = [['overview', 'Tổng quan'], ['forecast', 'Dự báo 13 tuần'], ['in', 'Thu tiền'], ['out', 'Chi tiền'], ['txs', 'Giao dịch & đối soát'], ['compare', 'So sánh thực tế']];
  if (ST.tab === 'overview') body.append(overview(fc)); else if (ST.tab === 'forecast') body.append(forecastTab(fc)); else if (ST.tab === 'in') body.append(listTab(fc, 'in')); else if (ST.tab === 'out') body.append(listTab(fc, 'out')); else if (ST.tab === 'txs') body.append(txTab(nav, canEdit)); else body.append(compareTab());
  return h('div', null, head, tabs(TABS, ST.tab, go), kp, h('div', { style: { marginTop: '14px' } }, body));
}
function overview(fc) {
  return h('div', { class: 'grid g2' }, card('Số dư theo tài khoản', h('div', null, state.db.cashAccounts.map((a) => h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)' } }, h('span', null, a.name), h('b', null, fmt(accountBalance(a.id)) + ' đ'))), h('p', { class: 'note', style: { marginTop: '8px' } }, 'Số dư = số dư đầu + thu − chi đã ghi nhận. Giao dịch chưa đối soát vẫn được tính nhưng đánh dấu ở tab "Giao dịch & đối soát".')), canEdit() ? h('button', { class: 'btn ghost sm', onclick: () => openingForm() }, 'Nhập số dư đầu') : null),
    card('Cảnh báo theo tuần', h('div', { class: 'alerts' }, fc.weeks.filter((w) => w.status === 'risk' || w.status === 'alert' || w.status === 'watch').slice(0, 6).map((w) => h('div', { class: 'al' }, statusBadge(w.status), h('div', null, h('b', null, `Tuần ${w.idx + 1} (${fmtDate(w.start)})`), h('p', null, `Số dư cuối ${fmt(w.closing)} đ. Khoản chi lớn: ${[...w.outItems].sort((a, b) => b.amount - a.amount).slice(0, 2).map((x) => x.label + ' ' + fmtShort(x.amount)).join('; ') || '–'}`)))).concat(fc.weeks.every((w) => w.status === 'safe') ? [h('div', { class: 'state empty' }, 'Không có tuần dưới ngưỡng')] : []))));
}
const canEdit = () => allow('cashflow', 'edit');
function forecastTab(fc) {
  const labels = fc.weeks.map((w, i) => 'T' + (i + 1));
  const chart = card('Dự báo dòng tiền 13 tuần', barChart({ labels, bars: [{ name: 'Dòng tiền vào', color: '#0f7a3f', data: fc.weeks.map((w) => w.in) }, { name: 'Dòng tiền ra', color: '#e0572b', data: fc.weeks.map((w) => w.out) }], line: { name: 'Số dư dự kiến', color: '#1d6fa5', data: fc.weeks.map((w) => w.closing) }, unit: 'tỷ', ariaLabel: 'Dự báo dòng tiền 13 tuần' }));
  const tbl = dataTable({ cols: [{ key: 'w', label: 'Tuần', render: (w) => `Tuần ${w.idx + 1} (${fmtDate(w.start)})`, sortVal: (w) => w.idx }, { key: 'in', label: 'Thu dự kiến', align: 'num', render: (w) => fmt(w.in), sortVal: (w) => w.in }, { key: 'out', label: 'Chi dự kiến', align: 'num', render: (w) => fmt(w.out), sortVal: (w) => w.out }, { key: 'closing', label: 'Số dư cuối tuần', align: 'num', render: (w) => h('span', { class: w.closing < 0 ? 'red-t' : '' }, fmt(w.closing)), sortVal: (w) => w.closing }, { key: 'st', label: 'Trạng thái', render: (w) => statusBadge(w.status), sortVal: (w) => w.status }], rows: fc.weeks, pageSize: 13, onRow: (w) => weekModal(w), rowClass: (w) => (w.status === 'risk' || w.status === 'alert' ? 'rowred' : w.status === 'watch' ? 'rowamber' : ''), exportName: 'du-bao-13-tuan', canExport: allow('cashflow', 'export') });
  const un = fc.unforecast.length ? card('Khoản phải thu quá hạn CHƯA có cam kết (không đưa vào dự báo – không tự đoán ngày thu)', h('p', null, `${fc.unforecast.length} khoản, tổng ${fmt(sum(fc.unforecast, (x) => x.amount))} đ. Ghi cam kết thanh toán ở mục Công nợ phải thu để đưa vào dự báo.`), null) : null;
  return h('div', { class: 'grid' }, chart, card('Bảng chi tiết dự báo (bấm một tuần để xem khoản thu/chi)', tbl), un);
}
function weekModal(w) {
  const rows = (items, col) => h('table', { class: 'tbl' }, h('tbody', null, items.length ? [...items].sort((a, b) => b.amount - a.amount).map((x) => h('tr', null, h('td', null, x.label, x.committed ? h('span', { class: 'src' }, 'có cam kết') : null, x.recurring ? h('span', { class: 'src' }, 'định kỳ') : null), h('td', { class: 'num' }, fmt(x.amount)))) : h('tr', null, h('td', null, 'Không có'))));
  openModal({ title: `Tuần ${w.idx + 1}: ${fmtDate(w.start)} – ${fmtDate(w.end)}`, wide: true, body: h('div', { class: 'grid g2' }, h('div', null, h('h4', null, 'Thu (' + fmt(w.in) + ')'), rows(w.inItems)), h('div', null, h('h4', null, 'Chi (' + fmt(w.out) + ')'), rows(w.outItems))) });
}
function listTab(fc, dir) {
  const rows = fc.weeks.flatMap((w) => (dir === 'in' ? w.inItems : w.outItems).map((x) => ({ ...x, week: w.idx + 1 })));
  return card(dir === 'in' ? 'Lịch thu dự kiến' : 'Lịch chi dự kiến', dataTable({ cols: [{ key: 'date', label: 'Ngày', render: (x) => fmtDate(x.date), sortVal: (x) => x.date }, { key: 'label', label: 'Nội dung' }, { key: 'week', label: 'Tuần', align: 'num' }, { key: 'amount', label: 'Số tiền', align: 'num', render: (x) => fmt(x.amount), sortVal: (x) => x.amount }, { key: 'src', label: 'Nguồn', render: (x) => (x.committed ? 'Cam kết' : x.recurring ? 'Chi phí định kỳ' : dir === 'in' ? 'Hạn thanh toán' : 'Hạn phải trả'), noExport: false }], rows, pageSize: 10, searchText: (x) => x.label, exportName: dir === 'in' ? 'lich-thu' : 'lich-chi', canExport: allow('cashflow', 'export') }));
}
function txTab(nav, canEdit) {
  const rows = [...state.db.cashTx].sort((a, b) => b.date.localeCompare(a.date));
  let table;
  const toolbar = h('span', { class: 'row' }, canEdit ? h('button', { class: 'btn ghost sm', onclick: () => importForm(nav) }, '⬆ Import sao kê CSV') : null, canEdit ? h('button', { class: 'btn sm', onclick: () => { const ids = table._rows.filter((t) => !t.reconciledAt).map((t) => t.id); if (!ids.length) return toast('Không có giao dịch chưa đối soát trong bộ lọc'); if (!confirm(`Đánh dấu đã đối soát ${ids.length} giao dịch đang lọc?`)) return; try { reconcile(ids); toast('Đã đối soát'); nav.refresh(); } catch (e) { toast(e.message, 'err'); } } }, '✓ Đối soát các GD đang lọc') : null);
  table = dataTable({ cols: [{ key: 'date', label: 'Ngày', render: (t) => fmtDate(t.date), sortVal: (t) => t.date }, { key: 'cat', label: 'Nội dung', render: (t) => t.category, sortVal: (t) => t.category }, { key: 'acc', label: 'Tài khoản', render: (t) => state.db.cashAccounts.find((a) => a.id === t.accountId)?.name, sortVal: (t) => t.accountId }, { key: 'amount', label: 'Số tiền', align: 'num', render: (t) => h('span', { class: t.direction === 'in' ? 'green-t' : 'red-t' }, (t.direction === 'in' ? '+' : '−') + fmt(t.amount)), sortVal: (t) => (t.direction === 'in' ? t.amount : -t.amount) }, { key: 'rec', label: 'Đối soát', render: (t) => (t.reconciledAt ? statusBadge('done') && h('span', { class: 'badge green' }, 'Đã đối soát') : h('span', { class: 'badge amber' }, 'Chưa đối soát')), sortVal: (t) => (t.reconciledAt ? 1 : 0), csv: (t) => (t.reconciledAt ? 'Đã đối soát' : 'Chưa đối soát') }], rows, pageSize: 10, searchText: (t) => t.category + ' ' + (t.ref || ''), filters: [{ key: 'dir', label: 'Thu/Chi', options: [['in', 'Thu'], ['out', 'Chi']], test: (t, v) => t.direction === v }, { key: 'rec', label: 'Đối soát', options: [['n', 'Chưa đối soát'], ['y', 'Đã đối soát']], test: (t, v) => (v === 'y' ? !!t.reconciledAt : !t.reconciledAt) }], toolbar, exportName: 'giao-dich-tien', canExport: allow('cashflow', 'export') });
  return card('Giao dịch tiền', table);
}
function compareTab() {
  const snaps = state.db.forecastSnapshots || [];
  if (!snaps.length) return card('So sánh dự báo cũ với thực tế', h('div', { class: 'state empty' }, 'Chưa có bản dự báo nào được lưu. Bấm "Lưu bản dự báo" để lưu, sau vài tuần quay lại so sánh.'));
  const t = T();
  return h('div', { class: 'grid' }, snaps.slice(0, 3).map((s) => card(`Bản dự báo ngày ${fmtDate(s.date)} (kịch bản ${s.scenario})`, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Tuần', 'Thu dự báo', 'Thu thực tế', 'Chi dự báo', 'Chi thực tế', 'Sai lệch ròng'].map((x) => h('th', null, x)))), h('tbody', null, s.weeks.filter((w) => w.end < t).map((w, i) => { const act = (dir) => sum(state.db.cashTx.filter((x) => x.direction === dir && x.date >= w.start && x.date <= w.end), (x) => x.amount); const ai = act('in'), ao = act('out'); return h('tr', null, h('td', null, fmtDate(w.start)), h('td', { class: 'num' }, fmt(w.in)), h('td', { class: 'num' }, fmt(ai)), h('td', { class: 'num' }, fmt(w.out)), h('td', { class: 'num' }, fmt(ao)), h('td', { class: 'num' }, fmt(ai - ao - (w.in - w.out)))); }), s.weeks.every((w) => w.end >= t) ? h('tr', null, h('td', { colSpan: 6 }, 'Chưa có tuần nào kết thúc để so sánh')) : null)))));
}
function openingForm() {
  formModal({ title: 'Nhập/điều chỉnh số dư đầu tài khoản', fields: [{ name: 'acc', label: 'Tài khoản', type: 'select', options: state.db.cashAccounts.map((a) => [a.id, a.name + ' – số dư đầu hiện tại ' + fmt(a.opening)]), full: true }, { name: 'amt', label: 'Số dư đầu mới (đ)', type: 'number', required: true }, { name: 'reason', label: 'Lý do', required: true }], submitLabel: 'Lưu', onSubmit: (v) => { saveOpening(v.acc, v.amt, v.reason); toast('Đã cập nhật số dư đầu'); window.__refresh(); } });
}
function editScenario(nav) {
  const st = state.db.settings.forecastScenarios;
  formModal({ title: 'Giả định kịch bản dự báo', fields: [{ name: 'k', label: 'Kịch bản', type: 'select', options: Object.entries(st).map(([k, v]) => [k, v.name]) }, { name: 'collectionPct', label: 'Tỷ lệ thu được (1 = 100%)', type: 'number', value: 1 }, { name: 'delayDays', label: 'Thu trễ (+) / sớm (−) bao nhiêu ngày', type: 'number', value: 0 }, { name: 'costPct', label: 'Hệ số chi phí định kỳ (1 = giữ nguyên)', type: 'number', value: 1 }], note: 'Giả định do bạn đặt, không phải số thực tế. Mọi thay đổi được ghi log.', onSubmit: (v) => { saveForecastScenario(v.k, v); toast('Đã lưu giả định'); nav.refresh(); } });
}
function importForm(nav) {
  const file = h('input', { type: 'file', accept: '.csv,text/csv' }), out = h('div'); let parsed = null;
  const m = openModal({ title: 'Import sao kê ngân hàng (CSV)', wide: true, body: h('div', null, h('p', { class: 'note' }, 'Cột bắt buộc: ngay (YYYY-MM-DD), thu_chi (thu/chi), so_tien, tai_khoan (TK1/TK2/TK3), noi_dung, tham_chieu. Hệ thống kiểm tra từng dòng và chặn giao dịch trùng.'), h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => download('mau-sao-ke.csv', csvStringify([['ngay', 'thu_chi', 'so_tien', 'tai_khoan', 'noi_dung', 'tham_chieu'], [T(), 'thu', '10000000', 'TK2', 'Khách chuyển khoản', 'FT123']])) }, '⬇ Tải file mẫu'), file), out) });
  file.onchange = async () => { const rows = csvParse(await file.files[0].text()); parsed = importCashTx(rows); out.replaceChildren(h('p', null, `Hợp lệ ${parsed.good.length} dòng • Lỗi ${parsed.errs.length} dòng`), parsed.errs.length ? h('ul', null, parsed.errs.slice(0, 20).map((e) => h('li', { class: 'red-t' }, `Dòng ${e.line}: ${e.msg}`))) : null, parsed.good.length ? h('button', { class: 'btn', onclick: () => { parsed.commit(); m.close(); toast(`Đã import ${parsed.good.length} giao dịch`); nav.refresh(); } }, `Nhập ${parsed.good.length} giao dịch hợp lệ`) : null); };
}
