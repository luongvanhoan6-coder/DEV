"""Điều phối quy trình sản xuất hằng ngày, có run_id, manifest và khả năng chạy tiếp sau lỗi."""
from __future__ import annotations

import platform
import shutil
import time
from contextlib import contextmanager
from pathlib import Path

from . import content_generator, quality_checker, quote_manager, subtitle_generator, video_renderer, voice_generator
from .common import Context, ffmpeg_bin, new_run_id, read_json, run_cmd, write_json
from .production_queue import (
    draft_dir, load_content, status_at_least, update_status, videos_for_run,
)


# ---------------------------------------------------------------- manifest
def manifest_path(ctx: Context, run_id: str) -> Path:
    return ctx.path("reports", "runs", f"{run_id}.json")


def load_manifest(ctx: Context, run_id: str) -> dict:
    return read_json(manifest_path(ctx, run_id), None) or {
        "run_id": run_id, "created_at": ctx.now_iso(), "timezone": str(ctx.tz),
        "environment": environment_info(ctx), "settings_snapshot": settings_snapshot(ctx),
        "steps": [], "videos": {}, "attempts": 0,
    }


def save_manifest(ctx: Context, manifest: dict) -> None:
    manifest["updated_at"] = ctx.now_iso()
    write_json(manifest_path(ctx, manifest["run_id"]), manifest)
    write_json(ctx.path("reports", "run_manifest.json"), manifest)  # bản mới nhất


def environment_info(ctx: Context) -> dict:
    ff, version = ffmpeg_bin(), None
    if ff:
        try:
            version = (run_cmd([ff, "-version"], timeout=30).stdout.splitlines() or [None])[0]
        except OSError:
            version = None
    return {"os": platform.platform(), "python": platform.python_version(), "ffmpeg": version}


def settings_snapshot(ctx: Context) -> dict:
    # Không chứa bí mật: settings.yaml không lưu API key.
    return {"voice_provider": ctx.cfg("voice.provider"), "content_provider": ctx.cfg("content.provider"),
            "videos_per_day": ctx.cfg("production.videos_per_day"),
            "template_rotation": ctx.cfg("video.template_rotation")}


@contextmanager
def step(ctx: Context, manifest: dict, name: str):
    rec = {"name": name, "started_at": ctx.now_iso(), "ok": False, "errors": []}
    t0 = time.time()
    manifest["steps"].append(rec)
    try:
        yield rec
        rec["ok"] = not rec["errors"]
    except Exception as exc:  # lỗi cả bước – ghi lại rồi ném tiếp
        rec["errors"].append(f"{exc.__class__.__name__}: {exc}")
        raise
    finally:
        rec["ended_at"] = ctx.now_iso()
        rec["seconds"] = round(time.time() - t0, 2)
        save_manifest(ctx, manifest)


def _vrec(manifest: dict, video_id: str) -> dict:
    return manifest["videos"].setdefault(video_id, {"errors": [], "warnings": []})


# ---------------------------------------------------------------- các bước
def run_content(ctx: Context, manifest: dict, count: int, **kw) -> list[str]:
    with step(ctx, manifest, "content") as rec:
        existing = videos_for_run(ctx, manifest["run_id"])
        if existing:
            rec["note"] = f"Đã có {len(existing)} video trong lần chạy này – bỏ qua bước tạo nội dung."
            return [v["video_id"] for v in existing]
        contents = content_generator.generate_batch(ctx, manifest["run_id"], count=count, **kw)
        for c in contents:
            r = _vrec(manifest, c["video_id"])
            r.update({"quote_id": c["quote_id"], "topic": c["topic"], "template": c["template"],
                      "content_provider": c["content_provider"]})
            if c.get("llm_error"):
                r["warnings"].append(f"LLM: {c['llm_error']}")
            if c.get("llm"):
                r["llm_usage"] = c["llm"]
        rec["count"] = len(contents)
        return [c["video_id"] for c in contents]


