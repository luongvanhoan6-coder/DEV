# Báo cáo nghiệm thu MVP – 16/10/2026

Môi trường kiểm thử: Linux (container đám mây), Python 3.13.16, FFmpeg 6.1.1 (libx264, aac, libass, zoompan),
Pillow 12, PyYAML 6, phông DejaVu Serif. Mạng ra ngoài bị proxy giới hạn.

## 1. Kết quả theo tiêu chí nghiệm thu

| Tiêu chí | Kết quả | Bằng chứng |
|---|---|---|
| README hướng dẫn cài đặt → sử dụng | ✅ | `README.md`, `docs/` |
| Lệnh khởi tạo dự án | ✅ | `python main.py init --demo-assets` |
| Dữ liệu mẫu | ✅ 56 câu (≥ 30) | `data/quotes.csv`; `quotes check`: 0 trùng, 2 câu bị chặn do NEEDS_VERIFICATION |
| Tạo nội dung hàng loạt | ✅ | `content generate --count 5`, `daily` |
| Dựng video | ✅ 5/5 MP4 1080×1920, H.264/AAC, 25–29 giây | `daily` (chạy thật, ~57 giây/video) |
| Kiểm tra chất lượng | ✅ 16 hạng mục/video | `reports/quality_reports/<run_id>.md` |
| Gói đăng bài 3 nền tảng | ✅ | `package` → mp4, caption, title, description, hashtags, srt, source, checklist, schedule.csv |
| Báo cáo sau mỗi lần chạy | ✅ | `reports/FEEDBACK_LOOP.md`, `reports/run_manifest.json`, `reports/runs/` |
| Hướng dẫn cấu hình giọng đọc | ✅ | `docs/HUONG_DAN_GIONG_DOC.md`, `voice test` |
| Hướng dẫn lên lịch đăng bài | ✅ | `docs/HUONG_DAN_DANG_BAI.md`, `scripts/run_daily.sh/.bat` |
| Ghi rõ tính năng chưa cấu hình | ✅ | `doctor`, README mục 8, cảnh báo trong báo cáo chất lượng |
| Kiểm thử chạy thật, báo kết quả | ✅ 34/34 đạt | `python -m pytest` (68 giây) |

## 2. Kịch bản chạy thực tế (CLI)

```text
$ python main.py init --demo-assets          -> 6 hình nền + 1 nhạc nền placeholder, doctor OK
$ FFMPEG_BIN=/khong/co/ffmpeg python main.py daily
  -> 5 video dừng ở SUBTITLED, lỗi "Không tìm thấy ffmpeg" ghi vào hàng đợi + manifest; 0/5 qua QC
$ python main.py daily --resume RUN_20261016_201228_591c
  -> chỉ dựng phần còn thiếu; 5/5 QC_PASSED; hàng đợi vẫn 5 dòng (không trùng);
     kho câu: 5 PRODUCED, 51 AVAILABLE (không giữ chỗ thêm); manifest attempts = 2; dựng 279,7 giây
$ python main.py approve --run-id ... --all-passed
  -> từ chối cả 5: "chưa có giọng đọc" (đúng thiết kế khi chưa cấu hình TTS)
$ python main.py approve --video-id ... --allow-no-voice ; python main.py package
  -> gói cho facebook_reels / tiktok / youtube_shorts + schedule.csv; trạng thái PACKAGED (không phải PUBLISHED)
$ python main.py published --url "chua-dang" -> bị từ chối: cần URL bài đăng thật
$ python main.py report                      -> FEEDBACK_LOOP.md cập nhật, giữ ghi chú tay
$ python main.py cost                        -> cấu hình hiện tại 0 đ/tháng; bật mọi tùy chọn trả phí ≈ 129.000 đ/tháng
```

Kiểm tra kỹ thuật một video mẫu: `h264 1080x1920 26.13s` + `aac 26.13s` (lệch 0,00 s); giải mã toàn bộ không lỗi;
âm lượng nhạc nền trung bình −30,7 dB (chưa có giọng đọc). Đã xem khung hình của 3 mẫu: chữ tiếng Việt có dấu hiển
thị đúng, phụ đề không chồng lên khối câu nói.

## 3. Danh sách kiểm thử (34)

