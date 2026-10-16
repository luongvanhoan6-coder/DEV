# Hướng dẫn đăng và lên lịch trên 3 nền tảng

Hệ thống **không tự đăng bài công khai**. Sau khi bạn duyệt video, lệnh `package` tạo gói nội dung đầy đủ để
bạn đăng hoặc lên lịch bằng **công cụ chính thức** của từng nền tảng. Trạng thái "đã đăng" chỉ được ghi khi bạn
xác nhận bằng đường dẫn bài đăng thật.

## Quy trình

```bash
python main.py approve --run-id <RUN_ID> --all-passed     # hoặc --video-id <ID> ...
python main.py package --run-id <RUN_ID> --date 2026-10-20
```

Kết quả trong `output/publishing_packages/<ngày>/`:

```
schedule.csv                     # lịch gợi ý (5 khung giờ/ngày, Asia/Ho_Chi_Minh)
facebook_reels/<video_id>/       # mp4, caption.txt, title.txt, description.txt, hashtags.txt,
tiktok/<video_id>/               # subtitles.srt, source.txt, checklist.md, metadata.json
youtube_shorts/<video_id>/
```

Sau khi đăng thật:

```bash
python main.py published --video-id <ID> --platform tiktok --url https://www.tiktok.com/@kenh/video/...
```

## Facebook Reels – Meta Business Suite (miễn phí)

1. https://business.facebook.com → chọn Trang → **Planner / Lập kế hoạch** → **Create reel / Tạo thước phim**.
2. Tải `*.mp4` trong `facebook_reels/<video_id>/`.
3. Dán nội dung `caption.txt`. Tải `subtitles.srt` ở mục phụ đề nếu có tùy chọn.
4. **Schedule / Lên lịch** theo giờ trong `schedule.csv`.

## TikTok – TikTok Studio (miễn phí)

1. https://www.tiktok.com/tiktokstudio/upload (đăng nhập trên máy tính).
2. Tải video, dán `caption.txt` (TikTok không có trường tiêu đề riêng).
3. Mục **Schedule / Lên lịch** (tối đa khoảng 10 ngày trước – kiểm tra giới hạn hiện tại trên TikTok Studio).
4. Bật nhãn **AI-generated content** nếu video dùng giọng đọc tổng hợp, theo quy định hiện hành của TikTok.

## YouTube Shorts – YouTube Studio (miễn phí)

1. https://studio.youtube.com → **Create → Upload videos**.
2. Video dọc ≤ 3 phút được tính là Shorts.
3. Dán `title.txt` vào Tiêu đề, `description.txt` vào Mô tả; mục **Subtitles** tải `subtitles.srt` (Tiếng Việt).
4. Chọn "Không dành cho trẻ em" (nếu đúng), mục **Altered or synthetic content** khai báo theo hướng dẫn của YouTube.
5. **Visibility → Schedule** theo giờ trong `schedule.csv`.

## Khung giờ

Khung giờ trong `config/settings.yaml → publishing.schedule_slots` chỉ là **gợi ý ban đầu**. Sau 2–4 tuần, nhập dữ
liệu Analytics thật (`python main.py analytics import <file.csv>`) và điều chỉnh theo báo cáo.

Định dạng tệp Analytics (CSV, xuất từ các nền tảng rồi chỉnh cột):

```
date,video_id,platform,views,watch_time_sec,avg_view_duration_sec,likes,comments,shares,follows_gained
```

## Đăng tự động qua API chính thức (tùy chọn, CHƯA kích hoạt)

`python main.py publishers` liệt kê yêu cầu cho YouTube Data API, Meta Graph API (Page Reels) và TikTok Content
Posting API. Mô-đun `src/platforms/` hiện chỉ là khung, **chưa cài đặt và chưa kiểm chứng**. Khi bạn chủ động tạo
ứng dụng nhà phát triển và cấp quyền:

1. Cài đặt `upload()` cho nền tảng tương ứng, mặc định chế độ **riêng tư/nháp**.
2. Chạy thử với 1 video riêng tư, kiểm tra bài đăng thật trên nền tảng.
3. Chỉ sau đó mới cân nhắc dùng cho lịch hằng ngày.

Không dùng công cụ tự động hóa trình duyệt để đăng bài – trái điều khoản dịch vụ của các nền tảng.
