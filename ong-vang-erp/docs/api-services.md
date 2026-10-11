# Dịch vụ nghiệp vụ (`js/core/store.js`) – hợp đồng API cho backend thật

Mỗi hàm: kiểm tra quyền (`assertCan`), khóa kỳ (`assertOpen`), validation, chống bấm lặp (`dedupe`), ghi audit (`log`). Lỗi ném `Error`/`PermissionError` với thông báo tiếng Việt.

| Nhóm | Hàm | Quyền | Ghi chú nghiệp vụ |
|---|---|---|---|
| Phiên | `login`, `logout` | – | Ghi `login`/`login_failed` |
| Bán hàng | `saveOrder`, `convertQuote`, `deliverOrder` | sales:edit | Biên < ngưỡng hoặc vượt hạn mức ⇒ bắt buộc giải trình, tạo phê duyệt; giao hàng cần đủ tồn, tạo xuất kho + HĐ phải thu |
| Công nợ | `recordPayment`, `addCommitment`, `addReminder`, `createPaymentRequest`, `addTask` | ar/ap:edit | Phải trả chỉ ghi nhận khi đề nghị đã duyệt; không vượt số còn lại |
| Mua/Kho | `savePO`, `receivePO`, `saveReceipt`, `saveIssue`, `submitStocktake` | purchase/inventory:edit | Hàng có hạn dùng bắt buộc lô+hạn; kiểm kê ⇒ chờ duyệt mới điều chỉnh |
| Ngân sách | `saveExpense`, `saveBudget` | budget:edit | Vượt ngưỡng ngân sách ⇒ giải trình + duyệt, chưa ghi tiền |
| Cà phê | `saveCoffeeLot`, `sellCoffeeLot` | coffee:edit | Tạo công nợ NCC (trừ ứng trước); lô chưa bán là tạm tính |
| Cá tầm/yến | `saveOpsRecord`, `saveOpsUnit` | ops:edit | `cls=capex` tách khỏi chi phí/kg |
| Dòng tiền | `saveOpening`, `saveForecastScenario`, `snapshotForecast`, `importCashTx`, `reconcile` | cashflow:edit | Import chặn trùng, báo lỗi từng dòng |
| Phê duyệt | `decide(id,'approve'|'reject',note)` | approvals:approve | Thẩm quyền theo số tiền; kiểm soát kép; từ chối cần lý do |
| Hệ thống | `saveSettings`, `lockPeriod`, `saveUser`, `resetPassword`, `exportBackup`, `restoreBackup`, `importCustomers`, `importInvoices` | system | Cần lý do; admin-only cho khóa kỳ/sao lưu |
| AI | `logAiRun`, `aiFeedback` | – | AI chỉ đọc + đề xuất; không có hàm nào chuyển tiền/duyệt chi/đổi hạn mức/sửa kỳ khóa |

Truy vấn tổng hợp (read-only) ở `js/core/queries.js`: `periodStats`, `profitBySegment`, `forecast`, `arByCustomer`, `inventoryView`, `budgetRows`, `buildAlerts`, `workingCapital`.
Công thức thuần ở `js/core/calc.js` (BR-01…BR-09), có test tại `tests/calc.test.mjs`.
