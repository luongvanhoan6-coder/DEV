"""Hàng đợi sản xuất (data/content_queue.csv) và nhật ký đăng bài (data/publishing_log.csv)."""
from __future__ import annotations

import secrets
from pathlib import Path

from .common import (
    PUBLISHING_LOG_FIELDS, QUEUE_FIELDS, VIDEO_STATUS_ORDER, Context, append_csv, read_csv,
    read_json, write_csv, write_json,
)


def queue_path(ctx: Context) -> Path:
    return ctx.path("data", "content_queue.csv")


def load_queue(ctx: Context) -> list[dict]:
    return read_csv(queue_path(ctx))


def save_queue(ctx: Context, rows: list[dict]) -> None:
    write_csv(queue_path(ctx), rows, QUEUE_FIELDS)


def upsert(ctx: Context, video: dict) -> None:
    rows = load_queue(ctx)
    video = dict(video)
    video["updated_at"] = ctx.now_iso()
    for i, r in enumerate(rows):
        if r["video_id"] == video["video_id"]:
            merged = {**r, **{k: v for k, v in video.items() if v is not None}}
            rows[i] = merged
            break
    else:
        video.setdefault("created_at", ctx.now_iso())
        rows.append(video)
    save_queue(ctx, rows)


def update_status(ctx: Context, video_id: str, status: str, **extra) -> None:
    upsert(ctx, {"video_id": video_id, "status": status, **extra})


def videos_for_run(ctx: Context, run_id: str) -> list[dict]:
    return sorted([r for r in load_queue(ctx) if r["run_id"] == run_id], key=lambda r: int(r.get("seq") or 0))


def get_video(ctx: Context, video_id: str) -> dict | None:
    return next((r for r in load_queue(ctx) if r["video_id"] == video_id), None)


def status_at_least(status: str, target: str) -> bool:
    """So sánh tiến trình (QC_FAILED được coi là chưa qua QC_PASSED)."""
    if status == "QC_FAILED":
        return target in ("DRAFT", "VOICED", "SUBTITLED", "RENDERED", "QC_FAILED")
    try:
        return VIDEO_STATUS_ORDER.index(status) >= VIDEO_STATUS_ORDER.index(target)
    except ValueError:
        return False


def latest_run_id(ctx: Context) -> str | None:
    rows = load_queue(ctx)
    if not rows:
        return None
    return max(rows, key=lambda r: r.get("created_at", ""))["run_id"]


# ---------------------------------------------------------------- thư mục làm việc
def draft_dir(ctx: Context, run_id: str, video_id: str) -> Path:
    return ctx.path("output", "drafts", run_id, video_id)


def load_content(ctx: Context, video: dict) -> dict:
    return read_json(draft_dir(ctx, video["run_id"], video["video_id"]) / "content.json", {})


def save_content(ctx: Context, content: dict) -> None:
    write_json(draft_dir(ctx, content["run_id"], content["video_id"]) / "content.json", content)


# ---------------------------------------------------------------- nhật ký đăng bài
def log_publishing(ctx: Context, video_id: str, quote_id: str, platform: str, action: str,
                   package_path: str = "", url: str = "", note: str = "") -> None:
    append_csv(ctx.path("data", "publishing_log.csv"), {
        "log_id": f"L{ctx.now().strftime('%Y%m%d%H%M%S')}{secrets.token_hex(2)}",
        "video_id": video_id, "quote_id": quote_id, "platform": platform, "action": action,
        "package_path": package_path, "url": url, "note": note, "timestamp": ctx.now_iso(),
    }, PUBLISHING_LOG_FIELDS)


def load_publishing_log(ctx: Context) -> list[dict]:
    return read_csv(ctx.path("data", "publishing_log.csv"))


def set_voice_profile(ctx: Context, video_id: str, profile: str, provider: str | None = None) -> bool:
    """Đổi giọng cho một video và đưa về trạng thái cần tạo lại giọng/phụ đề/video."""
    from .voice_generator import list_profiles
    if profile not in list_profiles(ctx):
        raise ValueError(f"Không có hồ sơ giọng '{profile}'. Có: {', '.join(list_profiles(ctx))}")
    video = get_video(ctx, video_id)
    if not video:
        raise ValueError(f"Không tìm thấy video {video_id}")
    if status_at_least(video["status"], "APPROVED"):
        raise ValueError(f"{video_id} đã được duyệt/đóng gói – hãy 'reject' trước khi đổi giọng.")
    content = load_content(ctx, video)
    if provider is not None:
        from .voice_generator import PROVIDERS
        if provider not in PROVIDERS:
            raise ValueError(f"Nhà cung cấp giọng không hợp lệ: {provider}")
    if content.get("voice_profile") == profile and (provider is None or content.get("voice_provider") == provider):
        return False  # không đổi -> không cần dựng lại
    content["voice_profile"] = profile
    if provider is not None:
        content["voice_provider"] = provider
    save_content(ctx, content)
    update_status(ctx, video_id, "DRAFT", error="")
    return True
