# TRÍ TUỆ CỔ NHÂN – TƯ DUY AN LẠC

Hệ thống sản xuất video ngắn tự động (9:16, 1080×1920) từ kho câu nói triết học phương Đông, Phật giáo, Đạo giáo,
Nho giáo và danh nhân – mục tiêu **5 video/ngày (~150 video/tháng)** cho Facebook Reels, TikTok và YouTube Shorts.

- Chạy trên máy của bạn bằng Python + FFmpeg, **miễn phí** ở cấu hình mặc định.
- Không cần biết lập trình: chỉ dùng vài lệnh có sẵn.
- Trung thực về nguồn: câu chưa xác minh bị chặn khỏi sản xuất; không tự gán lời cho Đức Phật, Khổng Tử, Lão Tử…
- Không tự đăng bài công khai: hệ thống tạo **gói nội dung** để bạn đăng/lên lịch bằng công cụ chính thức.

---

## 1. Cài đặt (một lần)

### Bước 1 – Cài Python 3.10+ và FFmpeg

| Hệ điều hành | Python | FFmpeg |
|---|---|---|
| Windows | https://www.python.org/downloads/ (tick **Add Python to PATH**) | `winget install Gyan.FFmpeg` (hoặc tải từ https://ffmpeg.org, rồi đặt `FFMPEG_BIN`, `FFPROBE_BIN` trong `.env`) |
| macOS | `brew install python` | `brew install ffmpeg` |
| Ubuntu/Debian | `sudo apt install python3 python3-venv` | `sudo apt install ffmpeg` |

### Bước 2 – Cài thư viện

```bash
cd tri_tue_co_nhan
python -m venv .venv
# Windows: .venv\Scripts\activate      macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

### Bước 3 – Khởi tạo dự án

```bash
python main.py init --demo-assets
```

Lệnh này tạo thư mục, dữ liệu mẫu (56 câu nói), tệp `.env`, tài nguyên **placeholder** để chạy thử và kiểm tra
môi trường. Chạy lại `python main.py doctor` bất cứ lúc nào để kiểm tra.

### Bước 4 – Cấu hình giọng đọc (khuyến nghị)

Mặc định `voice.provider: gemini`. Khi chưa có `GEMINI_API_KEY`, video có phụ đề + nhạc nền nhưng **chưa có giọng đọc** và sẽ không được duyệt.
Cách nhanh nhất nếu bạn có tài khoản Google – **Gemini API (miễn phí trong hạn mức)**:

1. Lấy khóa tại https://aistudio.google.com/apikey
2. Điền vào `.env`: `GEMINI_API_KEY=...`
3. Trong `config/settings.yaml`: `voice.provider: gemini`

Các lựa chọn khác (tự thu âm / Google Cloud TTS / edge-tts): [docs/HUONG_DAN_GIONG_DOC.md](docs/HUONG_DAN_GIONG_DOC.md). Kiểm tra:

```bash
python main.py voice test
```

### Bước 5 – Bổ sung tài nguyên thật

Đặt ảnh/video thiên nhiên vào `assets/backgrounds/`, nhạc nền vào `assets/music/`, (tùy chọn) phông chữ vào
`assets/fonts/`, logo vào `assets/logo/logo.png`, ghi giấy phép vào `assets/LICENSES.csv`.
Xem [docs/TAI_NGUYEN_VA_BAN_QUYEN.md](docs/TAI_NGUYEN_VA_BAN_QUYEN.md). Xóa các tệp `placeholder_*` khi đã có tài nguyên thật.

---

## 2. Tạo 5 video mỗi ngày

```bash
python main.py daily
```

Lệnh này làm bước 1–8: chọn 5 câu chưa dùng (xoay vòng chủ đề) → kiểm tra nguồn → tạo lời đọc, tiêu đề, mô tả,
hashtag → sinh giọng đọc (nếu đã cấu hình) → sinh phụ đề SRT → dựng video (3 mẫu xoay vòng) → kiểm tra chất lượng.
Kết quả:

| Ở đâu | Có gì |
|---|---|
| `output/videos/<run_id>/` | Các tệp MP4 |
| `output/subtitles/<run_id>/` | Các tệp SRT |
| `output/drafts/<run_id>/<video_id>/` | `voice_script.txt`, `metadata.txt`, `content.json`, giọng đọc, phụ đề… |
| `reports/quality_reports/<run_id>.md` | Báo cáo chất lượng từng video |
| `reports/run_manifest.json` | Nhật ký chi tiết lần chạy mới nhất (mọi lần chạy: `reports/runs/`) |

Bước 9–12 (phê duyệt → đóng gói → đăng → ghi nhận):

```bash
# 9–10. Xem video, rồi duyệt (chỉ video đã qua QC)
python main.py approve --run-id <RUN_ID> --all-passed
python main.py approve --video-id 20261016_01_QA0001          # hoặc duyệt từng video
python main.py reject  --video-id 20261016_02_QB0001 --reason "hình nền chưa hợp"

