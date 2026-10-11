# Bảng đối chiếu FR / NFR / UAT với trạng thái hoàn thành

Chú thích: ✅ Hoàn thành (trong phạm vi bản DEMO chạy trên trình duyệt) · 🟡 Một phần (nêu rõ phần thiếu) · ❌ Chưa làm.
**Giới hạn lớn nhất:** chưa có backend/DB thật; kiểm tra quyền ở máy khách (xem README). Dữ liệu là DEMO. Thông số nghiệp vụ là mặc định DEMO chưa xác nhận (BRD §12).

## Chức năng (FR)
| ID | Ưu tiên | TT | Ghi chú |
|---|---|---|---|
| FR-DASH-01 | P0 | ✅ | Tiền, công nợ, tồn kho, doanh thu, lãi gộp, lợi nhuận (thu/chi dự kiến ở Dòng tiền) |
| FR-DASH-02 | P0 | ✅ | Lọc kỳ/mảng/khách/sản phẩm/kho; KPI bấm vào trang nguồn; Báo cáo có drill-down tới đơn hàng |
| FR-DASH-03 | P0 | ✅ | Cảnh báo thiếu tiền, quá hạn, tồn bất thường, biên thấp, vượt ngân sách (`buildAlerts`) |
| FR-DASH-04 | P1 | ✅ | Hiển thị thời điểm cập nhật + số giao dịch chưa đối soát |
| FR-CF-01 | P0 | ✅ | Nhập/điều chỉnh số dư đầu (có lý do, log); import sao kê CSV |
| FR-CF-02 | P0 | ✅ | Lịch thu theo hạn/cam kết; khoản quá hạn chưa cam kết bị loại khỏi dự báo và nêu rõ |
| FR-CF-03 | P0 | 🟡 | Phải trả, chi phí định kỳ (lương, thuê, thuế phí, lãi vay). Chưa có lịch gốc khoản vay riêng |
| FR-CF-04 | P0 | ✅ | 13 tuần cuốn chiếu; test `BR-03` |
| FR-CF-05 | P1 | ✅ | Cơ sở/Tốt/Xấu, sửa giả định (tỷ lệ thu, độ trễ, hệ số chi phí) |
| FR-CF-06 | P0 | ✅ | Ngưỡng cấu hình; nêu tuần và khoản chi lớn tác động |
| FR-CF-07 | P1 | ✅ | "Lưu bản dự báo" rồi so sánh thu/chi dự báo–thực tế theo tuần đã kết thúc |
| FR-AR-01 | P0 | ✅ | Theo khách hàng/hóa đơn: phát sinh, đã thu, còn lại |
| FR-AR-02 | P0 | ✅ | Dải tuổi nợ cấu hình ở Hệ thống (mặc định 1–7, 8–30, 31–60, >60) |
| FR-AR-03 | P0 | ✅ | Cảnh báo vượt hạn mức; đơn vượt hạn mức phải giải trình + duyệt |
| FR-AR-04 | P0 | ✅ | Cam kết, người liên hệ, ngày hứa, lịch sử nhắc/kết quả |
| FR-AR-05 | P1 | 🟡 | Nhiệm vụ nhắc thu nợ có; quản lý tranh chấp/đối chiếu chưa có |
| FR-AR-06 | P1 | ✅ | Cảnh báo theo tuổi nợ; không tự kết luận nợ xấu |
| FR-AP-01 | P0 | ✅ | |
| FR-AP-02 | P0 | ✅ | Lịch theo ngày; trạng thái đề nghị; người duyệt ở Phê duyệt |
| FR-AP-03 | P1 | 🟡 | Đối chiếu đơn mua ↔ hóa đơn phải trả (so số tiền). Chưa đối chiếu 3 bên với phiếu nhập/đề nghị thanh toán |
| FR-AP-04 | P1 | 🟡 | Gợi ý theo hạn + số dư tiền; chưa xét chiết khấu/mức quan trọng (chưa có dữ liệu) |
| FR-AP-05 | P0 | ✅ | Không ghi nhận thanh toán nếu chưa duyệt; hệ thống không chuyển tiền; test UAT-07 |
| FR-PROF-01 | P0 | 🟡 | 8 mảng theo BRD có trong dữ liệu; chưa có màn hình thêm/sửa mảng |
| FR-PROF-02 | P0 | ✅ | Doanh thu thuần = bán − chiết khấu − hàng trả lại; thuế GTGT cấu hình (mặc định 0, chưa xác nhận) |
| FR-PROF-03 | P0 | ✅ | Bình quân gia quyền hoặc FIFO – chọn ở cấu hình, không mặc định ngầm |
| FR-PROF-04 | P0 | ✅ | |
| FR-PROF-05 | P0 | ✅ | CP trực tiếp gắn vào đơn hàng và mảng |
| FR-PROF-06 | P1 | 🟡 | Tiêu thức phân bổ cấu hình có log; chưa có thời gian hiệu lực/người duyệt riêng |
| FR-PROF-07 | P0 | ✅ | Mảng, sản phẩm, khách hàng, khu vực, kỳ (đơn hàng ở drill-down) |
| FR-PROF-08 | P0 | ✅ | Lãi gộp / LN đóng góp / LN sau phân bổ tách riêng, không cộng trùng (test) |
| FR-PROF-09 | P1 | 🟡 | So kỳ trước; chưa so kế hoạch và giải thích chênh lệch |
| FR-INV-01 | P0 | 🟡 | SKU, ĐVT, kho, lô, hạn dùng, trạng thái; chưa có màn hình thêm/sửa sản phẩm |
| FR-INV-02 | P0 | 🟡 | Nhập, xuất, kiểm kê, điều chỉnh có lý do. Chuyển kho & trả hàng: logic tính tồn có, chưa có form |
| FR-INV-03 | P0 | ✅ | Test bình quân/FIFO |
| FR-INV-04 | P1 | ✅ | |
| FR-INV-05 | P1 | 🟡 | Gần hết hạn/quá hạn; hao hụt/hư hỏng ghi qua phiếu xuất. Chưa có báo cáo hao hụt riêng |
| FR-INV-06 | P0 | ✅ | |
| FR-INV-07 | P0 | 🟡 | Theo nhóm hàng và kho; chưa theo mảng |
| FR-ORD-01 | P1 | 🟡 | Báo giá, đơn bán/mua, trạng thái; lịch sử qua audit. Chưa sửa đơn sau khi tạo |
| FR-ORD-02 | P0 | ✅ | |
| FR-ORD-03 | P0 | ✅ | |
| FR-ORD-04 | P1 | 🟡 | Đã giao/chưa thu tiền có; giao một phần & chưa xuất hóa đơn chưa có |
| FR-ORD-05 | P1 | ✅ | Giá vốn dự kiến vs thực tế khi giao |
| FR-BUD-01…05 | P0/P1 | ✅ | Ngân sách tháng×mảng×nhóm; chi phí định kỳ vào dự báo |
| FR-COF-01,02,05,06 | P1 | ✅ | Giá vốn thực tế khớp màn hình (43.240 đ/kg; test) |
| FR-COF-03 | P1 | 🟡 | Khối lượng nhập/thành phẩm, hao hụt; chưa có điều chỉnh sau khi lưu |
| FR-COF-04 | P1 | 🟡 | Chi phí nhập khi tạo lô; chưa thêm chi phí sau |
| FR-OPS-01…04 | P1 | ✅ | Chi phí/kg; tách capex |
| FR-OPS-05 | P2 | ❌ | Định mức kỹ thuật cần người có chuyên môn duyệt – chưa cấu hình |
| FR-SCN-01,02,04 | P1 | ✅ | |
| FR-SCN-03 | P2 | 🟡 | Điểm hòa vốn tham khảo (chưa tách CP cố định/biến đổi chính thức) |
| FR-AI-01…04,06 | P1 | 🟡 | Có đủ nhưng là **rule-based**, chưa gọi LLM (cần AI provider ở server) |
| FR-AI-05 | P0 | ✅ | Không có hàm tài chính nào gắn với AI (test) |
| FR-SEC-01 | P0 | 🟡 | RBAC theo vai trò + phạm vi mảng, **chỉ ở máy khách**; chưa phạm vi kho/chi nhánh |
| FR-SEC-02 | P0 | ✅ | Thẩm quyền theo số tiền, loại giao dịch, vai trò |
| FR-SEC-03 | P0 | ✅ | |
| FR-SEC-04 | P1 | ✅ | |
| FR-SEC-05 | P0 | 🟡 | Sao lưu/khôi phục JSON có kiểm thử; chưa lịch sao lưu tự động (cần server) |
| FR-SEC-06 | P0 | 🟡 | HTTPS + header/CSP khi lên Vercel; chưa có secrets/server |
| FR-REP-01,02,05 | P0/P1 | ✅ | |
| FR-REP-03 | P1 | 🟡 | CSV (mở bằng Excel) và PDF qua in; chưa xuất .xlsx gốc |
| FR-REP-04 | P2 | ❌ | Cần dịch vụ nền |
| FR-MOB-01 | P0 | ✅ | Responsive; đã kiểm tra ảnh chụp mobile |
| FR-MOB-02 | P1 | 🟡 | Chuông + huy hiệu trong app; chưa push/Zalo/email |
| FR-MOB-03 | P1 | ✅ | Duyệt/từ chối trên điện thoại, từ chối bắt buộc lý do |
| FR-MOB-04 | P1 | ❌ | Đính kèm chứng từ chưa làm (cần lưu trữ file ở server) |
| FR-MOB-05 | P2 | 🟡 | Nhiệm vụ có người phụ trách/hạn/trạng thái |

