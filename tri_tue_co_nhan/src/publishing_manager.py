"""Phê duyệt video, tạo gói nội dung đăng bài cho 3 nền tảng, ghi nhận đăng bài do người dùng xác nhận."""
from __future__ import annotations

import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from . import quote_manager
from .common import Context, read_json, write_csv, write_json
from .metadata_generator import platform_caption
from .production_queue import (
    draft_dir, get_video, load_content, load_queue, log_publishing, status_at_least, update_status,
    videos_for_run,
)


class ApprovalError(RuntimeError):
    pass


def approve(ctx: Context, video_id: str, allow_no_voice: bool = False, note: str = "") -> Path:
    video = get_video(ctx, video_id)
    if not video:
        raise ApprovalError(f"Không tìm thấy video {video_id}")
    if video["status"] in ("APPROVED", "PACKAGED", "PUBLISHED"):
        return ctx.path("output", "approved", video_id)
    if video["status"] != "QC_PASSED":
        raise ApprovalError(f"{video_id} chưa qua kiểm tra chất lượng (trạng thái: {video['status']}).")
    if video.get("has_voice") != "yes" and ctx.cfg("quality.require_voice_for_approval", True) and not allow_no_voice:
        raise ApprovalError(f"{video_id} chưa có giọng đọc. Cấu hình TTS rồi dựng lại, hoặc dùng "
                            f"--allow-no-voice nếu bạn chủ động muốn đăng video chỉ có phụ đề.")
    content = load_content(ctx, video)
    dest = ctx.path("output", "approved", video_id)
    dest.mkdir(parents=True, exist_ok=True)
    src_video = ctx.path(video["video_path"])
    if not src_video.exists():
        raise ApprovalError(f"Không tìm thấy tệp video {src_video}")
    shutil.copy2(src_video, dest / video["file_name"])
    shutil.copy2(ctx.path(video["srt_path"]), dest / Path(video["file_name"]).with_suffix(".srt").name)
    write_json(dest / "content.json", content)
    write_json(dest / "approval.json", {"video_id": video_id, "approved_at": ctx.now_iso(),
                                        "allow_no_voice": allow_no_voice, "note": note})
    update_status(ctx, video_id, "APPROVED")
    ctx.logger.info("Duyệt %s", video_id)
    return dest


def approve_run(ctx: Context, run_id: str, allow_no_voice: bool = False) -> tuple[list[str], dict[str, str]]:
    ok, failed = [], {}
    for v in videos_for_run(ctx, run_id):
        if v["status"] in ("APPROVED", "PACKAGED", "PUBLISHED"):
            ok.append(v["video_id"])
            continue
        try:
            approve(ctx, v["video_id"], allow_no_voice=allow_no_voice)
            ok.append(v["video_id"])
        except ApprovalError as exc:
            failed[v["video_id"]] = str(exc)
    return ok, failed


def reject(ctx: Context, video_id: str, reason: str) -> None:
    update_status(ctx, video_id, "QC_FAILED", error=f"Người dùng từ chối: {reason}")


CHECKLIST = """# Checklist trước khi đăng – {platform_label}

Video: `{file_name}`  ·  Câu nói: {quote_id}  ·  Chủ đề: {topic_name}

## Nội dung & nguồn
- [ ] Đã xem hết video, chữ hiển thị đúng dấu tiếng Việt, không lỗi chính tả.
- [ ] Câu nói đúng với nguồn: **{attribution}** – trạng thái: {source_status} ({source_status_label}).
- [ ] Nếu trạng thái là SOURCE_CITED: đã đối chiếu với bản gốc/bản dịch đáng tin cậy.
- [ ] Không gán sai tác giả; lời dịch được ghi là do kênh biên soạn.

## Kỹ thuật
- [ ] Video 9:16, 1080×1920, thời lượng {duration}.
- [ ] Giọng đọc rõ, nhạc nền nhỏ hơn giọng đọc. Có giọng đọc: {has_voice}.
- [ ] Hình nền/nhạc nền có giấy phép phù hợp (assets/LICENSES.csv).

## Đăng bài
- [ ] Sao chép tiêu đề/chú thích từ `caption.txt`{title_hint}.
- [ ] Tải phụ đề `subtitles.srt` nếu nền tảng hỗ trợ (YouTube: có; Facebook: có; TikTok: dùng phụ đề tự động hoặc chữ trên video).
- [ ] Chọn chế độ hiển thị và thời gian lên lịch: gợi ý **{slot}** (Asia/Ho_Chi_Minh).
- [ ] Đánh dấu nội dung không dành cho trẻ em / AI-generated theo quy định của nền tảng nếu áp dụng.
- [ ] Sau khi đăng THẬT, ghi nhận:
      `python main.py published --video-id {video_id} --platform {platform} --url <đường_dẫn_bài_đăng>`
"""


