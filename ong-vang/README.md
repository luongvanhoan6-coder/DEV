# Website Ong Vàng

Website tĩnh + form liên hệ ghi vào Google Sheet.

## Kết nối form với Google Sheet (3 bước, ~2 phút)
1. Tạo Google Sheet mới trên Drive → **Tiện ích mở rộng → Apps Script** → dán nội dung `google-apps-script.gs` → Lưu.
2. **Triển khai → Triển khai mới → Ứng dụng web**: Thực thi bằng *Tôi*, Quyền truy cập *Bất kỳ ai* → Triển khai → copy URL (`.../exec`).
3. Trên Vercel: **Project → Settings → Environment Variables** thêm `GOOGLE_SCRIPT_URL` = URL vừa copy → Redeploy.

## Deploy Vercel
`npx vercel --prod` trong thư mục này (hoặc import repo trên vercel.com, Root Directory = `ong-vang`).
