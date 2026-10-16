"""Sinh và kiểm tra phụ đề SRT (và ASS có định dạng để in lên video) – hỗ trợ tiếng Việt có dấu."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .common import Context, hex_to_rgb, word_count

TIME_RE = re.compile(r"^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$")


@dataclass
class Cue:
    start: float
    end: float
    text: str  # có thể chứa "\n"


# ---------------------------------------------------------------- thời lượng
def estimate_speech_duration(ctx: Context, script: str) -> float:
    wps = float(ctx.cfg("voice.words_per_second", 2.4))
    sentences = len(split_sentences(script))
    return word_count(script) / wps + max(0, sentences - 1) * float(ctx.cfg("subtitles.sentence_pause_sec", 0.35))


def compute_timeline(ctx: Context, speech_duration: float) -> dict:
    """Tính đệm đầu/cuối và tổng thời lượng video trong khoảng [min, max]."""
    head = float(ctx.cfg("video.head_padding_sec", 1.2))
    tail = float(ctx.cfg("video.tail_padding_sec", 1.8))
    vmin = float(ctx.cfg("video.min_duration_sec", 15))
    vmax = float(ctx.cfg("video.max_duration_sec", 30))
    total = head + speech_duration + tail
    if total < vmin:
        tail += vmin - total
    elif total > vmax:
        over = total - vmax
        cut_tail = min(over, max(0.0, tail - 0.8))
        tail -= cut_tail
        over -= cut_tail
        cut_head = min(over, max(0.0, head - 0.5))
        head -= cut_head
    total = head + speech_duration + tail
    return {"head": round(head, 3), "speech": round(speech_duration, 3), "tail": round(tail, 3),
            "total": round(total, 3), "within_limits": vmin - 0.01 <= total <= vmax + 0.01}


# ---------------------------------------------------------------- chia câu
def split_sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text or "").strip()
    return [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text) if s.strip()]


def _wrap_two_lines(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    words = text.split()
    best, best_score = text, 10 ** 9
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        score = max(len(a), len(b)) * 2 + abs(len(a) - len(b)) + (0 if a.endswith((",", ";", ":")) else 3)
        if score < best_score:
            best, best_score = f"{a}\n{b}", score
    return best


def split_into_chunks(text: str, max_chars_per_line: int = 26, max_lines: int = 2) -> list[tuple[str, bool]]:
    """Chia lời đọc thành các đoạn phụ đề. Trả về [(đoạn, kết_thúc_câu)]."""
    limit = max_chars_per_line * max_lines
    chunks: list[tuple[str, bool]] = []
    for sentence in split_sentences(text):
        clauses = [c.strip() for c in re.split(r"(?<=[,;:])\s+", sentence) if c.strip()]
        buf = ""
        pieces: list[str] = []
        for clause in clauses:
            candidate = f"{buf} {clause}".strip()
            if len(candidate) <= limit:
                buf = candidate
                continue
            if buf:
                pieces.append(buf)
            if len(clause) <= limit:
                buf = clause
            else:  # mệnh đề quá dài -> cắt theo từ
                words, buf = clause.split(), ""
                for w in words:
                    cand = f"{buf} {w}".strip()
                    if len(cand) > limit and buf:
                        pieces.append(buf)
                        buf = w
                    else:
                        buf = cand
        if buf:
            pieces.append(buf)
        # Tránh đoạn cuối quá ngắn (vd. chỉ còn một chữ): gộp với đoạn trước rồi chia đôi cân bằng.
        if len(pieces) > 1 and len(pieces[-1]) < 16:
            words = f"{pieces[-2]} {pieces[-1]}".split()
            best = min(range(1, len(words)), key=lambda i: abs(len(" ".join(words[:i])) - len(" ".join(words[i:]))))
            pieces[-2:] = [" ".join(words[:best]), " ".join(words[best:])]
        for j, p in enumerate(pieces):
            chunks.append((p, j == len(pieces) - 1))
    return chunks


# ---------------------------------------------------------------- căn thời gian
def build_cues(ctx: Context, script: str, speech_duration: float, offset: float,
               sentence_timings: list[dict] | None = None) -> list[Cue]:
    max_chars = int(ctx.cfg("subtitles.max_chars_per_line", 26))
    max_lines = int(ctx.cfg("subtitles.max_lines_per_cue", 2))
    pause = float(ctx.cfg("subtitles.sentence_pause_sec", 0.35))
    min_cue = float(ctx.cfg("subtitles.min_cue_duration_sec", 0.9))
    chunks = split_into_chunks(script, max_chars, max_lines)
    if not chunks:
        return []
    sentences = split_sentences(script)

    spans: list[tuple[float, float]] | None = None
    if sentence_timings and len(sentence_timings) == len(sentences):
        spans = [(t["start"], t["end"]) for t in sentence_timings]

    cues: list[Cue] = []
    if spans:
        # Căn theo mốc câu do TTS trả về (đồng bộ tốt hơn), chia đều theo số ký tự trong câu.
        idx = 0
        for s_i, (s_start, s_end) in enumerate(spans):
            group = []
            while idx < len(chunks):
                group.append(chunks[idx][0])
                idx += 1
                if chunks[idx - 1][1]:
                    break
            total_chars = sum(len(g) for g in group) or 1
            t = s_start
            for g in group:
                d = (s_end - s_start) * len(g) / total_chars
                cues.append(Cue(offset + t, offset + t + d, g))
                t += d
    else:
        weights = [len(c) + (pause * 12 if end else 0) for c, end in chunks]
        total_w = sum(weights)
        t = 0.0
        for (text, end), w in zip(chunks, weights):
            d = speech_duration * w / total_w
            shown = d - (pause * 0.6 if end else 0.0)
            cues.append(Cue(offset + t, offset + t + max(shown, min(min_cue, d)), text))
            t += d
    for c in cues:
        c.text = _wrap_two_lines(c.text, max_chars)
    # đảm bảo tăng dần, không chồng lấn
    for i in range(1, len(cues)):
        if cues[i].start < cues[i - 1].end:
            cues[i - 1].end = cues[i].start
    return cues


# ---------------------------------------------------------------- SRT / ASS
def fmt_srt_time(sec: float) -> str:
    ms = int(round(max(0.0, sec) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def to_srt(cues: list[Cue]) -> str:
    blocks = [f"{i}\n{fmt_srt_time(c.start)} --> {fmt_srt_time(c.end)}\n{c.text}" for i, c in enumerate(cues, 1)]
    return "\n\n".join(blocks) + "\n"


def write_srt(path: Path, cues: list[Cue]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(to_srt(cues), encoding="utf-8")


def _ass_color(hex_color: str, alpha: int = 0) -> str:
    r, g, b = hex_to_rgb(hex_color)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"


def _ass_time(sec: float) -> str:
    cs = int(round(max(0.0, sec) * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def to_ass(cues: list[Cue], style: dict, font_name: str, width: int, height: int) -> str:
    fade = "{\\fad(180,180)}"
    header = (
        "[Script Info]\nScriptType: v4.00+\nWrapStyle: 2\nScaledBorderAndShadow: yes\n"
        f"PlayResX: {width}\nPlayResY: {height}\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Sub,{font_name},{style.get('font_size', 60)},{_ass_color(style.get('color', '#FFFFFF'))},"
        f"&H000000FF,{_ass_color(style.get('outline_color', '#000000'))},&H80000000,"
        f"-1,0,0,0,100,100,0,0,1,{style.get('outline', 4)},2,2,90,90,{style.get('margin_bottom', 320)},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines = []
    for c in cues:
        text = c.text.replace("\n", "\\N")
        lines.append(f"Dialogue: 0,{_ass_time(c.start)},{_ass_time(c.end)},Sub,,0,0,0,,{fade}{text}")
    return header + "\n".join(lines) + "\n"


# ---------------------------------------------------------------- kiểm tra SRT
def parse_srt_time(h, m, s, ms) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def validate_srt(path: Path, video_duration: float | None = None, tolerance: float = 0.5) -> tuple[list[Cue], list[str]]:
    """Trả về (cues, lỗi). Không có lỗi = SRT hợp lệ."""
    errors: list[str] = []
    try:
        raw = Path(path).read_bytes().decode("utf-8-sig")
    except FileNotFoundError:
        return [], ["Không tìm thấy tệp SRT"]
    except UnicodeDecodeError:
        return [], ["SRT không phải UTF-8 (tiếng Việt có thể bị lỗi font)"]
    blocks = [b for b in re.split(r"\r?\n\r?\n+", raw.strip()) if b.strip()]
    if not blocks:
        return [], ["SRT rỗng"]
    cues: list[Cue] = []
    for n, block in enumerate(blocks, 1):
        lines = block.splitlines()
        if len(lines) < 3:
            errors.append(f"Khối {n}: thiếu dòng (cần số thứ tự, thời gian, nội dung)")
            continue
        if lines[0].strip() != str(n):
            errors.append(f"Khối {n}: số thứ tự sai ('{lines[0].strip()}')")
        m = TIME_RE.match(lines[1].strip())
        if not m:
            errors.append(f"Khối {n}: định dạng thời gian sai ('{lines[1].strip()}')")
            continue
        g = m.groups()
        start, end = parse_srt_time(*g[:4]), parse_srt_time(*g[4:])
        text = "\n".join(lines[2:]).strip()
        if end <= start:
            errors.append(f"Khối {n}: thời gian kết thúc không sau thời gian bắt đầu")
        if not text:
            errors.append(f"Khối {n}: nội dung rỗng")
        if cues and start < cues[-1].end - 0.001:
            errors.append(f"Khối {n}: chồng lấn với khối trước")
        cues.append(Cue(start, end, text))
    if video_duration is not None and cues and cues[-1].end > video_duration + tolerance:
        errors.append(f"Phụ đề kết thúc ({cues[-1].end:.2f}s) sau khi video kết thúc ({video_duration:.2f}s)")
    return cues, errors


def generate_subtitles(ctx: Context, content: dict, out_dir: Path, speech_duration: float,
                       offset: float, sentence_timings: list[dict] | None, font_name: str) -> dict:
    cues = build_cues(ctx, content["voice_script"], speech_duration, offset, sentence_timings)
    srt_path = out_dir / "subtitles.srt"
    write_srt(srt_path, cues)
    style = (ctx.templates.get(content["template"]) or {}).get("subtitle", {})
    ass_path = out_dir / "subtitles.ass"
    ass_path.write_text(to_ass(cues, style, font_name, int(ctx.cfg("video.width", 1080)),
                               int(ctx.cfg("video.height", 1920))), encoding="utf-8")
    return {"srt": srt_path, "ass": ass_path, "cues": len(cues),
            "timing_source": "sentence_boundaries" if sentence_timings and len(sentence_timings) == len(split_sentences(content["voice_script"])) else "proportional"}
