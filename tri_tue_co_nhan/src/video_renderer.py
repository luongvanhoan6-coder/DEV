"""Dựng video dọc 9:16 (1080x1920, H.264/AAC) bằng FFmpeg từ tài nguyên đã có quyền sử dụng."""
from __future__ import annotations

import hashlib
import re
import shutil
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .common import (
    Context, ffmpeg_bin, find_font, hex_to_rgb, media_duration, read_json, run_cmd, write_json,
)

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv"}
AUDIO_EXT = {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"}


class RenderError(RuntimeError):
    pass


# ---------------------------------------------------------------- tài nguyên
def list_backgrounds(ctx: Context) -> list[Path]:
    d = ctx.path("assets", "backgrounds")
    return sorted(p for p in d.glob("*") if p.suffix.lower() in IMAGE_EXT | VIDEO_EXT)


def list_music(ctx: Context) -> list[Path]:
    d = ctx.path("assets", "music")
    return sorted(p for p in d.glob("*") if p.suffix.lower() in AUDIO_EXT)


def is_placeholder(p: Path | None) -> bool:
    return bool(p) and p.name.lower().startswith("placeholder_")


def _tokens(name: str) -> set[str]:
    return set(re.split(r"[^a-z0-9]+", name.lower())) - {""}


def choose_background(ctx: Context, content: dict, exclude: set[str] | None = None) -> Path | None:
    bgs = list_backgrounds(ctx)
    if not bgs:
        return None
    exclude = exclude or set()
    tpl = ctx.templates.get(content["template"], {})
    wanted = {k.lower() for k in content.get("background_keywords", [])} | {
        k.lower() for k in tpl.get("preferred_keywords", [])}
    wanted = set().union(*(_tokens(w) for w in wanted)) if wanted else set()

    def score(p: Path) -> tuple:
        hits = len(_tokens(p.stem) & wanted)
        tie = int(hashlib.md5((content["video_id"] + p.name).encode()).hexdigest(), 16) % 1000
        return (p.name not in exclude, not is_placeholder(p), hits, tie)

    return max(bgs, key=score)


def choose_music(ctx: Context, content: dict) -> Path | None:
    tracks = list_music(ctx)
    if not tracks:
        return None
    real = [t for t in tracks if not is_placeholder(t)] or tracks
    idx = int(hashlib.md5(content["video_id"].encode()).hexdigest(), 16) % len(real)
    return real[idx]


# ---------------------------------------------------------------- lớp chữ (overlay PNG)
def _font(path: Path | None, size: int) -> ImageFont.FreeTypeFont:
    if path:
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    lines: list[str] = []
    for para in text.split("\n"):
        words, cur = para.split(), ""
        for w in words:
            cand = f"{cur} {w}".strip()
            if draw.textlength(cand, font=font) <= max_width or not cur:
                cur = cand
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
    return lines


def _gradient(width: int, height: int, top_alpha: float, bottom_alpha: float) -> Image.Image:
    grad = Image.new("L", (1, height))
    for y in range(height):
        t = y / height
        a = 0.0
        if t < 0.45:
            a = top_alpha * (1 - t / 0.45) ** 1.4
        elif t > 0.5:
            a = bottom_alpha * ((t - 0.5) / 0.5) ** 1.3
        grad.putpixel((0, y), int(255 * min(1.0, a)))
    return grad.resize((width, height))


def make_overlay(ctx: Context, content: dict, out_path: Path, font_path: Path | None) -> dict:
    W, H = int(ctx.cfg("video.width", 1080)), int(ctx.cfg("video.height", 1920))
    tpl = ctx.templates.get(content["template"], {})
    ov, qb, ch = tpl.get("overlay", {}), tpl.get("quote_box", {}), tpl.get("channel", {})
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    # 1) phủ màu + dải tối để chữ dễ đọc
    tint = Image.new("RGBA", (W, H), hex_to_rgb(ov.get("tint", "#000000")) + (int(255 * ov.get("tint_opacity", 0.15)),))
    img = Image.alpha_composite(img, tint)
    dark = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    dark.putalpha(_gradient(W, H, ov.get("top_gradient", 0.5), ov.get("bottom_gradient", 0.6)))
    img = Image.alpha_composite(img, dark)

    draw = ImageDraw.Draw(img)
    margin = 90
    max_w = W - 2 * margin
    quote = f"“{content['quote_display'].rstrip()}”"
    size = int(qb.get("font_size", 58))
    font = _font(font_path, size)
    lines = _wrap(draw, quote, font, max_w)
    while len(lines) > 7 and size > 38:
        size -= 4
        font = _font(font_path, size)
        lines = _wrap(draw, quote, font, max_w)
    line_h = int(size * 1.32)

    original = (content.get("original_quote") or "").replace(" / ", ", ")
    show_original = (qb.get("show_original", True) and original and original != content["quote_display"]
                     and len(original) <= 110)
    small = _font(font_path, max(30, int(size * 0.58)))
    orig_lines = _wrap(draw, original, small, max_w) if show_original else []
    attr_font = _font(font_path, max(32, int(size * 0.62)))
    attr = f"— {content['attribution_short']}"
    attr_lines = _wrap(draw, attr, attr_font, max_w)

    block_h = len(lines) * line_h + (len(orig_lines) * int(small.size * 1.3) + 26 if orig_lines else 0) \
        + 30 + len(attr_lines) * int(attr_font.size * 1.3)
    y0 = int(H * float(qb.get("position", 0.16)))

    if qb.get("box"):
        box = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        bd = ImageDraw.Draw(box)
        bd.rounded_rectangle([margin - 40, y0 - 40, W - margin + 40, y0 + block_h + 40], radius=36,
                             fill=hex_to_rgb(qb.get("box_color", "#000000")) + (int(255 * qb.get("box_opacity", 0.4)),))
        img = Image.alpha_composite(img, box)

    text_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(text_layer)
    y = y0
    color = hex_to_rgb(qb.get("color", "#FFFFFF")) + (255,)
    for ln in lines:
        td.text((W / 2, y), ln, font=font, fill=color, anchor="ma")
        y += line_h
    if orig_lines:
        y += 26
        oc = hex_to_rgb(qb.get("original_color", "#E8D9B5")) + (235,)
        for ln in orig_lines:
            td.text((W / 2, y), ln, font=small, fill=oc, anchor="ma")
            y += int(small.size * 1.3)
    y += 30
    for ln in attr_lines:
        td.text((W / 2, y), ln, font=attr_font, fill=hex_to_rgb(qb.get("original_color", "#E8D9B5")) + (255,), anchor="ma")
        y += int(attr_font.size * 1.3)

    # 2) tên kênh hoặc logo
    channel_y = 120 if ch.get("position", "top") == "top" else H - 170
    logo_path = ctx.path(ctx.cfg("video.logo_file", "assets/logo/logo.png"))
    if logo_path.exists():
        logo = Image.open(logo_path).convert("RGBA")
        logo.thumbnail((260, 120))
        text_layer.alpha_composite(logo, (int((W - logo.width) / 2), channel_y - logo.height // 2))
    else:
        cfont = _font(font_path, 34)
        name = ctx.cfg("project.channel_name", "")
        tag = ctx.cfg("project.channel_tagline", "")
        label = f"{name}  ·  {tag}" if tag else name
        td.text((W / 2, channel_y), label.upper(), font=cfont,
                fill=hex_to_rgb(ch.get("color", "#F3E6C4")) + (230,), anchor="mm")

    shadow = text_layer.split()[3].filter(ImageFilter.GaussianBlur(6))
    shadow_img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow_img.putalpha(shadow.point(lambda a: int(a * 0.85)))
    img = Image.alpha_composite(img, shadow_img)
    img = Image.alpha_composite(img, text_layer)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    return {"quote_font_size": size, "quote_lines": len(lines), "block_bottom": y}


# ---------------------------------------------------------------- bộ lọc ffmpeg
def motion_filter(tpl: dict, total: float, fps: int, W: int, H: int) -> str:
    n = max(1, int(round(total * fps)))
    amt = float(tpl.get("zoom_amount", 0.12))
    motion = tpl.get("motion", "zoom_in")
    if motion == "zoom_out":
        z, x, y = f"{1 + amt}-{amt}*on/{n}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    elif motion in ("pan_right", "pan_left"):
        z = f"{1 + amt}"
        x = f"(iw-iw/zoom)*on/{n}" if motion == "pan_right" else f"(iw-iw/zoom)*(1-on/{n})"
        y = "ih/2-(ih/zoom/2)"
    else:  # zoom_in
        z, x, y = f"1+{amt}*on/{n}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    W2, H2 = int(W * 1.5), int(H * 1.5)
    return (f"scale={W2}:{H2}:force_original_aspect_ratio=increase,crop={W2}:{H2},"
            f"zoompan=z='{z}':x='{x}':y='{y}':d=1:s={W}x{H}:fps={fps}")


def build_ffmpeg_cmd(ctx: Context, *, background: Path | None, music: Path | None, voice: Path | None,
                     total: float, head: float, template: dict, has_fonts_dir: bool, out_file: Path) -> list[str]:
    W, H, fps = int(ctx.cfg("video.width", 1080)), int(ctx.cfg("video.height", 1920)), int(ctx.cfg("video.fps", 30))
    fade = float(ctx.cfg("video.fade_sec", 0.8))
    cmd = [ffmpeg_bin() or "ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    # input 0: nền
    if background is None:
        cmd += ["-f", "lavfi", "-t", f"{total:.3f}", "-i", f"color=c=0x1d2b36:s={W}x{H}:r={fps}"]
        bg_chain = "format=yuv420p"
    elif background.suffix.lower() in IMAGE_EXT:
        cmd += ["-loop", "1", "-framerate", str(fps), "-t", f"{total:.3f}", "-i", str(background)]
        bg_chain = motion_filter(template, total, fps, W, H)
    else:
        cmd += ["-stream_loop", "-1", "-t", f"{total:.3f}", "-i", str(background)]
        bg_chain = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={fps}"
    # input 1: lớp chữ
    cmd += ["-loop", "1", "-framerate", str(fps), "-t", f"{total:.3f}", "-i", "overlay.png"]
    idx = 2
    audio_parts, audio_labels = [], []
    voice_idx = music_idx = None
    if voice:
        cmd += ["-i", str(voice)]
        voice_idx, idx = idx, idx + 1
    if music:
        cmd += ["-stream_loop", "-1", "-i", str(music)]
        music_idx, idx = idx, idx + 1
    if voice_idx is None and music_idx is None:
        cmd += ["-f", "lavfi", "-t", f"{total:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        silent_idx = idx
    color = template.get("color_filter") or "null"
    fonts_opt = ":fontsdir=fonts" if has_fonts_dir else ""
    vf = (f"[0:v]{bg_chain},setsar=1,{color}[bg];"
          f"[bg][1:v]overlay=0:0:format=auto,ass=subtitles.ass{fonts_opt},"
          f"fade=t=in:st=0:d={fade},fade=t=out:st={max(0.0, total - fade):.3f}:d={fade},format=yuv420p[vout]")
    if voice_idx is not None:
        ms = int(head * 1000)
        audio_parts.append(f"[{voice_idx}:a]aresample=48000,aformat=channel_layouts=stereo,"
                           f"adelay={ms}|{ms},volume={ctx.cfg('video.voice_volume', 1.0)},apad[voice]")
        audio_labels.append("[voice]")
    if music_idx is not None:
        mv = ctx.cfg("video.music_volume" if voice_idx is not None else "video.music_volume_no_voice", 0.14)
        audio_parts.append(f"[{music_idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume={mv},"
                           f"afade=t=in:st=0:d=1.5,afade=t=out:st={max(0.0, total - 2.0):.3f}:d=2[music]")
        audio_labels.append("[music]")
    if audio_labels:
        if len(audio_labels) == 2:
            audio_parts.append("[voice][music]amix=inputs=2:duration=first:normalize=0[amixed]")
            last = "[amixed]"
        else:
            last = audio_labels[0]
        audio_parts.append(f"{last}atrim=0:{total:.3f},asetpts=N/SR/TB[aout]")
    else:
        audio_parts.append(f"[{silent_idx}:a]atrim=0:{total:.3f}[aout]")
    filter_complex = vf + ";" + ";".join(audio_parts)
    cmd += ["-filter_complex", filter_complex, "-map", "[vout]", "-map", "[aout]",
            "-t", f"{total:.3f}", "-r", str(fps),
            "-c:v", "libx264", "-preset", str(ctx.cfg("video.preset", "medium")),
            "-crf", str(ctx.cfg("video.crf", 21)), "-pix_fmt", "yuv420p", "-profile:v", "high",
            "-c:a", "aac", "-b:a", str(ctx.cfg("video.audio_bitrate", "160k")), "-ar", "48000",
            "-movflags", "+faststart", str(out_file)]
    return cmd


# ---------------------------------------------------------------- dựng
def render_video(ctx: Context, content: dict, work_dir: Path, *, voice: Path | None, timeline: dict,
                 font_path: Path | None, exclude_backgrounds: set[str] | None = None) -> dict:
    if not ffmpeg_bin():
        raise RenderError("Không tìm thấy ffmpeg. Cài FFmpeg hoặc đặt FFMPEG_BIN trong .env")
    if not (work_dir / "subtitles.ass").exists():
        raise RenderError("Thiếu subtitles.ass – hãy chạy bước sinh phụ đề trước")
    tpl = ctx.templates.get(content["template"])
    if not tpl:
        raise RenderError(f"Không có mẫu video '{content['template']}' trong config/video_template.yaml")
    background = choose_background(ctx, content, exclude_backgrounds)
    music = choose_music(ctx, content)
    overlay_info = make_overlay(ctx, content, work_dir / "overlay.png", font_path)
    fonts_dir = work_dir / "fonts"
    if font_path:
        fonts_dir.mkdir(exist_ok=True)
        shutil.copy2(font_path, fonts_dir / font_path.name)
    out_dir = ctx.path("output", "videos", content["run_id"])
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{content['file_stem']}.mp4"
    tmp_file = out_dir / f"{content['file_stem']}.partial.mp4"
    cmd = build_ffmpeg_cmd(ctx, background=background, music=music, voice=voice, total=timeline["total"],
                           head=timeline["head"], template=tpl, has_fonts_dir=bool(font_path), out_file=tmp_file)
    t0 = time.time()
    res = run_cmd(cmd, cwd=work_dir, timeout=1800)
    elapsed = time.time() - t0
    if res.returncode != 0 or not tmp_file.exists():
        tmp_file.unlink(missing_ok=True)
        raise RenderError(f"FFmpeg lỗi (mã {res.returncode}): {res.stderr.strip()[-600:]}")
    tmp_file.replace(out_file)  # chỉ đổi tên khi đã dựng xong -> không để lại tệp hỏng
    srt_dir = ctx.path("output", "subtitles", content["run_id"])
    srt_dir.mkdir(parents=True, exist_ok=True)
    srt_out = srt_dir / f"{content['file_stem']}.srt"
    shutil.copy2(work_dir / "subtitles.srt", srt_out)
    meta = {
        "video_path": str(out_file.relative_to(ctx.root)),
        "srt_path": str(srt_out.relative_to(ctx.root)),
        "background": background.name if background else None,
        "background_placeholder": is_placeholder(background) if background else None,
        "music": music.name if music else None,
        "music_placeholder": is_placeholder(music) if music else None,
        "voice": voice.name if voice else None,
        "template": content["template"],
        "timeline": timeline,
        "overlay": overlay_info,
        "font": font_path.name if font_path else None,
        "render_seconds": round(elapsed, 1),
        "output_duration": media_duration(out_file),
        "ffmpeg_cmd": " ".join(cmd),
        "rendered_at": ctx.now_iso(),
    }
    write_json(work_dir / "render_meta.json", meta)
    return meta


def load_render_meta(work_dir: Path) -> dict:
    return read_json(work_dir / "render_meta.json", {})


def default_font(ctx: Context) -> Path | None:
    return find_font(ctx, "quote")


def font_family_name(font_path: Path | None) -> str:
    if not font_path:
        return "Sans"
    try:
        return ImageFont.truetype(str(font_path), 20).getname()[0]
    except OSError:
        return "Sans"
