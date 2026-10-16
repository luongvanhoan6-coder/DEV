# Bổ sung tài nguyên hình ảnh, nhạc nền, phông chữ – và giấy phép

Hệ thống **không tự tải** video, ảnh hay nhạc từ Internet. Bạn tự bổ sung tài nguyên có quyền sử dụng.

## Thư mục

| Thư mục | Nội dung | Gợi ý |
|---|---|---|
| `assets/backgrounds/` | Ảnh `.jpg/.png/.webp` hoặc video `.mp4/.mov` | Ảnh dọc ≥ 1080×1920 (tốt nhất ≥ 1620×2880 để zoom mượt). Ít nhất 15–20 tệp để tránh lặp. |
| `assets/music/` | `.mp3/.m4a/.wav` | Nhạc thiền, đàn tranh, sáo trúc, piano nhẹ; không lời. |
| `assets/fonts/` | `.ttf/.otf` hỗ trợ tiếng Việt | Ví dụ phông giấy phép SIL OFL: Noto Serif, Be Vietnam Pro, Lora, Playfair Display (kiểm tra bộ ký tự tiếng Việt). |
| `assets/logo/logo.png` | Logo nền trong suốt | Rộng ~260px. Không có logo → hiển thị tên kênh bằng chữ. |

## Đặt tên tệp để hệ thống chọn đúng cảnh

Hệ thống so khớp **từ khóa trong tên tệp** với cột `background_keywords` của câu nói và từ khóa ưu tiên của mẫu
video. Đặt tên tiếng Anh không dấu, ví dụ:

```
mountain_mist_01.jpg   lake_reflection_dawn.jpg   bamboo_forest_zen.mp4
lotus_pond_02.jpg      river_sunrise_village.jpg  cloud_sky_timelapse.mp4
```

## Nguồn miễn phí có giấy phép rõ ràng (tham khảo – luôn đọc điều khoản hiện hành)

- Ảnh/video: Pexels, Pixabay, Unsplash (ảnh) – giấy phép riêng của từng trang, thường cho phép dùng thương mại,
  không yêu cầu ghi công, nhưng có giới hạn (không bán lại nguyên bản, không dùng hình người để gợi ý xác nhận…).
- Nhạc: YouTube Audio Library (lọc "không cần ghi công"), Pixabay Music, nhạc bạn tự sáng tác/thu.
- Tự chụp/quay: luôn là lựa chọn an toàn nhất.

Lưu ý: nhạc "miễn phí" trên YouTube Audio Library có thể vẫn yêu cầu ghi công; một số bản nhạc trên các kho miễn phí
vẫn bị hệ thống Content ID nhận diện. Hãy ghi lại nguồn để xử lý khiếu nại nếu có.

## Ghi giấy phép – `assets/LICENSES.csv`

Mỗi tệp tài nguyên thật nên có một dòng (hệ thống cảnh báo nếu thiếu):

```
file,source_url,license,author,downloaded_at,notes
mountain_mist_01.jpg,https://www.pexels.com/photo/...,Pexels License,Tên tác giả,2026-10-16,
```

## Tài nguyên placeholder

`python main.py init --demo-assets` tạo 6 hình nền cách điệu và 1 đoạn nhạc ambient **tự sinh bằng mã** (tên bắt
đầu bằng `placeholder_`). Chúng chỉ để chạy thử; báo cáo chất lượng luôn cảnh báo khi video dùng placeholder.
Xóa chúng khi đã có tài nguyên thật.
