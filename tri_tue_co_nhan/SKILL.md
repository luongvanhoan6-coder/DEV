---
name: tri-tue-co-nhan-video
description: Vận hành hệ thống sản xuất video ngắn "Trí Tuệ Cổ Nhân – Tư Duy An Lạc" – tạo 5 video câu nói triết lý phương Đông mỗi ngày, kiểm tra chất lượng, đóng gói đăng Facebook Reels/TikTok/YouTube Shorts, quản lý kho câu nói và báo cáo. Dùng khi người dùng muốn tạo video hôm nay, thêm câu nói, xem báo cáo, hoặc chuẩn bị đăng bài.
---

# Skill: Vận hành Trí Tuệ Cổ Nhân

Thư mục làm việc: `tri_tue_co_nhan/`. Mọi lệnh chạy bằng `python main.py ...`.

## Tạo video hôm nay

```bash
python main.py doctor
python main.py daily                       # 5 video, dừng ở chờ phê duyệt
cat reports/quality_reports/<run_id>.md    # đọc và tóm tắt cho người dùng
```

Lỗi giữa chừng → `python main.py daily --resume <run_id>` (không tạo trùng).

## Sau khi người dùng duyệt

```bash
python main.py approve --run-id <run_id> --all-passed      # chỉ khi người dùng yêu cầu
python main.py package --run-id <run_id> --date YYYY-MM-DD
python main.py report
```

Gói ở `output/publishing_packages/<ngày>/<nền tảng>/<video_id>/` – hướng dẫn đăng: `docs/HUONG_DAN_DANG_BAI.md`.
Ghi nhận đã đăng chỉ với URL thật: `python main.py published --video-id <id> --platform <p> --url <url>`.

## Kho câu nói

```bash
python main.py quotes stats | list --topic A | check
python main.py quotes import moi.csv --dry-run && python main.py quotes import moi.csv
```

Trạng thái nguồn: VERIFIED, SOURCE_CITED, TRADITIONAL, PARAPHRASE được sản xuất; NEEDS_VERIFICATION bị chặn.

## Giới hạn phải tôn trọng

- Không tự đăng bài, không tạo âm thanh giả, không bịa nguồn/số liệu, không gọi API tính phí khi chưa được phép.
- Chi tiết: `CLAUDE_AGENT_PROMPT.md`.
