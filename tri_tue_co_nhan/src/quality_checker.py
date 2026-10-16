"""Kiểm tra chất lượng: tài nguyên đầu vào và từng video đầu ra."""
from __future__ import annotations

from pathlib import Path

from .common import (
    Context, ffmpeg_bin, ffprobe_bin, ffprobe_json, find_font, read_csv, run_cmd, word_count, write_json,
)
from .quote_manager import check_source
from .subtitle_generator import validate_srt
from .video_renderer import AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, is_placeholder, list_backgrounds, list_music


# ---------------------------------------------------------------- tài nguyên đầu vào
def check_assets(ctx: Context) -> dict:
    errors, warnings, info = [], [], []
    if not ffmpeg_bin() or not ffprobe_bin():
        errors.append("Không tìm thấy ffmpeg/ffprobe – không thể dựng hoặc kiểm tra video.")
    bgs = list_backgrounds(ctx)
    music = list_music(ctx)
    fonts = [p for p in ctx.path("assets", "fonts").glob("*") if p.suffix.lower() in (".ttf", ".otf")]
    logo = ctx.path(ctx.cfg("video.logo_file", "assets/logo/logo.png"))
    if not bgs:
        errors.append("assets/backgrounds trống – video sẽ chỉ có nền màu trơn. Xem docs/TAI_NGUYEN_VA_BAN_QUYEN.md.")
    elif all(is_placeholder(b) for b in bgs):
        warnings.append("Chỉ có hình nền placeholder tự sinh – hãy bổ sung ảnh/video thiên nhiên có giấy phép.")
    elif len([b for b in bgs if not is_placeholder(b)]) < 5:
        warnings.append("Ít hơn 5 hình nền thật – các video dễ bị lặp hình.")
    if not music:
        warnings.append("assets/music trống – video không có nhạc nền.")
    elif all(is_placeholder(m) for m in music):
        warnings.append("Chỉ có nhạc nền placeholder tự sinh – nên bổ sung nhạc có giấy phép.")
    font = find_font(ctx, "quote")
    if not font:
        errors.append("Không tìm thấy phông chữ hỗ trợ tiếng Việt – đặt tệp .ttf vào assets/fonts.")
    elif not fonts:
        info.append(f"Dùng phông hệ thống: {font}")
    if not logo.exists():
        info.append("Không có logo – tên kênh sẽ hiển thị bằng chữ.")
    # giấy phép tài nguyên
    licenses = {r.get("file", "").strip() for r in read_csv(ctx.path("assets", "LICENSES.csv"))}
    unlicensed = [p.name for p in bgs + music if not is_placeholder(p) and p.name not in licenses]
    if unlicensed:
        warnings.append("Tài nguyên chưa ghi giấy phép trong assets/LICENSES.csv: " + ", ".join(unlicensed[:10])
                        + (" …" if len(unlicensed) > 10 else ""))
    bad = []
    for p in bgs + music:
        ext = p.suffix.lower()
        if ext in IMAGE_EXT:
            try:
                from PIL import Image
                with Image.open(p) as im:
                    im.verify()
            except Exception:
                bad.append(p.name)
        elif ext in VIDEO_EXT | AUDIO_EXT and ffprobe_bin():
            if not ffprobe_json(p):
                bad.append(p.name)
    if bad:
        errors.append("Tệp tài nguyên không đọc được: " + ", ".join(bad))
    return {
        "ok": not errors, "errors": errors, "warnings": warnings, "info": info,
        "counts": {"backgrounds": len(bgs), "backgrounds_placeholder": sum(is_placeholder(b) for b in bgs),
                   "music": len(music), "music_placeholder": sum(is_placeholder(m) for m in music),
                   "fonts": len(fonts), "logo": logo.exists()},
        "font_in_use": str(font) if font else None,
    }


# ---------------------------------------------------------------- video đầu ra
def _check(checks: list, name: str, ok: bool, detail: str = "", level: str = "error") -> None:
    checks.append({"name": name, "ok": bool(ok), "level": level, "detail": detail})