| Nhóm yêu cầu | Bài kiểm thử |
|---|---|
| 1. Đọc/ghi CSV | `test_csv_roundtrip_vietnamese`, `test_seed_data_valid`, `test_export` |
| 2. Phát hiện trùng | `test_duplicate_detection_exact_and_near`, `test_import_skips_duplicates_and_downgrades_unsourced` |
| 3. Kiểm tra nguồn | `test_source_check_rules`, `test_select_by_id_rejects_unverified`, `test_select_quotes_rotates_topics_and_skips_blocked`, `test_used_quotes_not_reused_and_release` |
| 4. Sinh metadata | `test_build_content_has_all_outputs`, `test_template_voice_script_keeps_quote_and_neutral_attribution`, `test_hashtags_and_titles`, `test_platform_captions_respect_limits`, `test_llm_without_key_falls_back`, `test_generate_batch_writes_files` |
| 5. Sinh phụ đề SRT | `test_srt_format_and_validation`, `test_srt_validation_detects_errors`, `test_timeline_clamped`, `test_sentence_timings_alignment`, `test_ass_contains_style_and_text` |
| Giọng đọc | `test_voice_provider_none_returns_none`, `test_unknown_provider_rejected`, `test_manual_voice_provider`, `test_voice_failure_is_recorded_not_faked` |
| 6. Tài nguyên đầu vào | `test_assets_empty_reports_errors`, `test_assets_placeholder_warning_and_corrupt_file` |
| 7. Dựng video mẫu | `test_render_one_real_video` (FFmpeg thật) |
| 8. Phát hiện video lỗi | `test_detect_broken_videos` (rác, thiếu tệp, sai kích thước, quá ngắn, không tiếng, tệp bị cắt cụt) |
| 9. Gói đăng bài | `test_approval_package_and_publish_log` |
| 10. Nhật ký & chạy tiếp | `test_resume_after_failure_without_duplicates`, `test_feedback_loop_written_once_and_keeps_manual_notes` |
| Bảo mật & chi phí | `test_secrets_are_redacted`, `test_env_is_gitignored_and_example_has_no_secrets`, `test_cost_estimate_free_by_default` |

## 4. Chưa kiểm chứng được trong môi trường này

| Hạng mục | Lý do | Cách tự kiểm tra |
|---|---|---|
| Giọng đọc edge-tts | Proxy chặn `speech.platform.bing.com` (403). Đã kiểm chứng: lỗi được báo trong < 1 s, có giới hạn 90 s, không tạo âm thanh giả | `pip install edge-tts` → `python main.py voice test --provider edge_tts` |
| Google Cloud TTS | Không có API key | Đặt `GOOGLE_TTS_API_KEY` → `python main.py voice test --provider google_cloud` |
| Claude API viết lời đọc | Không có API key; chỉ kiểm thử nhánh dự phòng khi thiếu key | Đặt `ANTHROPIC_API_KEY`, `pip install anthropic`, `content generate --count 1 --use-llm` |
| Nhập Google Sheets | Không có trang tính | Đặt `GSHEET_CSV_URL` → `quotes import --gsheet --dry-run` |
| Đăng bài tự động qua API | Chỉ có khung, chưa cài đặt (có chủ đích) | Xem `python main.py publishers` |
| Chạy trên Windows/macOS | Chỉ thử trên Linux | `python main.py doctor` |

## 5. Lỗi đã phát hiện và sửa trong quá trình chạy thử

1. edge-tts **treo vô hạn** khi mạng bị chặn → chuyển sang chạy bất đồng bộ có `timeout_sec` (mặc định 90 s) và
   dùng proxy từ `HTTPS_PROXY`.
2. `FFMPEG_BIN` trỏ tới tệp không tồn tại vẫn được coi là "có ffmpeg" → nay kiểm tra tệp tồn tại.
3. Thông báo cuối `daily` hiện ✅ và gợi ý duyệt khi 0/5 video thành công → đổi biểu tượng theo kết quả và chỉ gợi ý
   duyệt khi có video đạt.
4. Bước `quality_check` ghi `ok` khi chưa có video nào → nay ghi lỗi cho từng video thiếu.
5. README ghi ước tính chi phí Claude API 45.000 đ/tháng → sửa thành ≈ 129.000 đ/tháng theo `python main.py cost`.