def _link_or_copy(src: Path, dst: Path) -> None:
    if dst.exists():
        return
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def schedule_slots(ctx: Context, n: int, day: datetime) -> list[str]:
    slots = ctx.cfg("publishing.schedule_slots") or ["20:00"]
    out = []
    for i in range(n):
        d = day + timedelta(days=i // len(slots))
        out.append(f"{d.strftime('%Y-%m-%d')} {slots[i % len(slots)]}")
    return out


def package(ctx: Context, run_id: str | None = None, video_ids: list[str] | None = None,
            publish_date: str | None = None) -> list[Path]:
    """Tạo gói nội dung cho các video đã duyệt (APPROVED) và chưa đóng gói."""
    rows = load_queue(ctx)
    targets = [r for r in rows if r["status"] == "APPROVED"
               and (not run_id or r["run_id"] == run_id) and (not video_ids or r["video_id"] in video_ids)]
    if not targets:
        return []
    day = datetime.strptime(publish_date, "%Y-%m-%d") if publish_date else (ctx.now() + timedelta(days=1))
    date_dir = day.strftime("%Y-%m-%d")
    base = ctx.path("output", "publishing_packages", date_dir)
    slots = schedule_slots(ctx, len(targets), day)
    platforms = ctx.cfg("publishing.platforms", {})
    schedule_rows, created = [], []
    for video, slot in zip(targets, slots):
        content = load_content(ctx, video)
        approved_dir = ctx.path("output", "approved", video["video_id"])
        mp4 = approved_dir / video["file_name"]
        srt = approved_dir / Path(video["file_name"]).with_suffix(".srt").name
        if not mp4.exists():
            raise FileNotFoundError(f"Thiếu video đã duyệt: {mp4}")
        voice_meta = read_json(draft_dir(ctx, video["run_id"], video["video_id"]) / "voice_meta.json", {})
        for pname, pconf in platforms.items():
            pdir = base / pname / video["video_id"]
            pdir.mkdir(parents=True, exist_ok=True)
            _link_or_copy(mp4, pdir / video["file_name"])
            shutil.copy2(srt, pdir / "subtitles.srt")
            cap = platform_caption(content, pname, pconf)
            (pdir / "caption.txt").write_text(
                (f"TIÊU ĐỀ:\n{cap['title']}\n\n" if cap["title"] else "") + f"CHÚ THÍCH:\n{cap['caption']}\n",
                encoding="utf-8")
            if cap["title"]:
                (pdir / "title.txt").write_text(cap["title"] + "\n", encoding="utf-8")
            (pdir / "description.txt").write_text(cap["caption"] + "\n", encoding="utf-8")
            (pdir / "hashtags.txt").write_text(" ".join(cap["hashtags"]) + "\n", encoding="utf-8")
            (pdir / "source.txt").write_text(
                f"Câu nói hiển thị: {content['quote_display']}\nNguyên văn: {content['original_quote']}\n"
                f"Tác giả/Nguồn: {content['attribution']}\nTrạng thái nguồn: {content['source_status']} – "
                f"{content['source_status_label']}\nGhi chú: {content.get('notes') or '–'}\n"
                f"Lời dịch/diễn ý: do kênh biên soạn.\n", encoding="utf-8")
            (pdir / "checklist.md").write_text(CHECKLIST.format(
                platform_label=pconf.get("label", pname), platform=pname, file_name=video["file_name"],
                quote_id=content["quote_id"], topic_name=content["topic_name"], attribution=content["attribution"],
                source_status=content["source_status"], source_status_label=content["source_status_label"],
                duration=f"{float(video.get('duration_sec') or 0):.1f}s",
                has_voice="có" if voice_meta.get("file") else "KHÔNG",
                title_hint=" và `title.txt`" if cap["title"] else "", slot=slot, video_id=video["video_id"]),
                encoding="utf-8")
            write_json(pdir / "metadata.json", {**cap, "video_id": video["video_id"], "platform": pname,
                                                "suggested_schedule": slot, "quote_id": content["quote_id"],
                                                "source_status": content["source_status"]})
            log_publishing(ctx, video["video_id"], content["quote_id"], pname, "PACKAGED",
                           package_path=str(pdir.relative_to(ctx.root)), note=f"Gợi ý lịch {slot}")
            schedule_rows.append({"suggested_time": slot, "platform": pname, "video_id": video["video_id"],
                                  "title": cap["title"] or content["title"],
                                  "package_path": str(pdir.relative_to(ctx.root)), "status": "CHỜ ĐĂNG THỦ CÔNG"})
        update_status(ctx, video["video_id"], "PACKAGED")
        created.append(base)
    sched_path = base / "schedule.csv"
    existing = []
    if sched_path.exists():
        from .common import read_csv
        existing = read_csv(sched_path)
    write_csv(sched_path, existing + schedule_rows,
              ["suggested_time", "platform", "video_id", "title", "package_path", "status"])
    return sorted(set(created))


def mark_published(ctx: Context, video_id: str, platform: str, url: str, note: str = "") -> None:
    """Chỉ gọi khi người dùng đã thật sự đăng bài và có đường dẫn bài đăng."""
    if not url or not url.startswith(("http://", "https://")):
        raise ValueError("Cần đường dẫn (URL) bài đăng thật để ghi nhận đã đăng.")
    if platform not in (ctx.cfg("publishing.platforms") or {}):
        raise ValueError(f"Nền tảng không hợp lệ: {platform}")
    video = get_video(ctx, video_id)
    if not video:
        raise ValueError(f"Không tìm thấy video {video_id}")
    if not status_at_least(video["status"], "APPROVED"):
        raise ValueError(f"{video_id} chưa được duyệt – không thể ghi nhận đã đăng.")
    log_publishing(ctx, video_id, video["quote_id"], platform, "PUBLISHED_CONFIRMED_BY_USER", url=url, note=note)
    update_status(ctx, video_id, "PUBLISHED")
    quote_manager.set_usage(ctx, [video["quote_id"]], "PUBLISHED")
