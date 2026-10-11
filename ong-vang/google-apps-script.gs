// Dán vào Google Sheet: Tiện ích mở rộng > Apps Script. Xem README.md để triển khai.
function doPost(e) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(['Thời gian', 'Họ tên', 'Số điện thoại', 'Email', 'Nhu cầu', 'Nội dung']);
  var d = JSON.parse(e.postData.contents);
  sh.appendRow([new Date(), d.name, "'" + d.phone, d.email, d.interest, d.message]);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}
