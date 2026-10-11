# Ong Vàng – Phần mềm quản trị lợi nhuận & dòng tiền (bản DEMO)

Ứng dụng web thật (không phải mockup): mọi nút, form, bộ lọc, phê duyệt, phân quyền, nhật ký, import/export đều hoạt động,
xây theo **BRD "Đặc tả yêu cầu nghiệp vụ – Phần mềm quản trị lợi nhuận và dòng tiền Ong Vàng v1.0"** và 10 màn hình giao diện mẫu.

> ⚠️ **Phạm vi bản này (đọc kỹ):** đây là bản **Phase 1–4 chạy hoàn toàn trên trình duyệt** với **dữ liệu DEMO** (lưu trong `localStorage`).
> Không có máy chủ/cơ sở dữ liệu thật, nên **kiểm tra quyền chỉ chạy ở máy khách** – phù hợp để demo, UAT quy trình và chốt nghiệp vụ,
> **chưa đủ an toàn để nhập dữ liệu tài chính thật**. Lộ trình lên bản thật: xem mục "Chuyển sang backend thật".
> Các thông số nghiệp vụ (phương pháp giá vốn, thuế, tiêu thức phân bổ, ngưỡng, hạn mức, cấp duyệt) là **mặc định DEMO, chưa được xác nhận** – chỉnh ở *Hệ thống → Cấu hình*.

## Chạy thử
```bash
npm start            # hoặc: python3 -m http.server 8080
npm test             # 23 test: công thức tài chính, RBAC, phê duyệt, khóa kỳ, import, backup...
node tests/smoke.mjs http://localhost:8080/ ./shots   # duyệt mọi trang theo 7 vai trò bằng Chromium (cần playwright)
```
Tài khoản demo (mật khẩu `demo123`): `admin@ongvang.demo` (Giám đốc), `ketoan@`, `kinhdoanh@`, `thumua@`, `kho@`, `quanlymang@` (chỉ mảng Phân bón & BVTV), `xem@`.

## Trợ lý "TRỢ LÝ XINH ĐẸP" (chỉ chạy cục bộ, KHÔNG đưa lên Vercel)
Popup chat ở góc phải dưới, tổng hợp thông tin toàn bộ phần mềm theo quyền của người đăng nhập, dùng **gói Claude của bạn qua Claude Code CLI**.
```bash
npm i -g @anthropic-ai/claude-code   # nếu chưa cài
claude                               # đăng nhập 1 lần bằng gói Claude (Pro/Max)
npm run local                        # mở http://localhost:8788  (PORT=8790 npm run local để đổi cổng)
```
- Chỉ hiện khi chạy bằng `npm run local`; trên bản tĩnh/Vercel popup tự ẩn (`.vercelignore` cũng loại `local/` và `js/ui/agent.js`).
- Máy chủ chỉ nghe `127.0.0.1`, kiểm tra Host/Origin, chạy `claude -p` với **toàn bộ công cụ bị tắt** (chỉ trả lời văn bản), ở thư mục tạm, và **xóa `ANTHROPIC_API_KEY`** khỏi môi trường con để dùng gói đã đăng nhập.
- Mỗi câu hỏi gửi kèm bản tóm tắt dữ liệu theo quyền (không gồm mật khẩu) tới Claude. Trợ lý chỉ tư vấn; không tự chuyển tiền/duyệt chi.

## Tính năng đã có
Trang chủ (KPI, lọc kỳ/mảng/khách/sản phẩm/kho, drill-down) • Dòng tiền 13 tuần (3 kịch bản, giả định chỉnh được, số dư đầu, import sao kê, đối soát, so sánh dự báo–thực tế) •
Công nợ phải thu (tuổi nợ, hạn mức, cam kết, nhắc nợ, ghi thu, nhiệm vụ) • Công nợ phải trả (đề nghị thanh toán → duyệt → ghi nhận, gợi ý ưu tiên) •
Lợi nhuận theo mảng/sản phẩm/khách/khu vực (lãi gộp, LN đóng góp, LN sau phân bổ) • Bán hàng (báo giá, đơn, giao hàng → xuất kho + công nợ, ngoại lệ biên/hạn mức cần duyệt) •
Mua hàng (đề nghị → duyệt → nhập kho → công nợ) • Kho (tồn, lô/hạn dùng, nhập/xuất, kiểm kê có duyệt, bình quân/FIFO) • Ngân sách & chi phí (vượt ngân sách cần giải trình + duyệt) •
Thu mua cà phê theo lô (giá vốn thực tế, chất lượng, ứng trước, lãi/lỗ lô, tạm tính khi chưa bán) • Cá tầm & Nhà yến (chi phí/kg, sản lượng, tăng trưởng, tách đầu tư tài sản) •
Kịch bản vốn • Trợ lý AI (rule-based, có nguồn, nhật ký, phản hồi) • Phê duyệt (thẩm quyền theo số tiền, kiểm soát kép) • Báo cáo (CSV/PDF, drill-down) •
Hệ thống (người dùng, ma trận quyền, cấu hình, khóa kỳ, audit log, import CSV, sao lưu/khôi phục).

Đối chiếu từng FR/NFR/UAT và các giới hạn chưa làm: **[docs/doi-chieu-FR-NFR-UAT.md](docs/doi-chieu-FR-NFR-UAT.md)**.

## Cấu trúc
```
index.html, css/app.css
js/core/   calc.js (công thức thuần) · rbac.js · store.js (dịch vụ nghiệp vụ + audit) · queries.js (KPI/forecast/cảnh báo) · ai.js · seed.js (DEMO)
js/ui/     dom.js, table.js, charts.js (SVG), common.js
js/pages/  dashboard, cashflow, ar, ap, profit, sales, purchase, inventory, budget, coffee, ops, scenario, ai, approvals, reports, system
tests/     *.test.mjs (node:test) + smoke.mjs (Playwright)
docs/      schema.sql (PostgreSQL đề xuất), doi-chieu-FR-NFR-UAT.md, api-services.md
vercel.json  (header bảo mật + CSP)
```

## Deploy Vercel
Site tĩnh, không cần build. `npx vercel --prod` trong thư mục này, hoặc import repo trên vercel.com với *Root Directory* = `ong-vang-erp`, Framework = Other.
Không có biến môi trường/secrets ở frontend (`.env.example` để trống có chủ đích).

## Sao lưu / khôi phục
*Hệ thống → Sao lưu/Khôi phục*: tải JSON, khôi phục có kiểm tra phiên bản/cấu trúc, ghi audit. Quy trình kiểm thử khôi phục ghi trong chính trang đó (UAT-12).

## Chuyển sang backend thật (đề xuất)
1. Tạo DB theo `docs/schema.sql` (Postgres), migration bằng công cụ của framework.
2. Chuyển các hàm trong `js/core/store.js` thành API (cùng tên/tham số, xem `docs/api-services.md`), **kiểm tra RBAC/khóa kỳ/phê duyệt ở server**, dùng transaction.
3. Mật khẩu: dùng argon2/bcrypt + session/JWT ở server (bản DEMO băm SHA-256 ở trình duyệt chỉ để minh họa).
4. AI provider: gọi mô hình ở server, key lưu secrets; giữ nguyên quy tắc "không tự chuyển tiền/duyệt chi/đổi hạn mức/sửa kỳ khóa".
5. Tích hợp ERP/ngân hàng/n8n/Zalo qua adapter khi có API và quyền hợp lệ.