def run_voice_and_subtitles(ctx: Context, manifest: dict, force: bool = False) -> None:
    font = video_renderer.default_font(ctx)
    font_name = video_renderer.font_family_name(font)
    with step(ctx, manifest, "voice_subtitles") as rec:
        provider = voice_generator.get_provider(ctx)
        ok, msg = provider.is_configured()
        rec["voice_provider"] = provider.name
        if not ok:
            rec["note"] = msg
        for v in videos_for_run(ctx, manifest["run_id"]):
            if status_at_least(v["status"], "SUBTITLED") and v["status"] != "QC_FAILED" and not force:
                continue
            vr = _vrec(manifest, v["video_id"])
            content = load_content(ctx, v)
            d = draft_dir(ctx, v["run_id"], v["video_id"])
            try:
                profile = content.get("voice_profile") or voice_generator.default_profile(ctx, int(v.get("seq") or 1))
                vr["voice_profile"] = profile
                provider_name = ctx.settings.get("_voice_provider_override") or content.get("voice_provider") or None
                vr["voice_provider"] = provider_name or ctx.cfg("voice.provider")
                voice = voice_generator.generate_voice(ctx, content["voice_script"], d, provider_name=provider_name,
                                                       force=force, profile=profile)
            except (voice_generator.VoiceGenerationError, ValueError) as exc:
                vr["errors"].append(f"Giọng đọc: {exc}")
                rec["errors"].append(f"{v['video_id']}: {exc}")
                update_status(ctx, v["video_id"], "DRAFT", error=f"Giọng đọc: {exc}")
                continue
            if voice:
                speech, timings = voice.duration, voice.sentence_timings
                update_status(ctx, v["video_id"], "VOICED", has_voice="yes", voice_provider=voice.provider, error="")
            else:
                speech, timings = subtitle_generator.estimate_speech_duration(ctx, content["voice_script"]), None
                (d / "voice_meta.json").unlink(missing_ok=True)
                vr["warnings"].append("Chưa có giọng đọc – phụ đề căn theo tốc độ ước tính")
                update_status(ctx, v["video_id"], "VOICED", has_voice="no", voice_provider="none", error="")
            timeline = subtitle_generator.compute_timeline(ctx, speech)
            subs = subtitle_generator.generate_subtitles(ctx, content, d, speech, timeline["head"], timings, font_name)
            write_json(d / "timeline.json", timeline)
            vr.update({"has_voice": bool(voice), "timeline": timeline, "subtitle_timing": subs["timing_source"]})
            if not timeline["within_limits"]:
                vr["warnings"].append(f"Thời lượng dự kiến {timeline['total']}s ngoài khoảng cho phép – nên rút gọn lời đọc")
            update_status(ctx, v["video_id"], "SUBTITLED", duration_sec=timeline["total"])


def run_render(ctx: Context, manifest: dict, force: bool = False) -> None:
    font = video_renderer.default_font(ctx)
    with step(ctx, manifest, "render") as rec:
        used: set[str] = set()
        for v in videos_for_run(ctx, manifest["run_id"]):
            vr = _vrec(manifest, v["video_id"])
            d = draft_dir(ctx, v["run_id"], v["video_id"])
            done = v.get("video_path") and ctx.path(v["video_path"]).exists()
            if status_at_least(v["status"], "RENDERED") and v["status"] != "QC_FAILED" and done and not force:
                meta = video_renderer.load_render_meta(d)
                if meta.get("background"):
                    used.add(meta["background"])
                continue
            if not status_at_least(v["status"], "SUBTITLED") and v["status"] != "QC_FAILED":
                vr["errors"].append("Chưa có phụ đề – bỏ qua dựng")
                continue
            content = load_content(ctx, v)
            timeline = read_json(d / "timeline.json", None)
            voice_meta = read_json(d / "voice_meta.json", {})
            voice = d / voice_meta["file"] if voice_meta.get("file") else None
            try:
                meta = video_renderer.render_video(ctx, content, d, voice=voice, timeline=timeline,
                                                   font_path=font, exclude_backgrounds=used)
            except Exception as exc:
                vr["errors"].append(f"Dựng video: {exc}")
                rec["errors"].append(f"{v['video_id']}: {str(exc)[:300]}")
                update_status(ctx, v["video_id"], "SUBTITLED", error=f"Dựng video lỗi: {str(exc)[:300]}")
                ctx.logger.error("Dựng %s lỗi: %s", v["video_id"], exc)
                continue
            if meta.get("background"):
                used.add(meta["background"])
            vr.update({"background": meta["background"], "music": meta["music"],
                       "render_seconds": meta["render_seconds"], "video_path": meta["video_path"]})
            update_status(ctx, v["video_id"], "RENDERED", video_path=meta["video_path"], srt_path=meta["srt_path"],
                          duration_sec=round(meta.get("output_duration") or 0, 2), error="")