def check_video(ctx: Context, video_path: Path, content: dict | None = None, srt_path: Path | None = None,
                voice_meta: dict | None = None, render_meta: dict | None = None, deep: bool = True) -> dict:
    checks: list[dict] = []
    W, H = int(ctx.cfg("video.width", 1080)), int(ctx.cfg("video.height", 1920))
    vmin, vmax = float(ctx.cfg("video.min_duration_sec", 15)), float(ctx.cfg("video.max_duration_sec", 30))
    tol = float(ctx.cfg("quality.duration_tolerance_sec", 0.6))
    duration = None

    exists = video_path is not None and Path(video_path).exists()
    _check(checks, "Tệp MP4 tồn tại", exists, str(video_path))
    info = ffprobe_json(video_path) if exists else None
    _check(checks, "MP4 đọc được (ffprobe)", info is not None and bool(info.get("streams")))
    if info and info.get("streams"):
        streams = info["streams"]
        v = next((s for s in streams if s.get("codec_type") == "video"), None)
        a = next((s for s in streams if s.get("codec_type") == "audio"), None)
        try:
            duration = float(info["format"]["duration"])
        except (KeyError, ValueError, TypeError):
            duration = None
        _check(checks, "Có luồng hình", v is not None)
        if v:
            _check(checks, f"Kích thước {W}x{H} (9:16)", v.get("width") == W and v.get("height") == H,
                   f"{v.get('width')}x{v.get('height')}")
            _check(checks, "Codec video H.264", v.get("codec_name") == "h264", v.get("codec_name", ""))
            _check(checks, "Định dạng điểm ảnh yuv420p", v.get("pix_fmt") == "yuv420p", v.get("pix_fmt", ""),
                   level="warning")
        _check(checks, "Có luồng âm thanh", a is not None)
        if a:
            _check(checks, "Codec âm thanh AAC", a.get("codec_name") == "aac", a.get("codec_name", ""))
        _check(checks, f"Thời lượng {vmin:.0f}–{vmax:.0f}s",
               duration is not None and vmin - tol <= duration <= vmax + tol,
               f"{duration:.2f}s" if duration else "không xác định")
        if v and a:
            try:
                drift = abs(float(v.get("duration")) - float(a.get("duration")))
                _check(checks, "Đồng bộ độ dài hình/tiếng", drift <= float(ctx.cfg("quality.max_av_drift_sec", 0.5)),
                       f"lệch {drift:.2f}s")
            except (TypeError, ValueError):
                _check(checks, "Đồng bộ độ dài hình/tiếng", False, "không đọc được thời lượng luồng", "warning")
        size_kb = Path(video_path).stat().st_size / 1024
        _check(checks, "Dung lượng tệp hợp lý", size_kb >= float(ctx.cfg("quality.min_file_size_kb", 100)),
               f"{size_kb:.0f} KB")
        if deep and ffmpeg_bin():
            res = run_cmd([ffmpeg_bin(), "-v", "error", "-i", str(video_path), "-f", "null", "-"], timeout=600)
            _check(checks, "Giải mã toàn bộ không lỗi", res.returncode == 0 and not res.stderr.strip(),
                   res.stderr.strip()[:200])

    if srt_path is not None:
        cues, errs = validate_srt(Path(srt_path), duration)
        _check(checks, "Phụ đề SRT hợp lệ", not errs, "; ".join(errs[:3]) or f"{len(cues)} đoạn")

    if voice_meta is not None or render_meta is not None:
        has_voice = bool(voice_meta and voice_meta.get("file"))
        _check(checks, "Có giọng đọc", has_voice,
               voice_meta.get("provider", "") if has_voice else "Chưa cấu hình TTS – video chỉ có phụ đề/nhạc",
               level="warning")
        if has_voice and render_meta and duration:
            tl = render_meta.get("timeline", {})
            end_voice = tl.get("head", 0) + (voice_meta.get("duration") or 0)
            _check(checks, "Giọng đọc nằm trọn trong video", end_voice <= duration + 0.05,
                   f"giọng kết thúc {end_voice:.2f}s / video {duration:.2f}s")

    if render_meta:
        ph = [n for n, flag in (("hình nền", render_meta.get("background_placeholder")),
                                ("nhạc nền", render_meta.get("music_placeholder"))) if flag]
        _check(checks, "Tài nguyên thật (không phải placeholder)", not ph,
               ("Đang dùng " + ", ".join(ph) + " placeholder") if ph else "", level="warning")
        _check(checks, "Có hình nền", bool(render_meta.get("background")),
               "" if render_meta.get("background") else "Nền màu trơn – thiếu tài nguyên", level="warning")

    if content:
        problems = check_source(content, ctx.cfg("production.allowed_source_statuses"))
        _check(checks, "Nguồn câu nói đạt yêu cầu", not problems, "; ".join(problems))
        missing = [k for k in ("title", "description", "hashtags", "voice_script") if not content.get(k)]
        _check(checks, "Metadata đầy đủ", not missing, ", ".join(missing))
        tmax = int(ctx.cfg("content.title_max_chars", 90))
        _check(checks, f"Tiêu đề ≤ {tmax} ký tự", len(content.get("title", "")) <= tmax,
               f"{len(content.get('title', ''))} ký tự", level="warning")
        wc = word_count(content.get("voice_script", ""))
        lo, hi = ctx.cfg("content.voice_script_min_words", 35), ctx.cfg("content.voice_script_max_words", 75)
        _check(checks, f"Lời đọc {lo}–{hi} từ", lo <= wc <= hi, f"{wc} từ", level="warning")

    errors = [c for c in checks if not c["ok"] and c["level"] == "error"]
    warnings = [c for c in checks if not c["ok"] and c["level"] == "warning"]
    return {"status": "PASS" if not errors else "FAIL", "duration": duration, "checks": checks,
            "errors": [f"{c['name']}: {c['detail']}" for c in errors],
            "warnings": [f"{c['name']}: {c['detail']}" for c in warnings]}