## Phi chức năng (NFR)
| ID | TT | Ghi chú |
|---|---|---|
| NFR-01 Bảo mật | 🟡 | Có HTTPS/CSP/header; băm mật khẩu SHA-256+salt **ở trình duyệt** (chỉ để demo); kiểm tra quyền ở server: chưa có |
| NFR-02 Toàn vẹn | 🟡 | Validation số tiền/số lượng, ràng buộc tồn/số còn lại; chưa có khóa ngoại/transaction DB (schema.sql đã thiết kế) |
| NFR-03 Audit | ✅ | Người dùng/thời gian/trước-sau/lý do |
| NFR-04 Hiệu năng | ✅ | Trang tải < 1 giây với ~1 MB dữ liệu DEMO (đo trên trình duyệt headless); chưa đo tải nhiều người dùng |
| NFR-05 Chống lỗi | ✅ | Thông báo tiếng Việt, trạng thái loading/empty/error, chống bấm lặp (chỉ ghi nhận khi thành công) |
| NFR-06 Backup | 🟡 | Thủ công JSON + quy trình kiểm thử khôi phục; chưa tự động |
| NFR-07 Mở rộng | 🟡 | Module hóa, công thức thuần có test, cấu hình tách khỏi code; chưa có API/migration thật |
| NFR-08 Riêng tư | ✅ | Log che mật khẩu; AI log không lưu dữ liệu nhạy cảm; export theo quyền |
| NFR-09 Minh bạch | ✅ | Công thức/kỳ/nguồn hiển thị; đánh dấu chưa đối soát/tạm tính/DEMO/chưa xác nhận |

