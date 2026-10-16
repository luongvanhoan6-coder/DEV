# Mẫu phụ đề

Phụ đề được sinh tự động ở hai dạng cho mỗi video:

- `subtitles.srt` – chuẩn SRT (UTF-8), dùng để tải lên YouTube/Facebook và lưu trong gói đăng bài.
- `subtitles.ass` – có định dạng (phông, cỡ chữ, màu, viền, lề dưới), được FFmpeg/libass in lên video.

Kiểu chữ phụ đề của từng mẫu video nằm trong `config/video_template.yaml` → `templates.<tên>.subtitle`
(`font_size`, `color`, `outline_color`, `outline`, `margin_bottom`). Cách ngắt dòng nằm trong
`config/settings.yaml` → `subtitles` (`max_chars_per_line`, `max_lines_per_cue`).

`margin_bottom` mặc định 520–580px để phụ đề không bị che bởi thanh chú thích/nút bấm của TikTok, Reels, Shorts.
