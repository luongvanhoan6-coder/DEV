"""Sinh metadata: tiêu đề, mô tả, hashtag, dòng ghi nguồn, tên tệp, chú thích theo nền tảng."""
from __future__ import annotations

import re

from .common import TOPICS, slugify

COMMON_HASHTAGS = ["#tritueconhan", "#tuduyanlac", "#trietlyphuongdong", "#loihaynguoixua"]
TOPIC_HASHTAGS = {
    "A": ["#buongbo", "#annhien", "#binhan"],
    "B": ["#vothuong", "#nhansinh", "#suyngam"],
    "C": ["#nhanqua", "#tubi", "#songtute"],
    "D": ["#doinhanxuthe", "#baihoccuocsong", "#ungxu"],
    "E": ["#bietdu", "#songgiandi", "#hanhphuc"],
    "F": ["#tuthan", "#kyluat", "#renluyenbanthan"],
    "G": ["#giadinh", "#tinhnguoi", "#hieuthao"],
    "H": ["#thanhcong", "#danhloi", "#songtudo"],
}
STATUS_LABELS = {
    "VERIFIED": "Nguồn đã đối chiếu",
    "SOURCE_CITED": "Có dẫn nguồn",
    "TRADITIONAL": "Lưu truyền dân gian",
    "PARAPHRASE": "Diễn ý, không phải nguyên văn",
    "NEEDS_VERIFICATION": "CHƯA XÁC MINH NGUỒN",
}


def attribution_line(q: dict) -> str:
    """Dòng ghi nguồn ngắn gọn, trung thực – hiển thị trên video và trong mô tả."""
    author = (q.get("author") or "").strip()
    title = (q.get("source_title") or "").strip()
    ref = (q.get("source_reference") or "").strip()
    status = q.get("source_status", "")
    if status == "TRADITIONAL":
        base = author or "Lưu truyền dân gian"
        return f"{base} – {title}" if title and title not in base else base
    parts = []
    if author:
        parts.append(author)
    if title and title != author:
        parts.append(title)
    line = " – ".join(parts) if parts else "Chưa rõ nguồn"
    if ref and status in ("VERIFIED", "SOURCE_CITED", "PARAPHRASE"):
        line += f", {ref}"
    if status == "PARAPHRASE":
        line += " (diễn ý)"
    return line


def short_attribution(q: dict) -> str:
    """Bản rút gọn để hiển thị trên video (không kèm chương)."""
    author = (q.get("author") or "").strip()
    title = (q.get("source_title") or "").strip()
    author = re.sub(r"\s*\(.*?\)", "", author).strip()
    if q.get("source_status") == "TRADITIONAL":
        return author or "Lưu truyền"
    title_short = re.sub(r"\s*\(.*?\)", "", title).strip()
    if not author or author.lower() in title_short.lower():
        return title_short or author
    if title_short and title_short.lower() not in author.lower():
        return f"{author} · {title_short}"
    return author


def build_hashtags(topic: str, platform_extra: list[str] | None = None, limit: int = 10) -> list[str]:
    tags = TOPIC_HASHTAGS.get(topic, [])[:3] + COMMON_HASHTAGS + list(platform_extra or [])
    out: list[str] = []
    for t in tags:
        if t not in out:
            out.append(t)
    return out[:limit]


def build_title(q: dict, max_chars: int = 90) -> str:
    title = (q.get("title") or "").strip()
    if not title:
        base = q.get("translation_vi") or q.get("original_quote") or ""
        title = base.split(".")[0].split(";")[0].strip()
    if len(title) > max_chars:
        title = title[: max_chars - 1].rsplit(" ", 1)[0] + "…"
    return title


def build_description(q: dict, interpretation: str, hashtags: list[str]) -> str:
    if (q.get("description") or "").strip():
        desc = q["description"].strip()
        if not any(h in desc for h in hashtags):
            desc += "\n\n" + " ".join(hashtags)
        return desc
    quote_text = q.get("translation_vi") or q.get("original_quote")
    lines = [f"“{quote_text}”", "", f"— {attribution_line(q)}"]
    original = (q.get("original_quote") or "").strip()
    if original and original != quote_text:
        lines += ["", f"Nguyên văn: {original.replace(' / ', ' ')}"]
    if interpretation:
        lines += ["", interpretation]
    lines += ["", f"Ghi chú nguồn: {STATUS_LABELS.get(q.get('source_status', ''), '')}."
              " Lời dịch/diễn ý trong video do kênh biên soạn."]
    lines += ["", " ".join(hashtags)]
    return "\n".join(lines)


def file_stem(date_str: str, seq: int, quote_id: str, title: str) -> str:
    return f"{date_str}_{seq:02d}_{quote_id}_{slugify(title, 36)}"


def platform_caption(meta: dict, platform: str, pconf: dict) -> dict:
    """Tạo tiêu đề + chú thích theo giới hạn của từng nền tảng."""
    tags = build_hashtags(meta["topic"], pconf.get("extra_hashtags"), pconf.get("max_hashtags", 8))
    title = meta["title"]
    title_max = pconf.get("title_max", 0)
    if title_max and len(title) > title_max:
        title = title[: title_max - 1] + "…"
    body = meta["description"]
    # bỏ dòng hashtag gốc rồi gắn hashtag theo nền tảng
    body_lines = [ln for ln in body.splitlines() if not ln.strip().startswith("#")]
    body = "\n".join(body_lines).rstrip()
    if platform == "tiktok":
        caption = f"{meta['title']}\n\n“{meta['quote_display']}”\n— {meta['attribution_short']}\n\n{' '.join(tags)}"
    elif platform == "facebook_reels":
        caption = f"{meta['title']}\n\n{body}\n\n{' '.join(tags)}"
    else:  # youtube_shorts
        caption = f"{body}\n\n{' '.join(tags)}"
    cmax = pconf.get("caption_max", 2200)
    if len(caption) > cmax:
        caption = caption[: cmax - 1] + "…"
    return {"title": title if title_max else "", "caption": caption, "hashtags": tags}


def topic_name(topic: str) -> str:
    return TOPICS.get(topic, topic)