## Nghiệm thu (UAT)
| ID | TT | Bằng chứng |
|---|---|---|
| UAT-01 RBAC | 🟡 | `tests/store.test.mjs` (RBAC) – hàm ghi bị từ chối trái quyền. "API trái quyền" cần kiểm lại khi có server |
| UAT-02 Dashboard | ✅ | KPI khớp nguồn (test) |
| UAT-03 Dòng tiền | ✅ | test `BR-03`, `UAT-03` |
| UAT-04 Công nợ | ✅ | test |
| UAT-05 Lợi nhuận | ✅ | test không cộng trùng; tạm tính/chưa đối soát được đánh dấu |
| UAT-06 Tồn kho | 🟡 | Nhập/xuất/kiểm kê/điều chỉnh/bình quân/FIFO có test; chuyển kho chưa có UI |
| UAT-07 Phê duyệt | ✅ | Đơn dưới ngưỡng, thanh toán, kiểm kê, chi phí vượt ngân sách không hoàn tất nếu thiếu duyệt |
| UAT-08 Audit | ✅ | test |
| UAT-09 Import/export | ✅ | Import báo lỗi/trùng (test); export CSV theo quyền |
| UAT-10 Responsive | ✅ | Smoke test + ảnh chụp mobile |
| UAT-11 AI | ✅ | Nêu nguồn/giả định; không hành động tài chính |
| UAT-12 Backup | 🟡 | Khôi phục có test; quy trình kiểm thử trong trang Sao lưu; chưa tự động |

## Quyết định còn mở (BRD §12) – cần chủ doanh nghiệp xác nhận trong *Hệ thống → Cấu hình*
Phương pháp giá vốn • xử lý chiết khấu/hàng trả lại/thuế • tiêu thức phân bổ • ngưỡng tiền/biên/ngân sách • hạn mức công nợ • cấp phê duyệt • tiêu chí chất lượng cà phê • danh sách mảng/người dùng/phạm vi • nền tảng deploy/backup/bảo mật.