def run_quality(ctx: Context, manifest: dict, force: bool = False) -> dict:
    with step(ctx, manifest, "quality_check") as rec:
        assets = quality_checker.check_assets(ctx)
        results: dict[str, dict] = {}
        for v in videos_for_run(ctx, manifest["run_id"]):
            if status_at_least(v["status"], "APPROVED") and v["status"] != "QC_FAILED" and not force:
                continue
            if not v.get("video_path"):
                results[v["video_id"]] = {"status": "FAIL", "duration": None, "checks": [],
                                          "errors": ["Chưa có video (bước dựng chưa hoàn tất)"], "warnings": []}
                rec["errors"].append(f"{v['video_id']}: chưa có video")
                continue
            d = draft_dir(ctx, v["run_id"], v["video_id"])
            content = load_content(ctx, v)
            res = quality_checker.check_video(
                ctx, ctx.path(v["video_path"]), content=content, srt_path=ctx.path(v["srt_path"]),
                voice_meta=read_json(d / "voice_meta.json", {}), render_meta=video_renderer.load_render_meta(d))
            results[v["video_id"]] = res
            vr = _vrec(manifest, v["video_id"])
            vr["qc"] = {"status": res["status"], "errors": res["errors"], "warnings": res["warnings"]}
            if res["status"] == "PASS":
                update_status(ctx, v["video_id"], "QC_PASSED", qc_status="PASS", error="")
                quote_manager.set_usage(ctx, [v["quote_id"]], "PRODUCED", manifest["run_id"])
            else:
                update_status(ctx, v["video_id"], "QC_FAILED", qc_status="FAIL", error="; ".join(res["errors"])[:300])
                rec["errors"].append(f"{v['video_id']}: " + "; ".join(res["errors"])[:300])
        json_p, md_p = quality_checker.write_quality_report(ctx, manifest["run_id"], results, assets)
        rec["report"] = str(md_p.relative_to(ctx.root))
        manifest["assets"] = {k: assets[k] for k in ("errors", "warnings", "counts")}
        return results


def summarize(ctx: Context, manifest: dict) -> dict:
    vids = videos_for_run(ctx, manifest["run_id"])
    by_status: dict[str, int] = {}
    for v in vids:
        by_status[v["status"]] = by_status.get(v["status"], 0) + 1
    ok = sum(1 for v in vids if status_at_least(v["status"], "QC_PASSED") and v["status"] != "QC_FAILED")
    manifest["summary"] = {
        "quotes_processed": len(vids), "videos_succeeded": ok, "videos_failed": len(vids) - ok,
        "by_status": by_status, "with_voice": sum(1 for v in vids if v.get("has_voice") == "yes"),
        "total_seconds": round(sum(s.get("seconds", 0) for s in manifest["steps"]), 1),
    }
    save_manifest(ctx, manifest)
    return manifest["summary"]


def run_daily(ctx: Context, count: int | None = None, resume: str | None = None, force: bool = False, **kw) -> dict:
    """Chạy bước 1–8: chọn câu → nội dung → giọng đọc → phụ đề → dựng → kiểm tra. Dừng ở chờ phê duyệt."""
    run_id = resume or new_run_id(ctx)
    manifest = load_manifest(ctx, run_id)
    manifest["attempts"] = manifest.get("attempts", 0) + 1
    manifest["mode"] = "resume" if resume else "new"
    save_manifest(ctx, manifest)
    ctx.logger.info("Bắt đầu %s (%s)", run_id, manifest["mode"])
    count = count or int(ctx.cfg("production.videos_per_day", 5))
    run_content(ctx, manifest, count, **kw)
    run_voice_and_subtitles(ctx, manifest, force=force)
    run_render(ctx, manifest, force=force)
    run_quality(ctx, manifest, force=force)
    summarize(ctx, manifest)
    ctx.logger.info("Kết thúc %s: %s", run_id, manifest["summary"])
    return manifest


def clean_run_drafts(ctx: Context, run_id: str) -> None:
    shutil.rmtree(ctx.path("output", "drafts", run_id), ignore_errors=True)