# 11. Tạo gói đăng bài cho 3 nền tảng (ngày đăng dự kiến)
python main.py package --run-id <RUN_ID> --date 2026-10-17

# Đăng thủ công/lên lịch theo checklist, rồi ghi nhận khi ĐÃ ĐĂNG THẬT
python main.py published --video-id <ID> --platform youtube_shorts --url https://youtube.com/shorts/...

# 12. Cập nhật báo cáo & vòng phản hồi
python main.py report
```

**Nếu bị lỗi giữa chừng** (mất điện, mất mạng…): chạy tiếp mà không tạo trùng video:

```bash
python main.py daily --resume <RUN_ID>
```

Tự động chạy hằng ngày: `scripts/run_daily.sh` (cron) hoặc `scripts/run_daily.bat` (Windows Task Scheduler).

### Các lệnh theo từng bước (nếu muốn chạy riêng)

```bash
python main.py quotes list --topic A          # xem kho câu nói (chủ đề A–H)
python main.py quotes stats                   # tiến độ so với mục tiêu 1.000 câu
python main.py quotes check                   # kiểm tra trùng lặp + nguồn
python main.py content generate --count 5     # chỉ tạo nội dung (tạo run_id mới)
python main.py voice generate                 # giọng đọc + phụ đề cho run gần nhất
python main.py video render --count 5         # dựng video (tự tạo nội dung nếu chưa có lô dở)
python main.py quality-check                  # kiểm tra chất lượng
python main.py package                        # gói đăng bài cho video đã duyệt
python main.py report                         # báo cáo
python main.py status                         # trạng thái từng video
python main.py cost                           # ước tính chi phí/tháng
```

---

## 3. Đưa video lên ba nền tảng

Xem [docs/HUONG_DAN_DANG_BAI.md](docs/HUONG_DAN_DANG_BAI.md). Tóm tắt:

| Nền tảng | Công cụ chính thức (miễn phí) | Tệp cần dùng trong gói |
|---|---|---|
| Facebook Reels | Meta Business Suite → Planner | `*.mp4`, `caption.txt`, `subtitles.srt` |
| TikTok | TikTok Studio (web) → Upload → Schedule | `*.mp4`, `caption.txt` |
| YouTube Shorts | YouTube Studio → Upload → Schedule | `*.mp4`, `title.txt`, `description.txt`, `subtitles.srt` |

`schedule.csv` trong mỗi thư mục ngày gợi ý 5 khung giờ (06:30, 11:30, 17:30, 20:00, 21:30 – giờ Việt Nam).

---

## 4. Kho câu nói

Tệp `data/quotes.csv` (mở được bằng Excel/Google Sheets, mã hóa UTF-8). Các trường chính:

| Trường | Ý nghĩa |
|---|---|
| `quote_id` | Mã, ví dụ `QA0001` (Q + chủ đề + số) |
| `topic` | A Buông bỏ & an nhiên · B Nhân sinh & vô thường · C Nhân quả & từ bi · D Đối nhân xử thế · E Biết đủ & giản dị · F Tu thân & kỷ luật · G Gia đình & tình người · H Danh lợi & thành công |
| `original_quote` | Nguyên văn (Hán Việt / Pāli / tiếng Việt) |
| `translation_vi` | Dịch nghĩa/diễn ý của kênh – chữ lớn trên video |
| `author`, `source_title`, `source_reference` | Tác giả, tác phẩm, chương/kệ |
| `source_status` | `VERIFIED` (bạn đã đối chiếu) · `SOURCE_CITED` (có dẫn tác phẩm + chương) · `TRADITIONAL` (ca dao, tục ngữ, lưu truyền) · `PARAPHRASE` (diễn ý) · `NEEDS_VERIFICATION` (**bị chặn**) |
| `interpretation`, `voice_script` | Ý nghĩa ngắn; lời đọc 35–75 từ (để trống → hệ thống dựng từ mẫu) |
| `background_keywords` | Từ khóa chọn hình nền (mountain, lake, bamboo…) |
| `title`, `description`, `hashtags` | Để trống → tự sinh |
| `usage_status` | `AVAILABLE` → `RESERVED` → `PRODUCED` → `PUBLISHED` (hoặc `RETIRED`) |

Mục tiêu 1.000 câu: A 200 · B 150 · C 150 · D 150 · E 100 · F 100 · G 100 · H 50. Hiện có **56 câu mẫu**
(46 có dẫn nguồn cụ thể, 7 lưu truyền, 1 diễn ý, 2 cần xác minh – minh họa câu hay bị gán sai tác giả).
**Không** tạo câu giả cho đủ số lượng: hãy bổ sung dần từ sách gốc.

```bash
python main.py quotes import cau_moi.csv --dry-run   # thử trước
python main.py quotes import cau_moi.csv             # nhập (bỏ qua câu trùng, hạ cấp câu thiếu nguồn)
python main.py quotes import --gsheet                # từ Google Sheets (đặt GSHEET_CSV_URL trong .env)
python main.py quotes export xuat.csv --topic A
```

Khuyến nghị: trước khi đăng một câu `SOURCE_CITED`, đối chiếu bản gốc rồi đổi thành `VERIFIED`.
Cách đánh số chương Luận Ngữ có thể lệch 1 giữa các bản – đã ghi chú trong dữ liệu.

---

## 5. Cấu hình

- `config/settings.yaml` – số video/ngày, giọng đọc, thời lượng, âm lượng nhạc, nền tảng, khung giờ, giá tham khảo.
- `config/video_template.yaml` – 3 mẫu video: **Sương mai** (zoom vào), **Mặt hồ** (lia ngang, tông ấm),
  **Trúc lâm** (zoom ra, khung chữ bán trong suốt). Có thể thêm mẫu mới và khai báo trong `video.template_rotation`.
- `.env` – khóa API (tùy chọn). **Không bao giờ** commit tệp này (đã có trong `.gitignore`).
- `templates/prompts/content_rewrite_system.md` – prompt cho Claude API (khi bật `content.provider: anthropic`).

---

## 6. Chi phí

```bash
python main.py cost
```

| Thành phần | Chi phí | Ghi chú |
|---|---|---|
| Python, FFmpeg, dựng video, phụ đề, kiểm tra, đóng gói | 0 đ | Chạy trên máy bạn |
| Nội dung từ CSV + mẫu | 0 đ | Mặc định |
| Đăng/lên lịch bằng công cụ chính thức | 0 đ | Thủ công |
| Giọng đọc: tự thu / edge-tts | 0 đ | edge-tts không chính thức |
| Giọng đọc: Gemini API | 0 đ trong hạn mức miễn phí (hệ thống chỉ gọi ~5 lần/ngày) | Vượt hạn mức/gói trả phí: theo bảng giá Gemini API |
| Giọng đọc: Google Cloud TTS | ~0 đ trong hạn mức miễn phí (150 video × ~240 ký tự ≈ 36.000 ký tự/tháng) | Cần tài khoản thanh toán |
| Claude API viết lại lời đọc (tùy chọn) | ≈ 129.000 đ/tháng với `claude-opus-5-5` (ước tính 900 token vào + 1.500 token ra mỗi video) | Chỉ khi bật `content.provider: anthropic` |

Tất cả nằm trong ngân sách 0–500.000 đ/tháng. Giá là tham khảo – kiểm tra bảng giá chính thức trước khi bật.

---

## 7. Kiểm thử

```bash
python -m pytest                 # toàn bộ (~1 phút, có 1 bài dựng video thật)
python -m pytest -m "not slow"   # bỏ qua bài dựng video
```

---

## 8. Những gì CHƯA tự động hóa / cần bạn cấu hình

| Hạng mục | Trạng thái |
|---|---|
| Giọng đọc | Có sẵn 5 nhà cung cấp (gồm Gemini); **bạn cần chọn và cấu hình** (mặc định: chưa có giọng đọc). |
| Tài nguyên hình/nhạc | Chỉ có placeholder tự sinh; **bạn cần bổ sung tài nguyên có giấy phép**. |
| Đăng bài tự động qua API | Chỉ có khung (`src/platforms/`), **chưa cài đặt, chưa kiểm chứng**; đăng thủ công bằng gói nội dung. |
| Phê duyệt video | Thủ công (có chủ đích). |
| Xác minh nguồn câu nói | Thủ công – đổi `SOURCE_CITED` → `VERIFIED` sau khi đối chiếu. |
| Mở rộng kho tới 1.000 câu | Thủ công/nhập CSV – không sinh câu giả. |
| Analytics | Nhập CSV thật bằng `analytics import`; không có số liệu giả. |

## 9. Cấu trúc thư mục

```
tri_tue_co_nhan/
├── main.py                 # CLI
├── config/                 # settings.yaml, video_template.yaml
├── data/                   # quotes.csv, content_queue.csv, publishing_log.csv, analytics.csv
├── assets/                 # backgrounds/, music/, fonts/, logo/, LICENSES.csv
├── src/                    # quote_manager, content_generator, voice_generator, subtitle_generator,
│                           # video_renderer, metadata_generator, quality_checker, publishing_manager,
│                           # pipeline, reporting, llm_client, production_queue, platforms/
├── templates/              # prompts/, subtitles/
├── output/                 # drafts/, videos/, subtitles/, approved/, publishing_packages/
├── reports/                # FEEDBACK_LOOP.md, run_manifest.json, runs/, quality_reports/, logs/
├── scripts/                # build_seed_quotes, generate_placeholder_assets, run_daily.sh/.bat
├── docs/                   # hướng dẫn giọng đọc, đăng bài, tài nguyên & bản quyền
└── tests/                  # pytest
```