# ---------------------------------------------------------------- báo cáo
def write_quality_report(ctx: Context, run_id: str, results: dict[str, dict], assets: dict) -> tuple[Path, Path]:
    out_dir = ctx.path("reports", "quality_reports")
    json_path = out_dir / f"{run_id}.json"
    write_json(json_path, {"run_id": run_id, "generated_at": ctx.now_iso(), "assets": assets, "videos": results})
    lines = [f"# Báo cáo chất lượng – {run_id}", "", f"Thời điểm: {ctx.now_iso()}", "",
             "## Tài nguyên đầu vào", ""]
    lines += [f"- ❌ {e}" for e in assets["errors"]] + [f"- ⚠️ {w}" for w in assets["warnings"]] + \
             [f"- ℹ️ {i}" for i in assets["info"]]
    if not (assets["errors"] or assets["warnings"] or assets["info"]):
        lines.append("- ✅ Đầy đủ")
    lines += ["", "## Từng video", "", "| Video | Kết quả | Thời lượng | Lỗi | Cảnh báo |", "|---|---|---|---|---|"]
    for vid, r in results.items():
        dur = f"{r['duration']:.1f}s" if r.get("duration") else "–"
        lines.append(f"| {vid} | {'✅ PASS' if r['status'] == 'PASS' else '❌ FAIL'} | {dur} | "
                     f"{'<br>'.join(r['errors']) or '–'} | {'<br>'.join(r['warnings']) or '–'} |")
    lines += ["", "## Chi tiết", ""]
    for vid, r in results.items():
        lines += [f"### {vid}", ""]
        lines += [f"- {'✅' if c['ok'] else ('⚠️' if c['level'] == 'warning' else '❌')} {c['name']}"
                  + (f" – {c['detail']}" if c['detail'] else "") for c in r["checks"]]
        lines.append("")
    md_path = out_dir / f"{run_id}.md"
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path
