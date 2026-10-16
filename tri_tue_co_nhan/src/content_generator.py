"""Bộ sinh nội dung cho một câu nói hoặc một lô (mặc định 5 câu/ngày)."""
from __future__ import annotations

import hashlib

from . import llm_client, quote_manager, voice_generator
from .common import Context, word_count
from .metadata_generator import (
    STATUS_LABELS, attribution_line, build_description, build_hashtags, build_title, file_stem,
    short_attribution, topic_name,
)
from .production_queue import draft_dir, load_queue, save_content, upsert

HOOKS = {
    "A": ["Có những điều, càng nắm chặt càng đau.", "Bình an không ở đâu xa."],
    "B": ["Đời người ngắn hơn ta tưởng.", "Mọi thứ rồi sẽ đổi thay."],
    "C": ["Gieo gì, rồi sẽ gặt nấy.", "Lòng tử tế chưa bao giờ là vô ích."],
    "D": ["Cách ta đối xử với người, cũng là cách ta sống.", "Một lời nói có thể giữ hoặc mất một mối quan hệ."],
    "E": ["Ta cần ít hơn ta nghĩ.", "Hạnh phúc đôi khi chỉ là biết đủ."],
    "F": ["Thay đổi lớn bắt đầu từ việc nhỏ.", "Người mạnh nhất là người thắng được chính mình."],
    "G": ["Gia đình là nơi ta học yêu thương đầu tiên.", "Có những ân tình cả đời không trả hết."],
    "H": ["Thành công thật sự không chỉ là danh và lợi.", "Đi nhanh chưa chắc đã đến đích."],
}
CLOSINGS = {
    "A": "Buông bớt một chút, lòng sẽ nhẹ đi nhiều.",
    "B": "Hãy sống trọn vẹn từng ngày đang có.",
    "C": "Gieo điều tử tế, rồi để thời gian trả lời.",
    "D": "Đối đãi chân thành, lòng người sẽ tự hiểu.",
    "E": "Biết đủ, lòng mới thôi chạy theo.",
    "F": "Mỗi ngày tiến một bước nhỏ là đủ.",
    "G": "Hãy thương nhau khi còn có thể.",
    "H": "Giữ lấy chính mình trên mọi con đường.",
}


def _pick(options: list[str], key: str) -> str:
    idx = int(hashlib.md5(key.encode("utf-8")).hexdigest(), 16) % len(options)
    return options[idx]


def template_voice_script(q: dict) -> str:
    """Lời đọc dựng từ mẫu khi CSV chưa có voice_script. Lời dẫn trung tính, không tự gán tác giả."""
    topic = q.get("topic", "A")
    quote_text = (q.get("translation_vi") or q.get("original_quote") or "").strip().rstrip(".")
    status = q.get("source_status")
    if status == "TRADITIONAL":
        intro = "Người xưa có câu"
    elif status == "PARAPHRASE":
        intro = "Người xưa từng dạy, đại ý rằng"
    elif q.get("source_title"):
        intro = f"Trong {q['source_title'].split('(')[0].strip()} có câu"
    else:
        intro = "Có câu nói rằng"
    parts = [_pick(HOOKS.get(topic, HOOKS["A"]), q.get("quote_id", "")),
             f"{intro}: {quote_text}."]
    if q.get("interpretation"):
        parts.append(q["interpretation"].strip().rstrip(".") + ".")
    parts.append(CLOSINGS.get(topic, ""))
    return " ".join(p for p in parts if p)


def build_content(ctx: Context, q: dict, run_id: str, seq: int, template: str,
                  use_llm: bool = False) -> dict:
    provider = "csv" if (q.get("voice_script") or "").strip() else "template"
    voice_script = (q.get("voice_script") or "").strip() or template_voice_script(q)
    interpretation = (q.get("interpretation") or "").strip()
    title_src = dict(q)
    llm_info = None
    llm_error = None
    if use_llm:
        try:
            llm_info = llm_client.rewrite_content(ctx, q)
            voice_script = llm_info["voice_script"]
            interpretation = llm_info.get("interpretation") or interpretation
            if llm_info.get("title"):
                title_src["title"] = llm_info["title"]
            provider = "anthropic"
        except llm_client.LLMUnavailable as exc:
            llm_error = str(exc)
            ctx.logger.warning("LLM không dùng được cho %s: %s – dùng mẫu có sẵn", q["quote_id"], exc)
    title = build_title(title_src, ctx.cfg("content.title_max_chars", 90))
    hashtags = build_hashtags(q["topic"])
    date_str = ctx.now().strftime("%Y%m%d")
    video_id = f"{date_str}_{seq:02d}_{q['quote_id']}"
    content = {
        "video_id": video_id,
        "run_id": run_id,
        "seq": seq,
        "quote_id": q["quote_id"],
        "topic": q["topic"],
        "topic_name": topic_name(q["topic"]),
        "original_quote": q.get("original_quote", ""),
        "translation_vi": q.get("translation_vi", ""),
        "quote_display": (q.get("translation_vi") or q.get("original_quote") or "").strip(),
        "author": q.get("author", ""),
        "source_title": q.get("source_title", ""),
        "source_reference": q.get("source_reference", ""),
        "source_status": q.get("source_status", ""),
        "source_status_label": STATUS_LABELS.get(q.get("source_status", ""), ""),
        "attribution": attribution_line(q),
        "attribution_short": short_attribution(q),
        "notes": q.get("notes", ""),
        "interpretation": interpretation,
        "voice_script": voice_script,
        "voice_script_words": word_count(voice_script),
        "title": title,
        "description": build_description(q, interpretation, hashtags),
        "hashtags": hashtags,
        "background_keywords": [k.strip() for k in (q.get("background_keywords") or "").split(",") if k.strip()],
        "template": template,
        "voice_profile": voice_generator.default_profile(ctx, seq),
        "file_stem": file_stem(date_str, seq, q["quote_id"], title),
        "content_provider": provider,
        "llm": llm_info and {k: llm_info[k] for k in ("model", "input_tokens", "output_tokens")},
        "llm_error": llm_error,
        "created_at": ctx.now_iso(),
    }
    return content


def write_content_files(ctx: Context, content: dict) -> None:
    d = draft_dir(ctx, content["run_id"], content["video_id"])
    d.mkdir(parents=True, exist_ok=True)
    save_content(ctx, content)
    (d / "voice_script.txt").write_text(content["voice_script"] + "\n", encoding="utf-8")
    (d / "metadata.txt").write_text(
        f"TIÊU ĐỀ: {content['title']}\n\nMÔ TẢ:\n{content['description']}\n\n"
        f"HASHTAG: {' '.join(content['hashtags'])}\n\n"
        f"CÂU NÓI: {content['quote_display']}\nNGUYÊN VĂN: {content['original_quote']}\n"
        f"NGUỒN: {content['attribution']}\nTRẠNG THÁI NGUỒN: {content['source_status']} "
        f"({content['source_status_label']})\nÝ NGHĨA: {content['interpretation']}\n"
        f"TỪ KHÓA HÌNH NỀN: {', '.join(content['background_keywords'])}\n"
        f"MẪU VIDEO: {content['template']}\nTÊN TỆP: {content['file_stem']}.mp4\n",
        encoding="utf-8")


def generate_batch(ctx: Context, run_id: str, count: int = 5, allow_reuse: bool = False,
                   topic: str | None = None, quote_ids: list[str] | None = None,
                   use_llm: bool | None = None) -> list[dict]:
    """Chọn câu, giữ chỗ (RESERVED), tạo nội dung + tệp nháp. Trả về danh sách content."""
    allow_reuse = allow_reuse or bool(ctx.cfg("production.allow_reuse", False))
    if use_llm is None:
        use_llm = ctx.cfg("content.provider") == "anthropic"
    quotes = quote_manager.select_quotes(ctx, count, allow_reuse=allow_reuse, topic=topic, quote_ids=quote_ids)
    if not quotes:
        raise RuntimeError("Không còn câu nói đủ điều kiện (chưa dùng và đã có nguồn). "
                           "Hãy bổ sung kho: python main.py quotes import <file.csv>")
    rotation = ctx.cfg("video.template_rotation") or list(ctx.templates)
    existing = len(load_queue(ctx))
    quote_manager.set_usage(ctx, [q["quote_id"] for q in quotes], "RESERVED", run_id)
    results = []
    for i, q in enumerate(quotes, start=1):
        template = rotation[(existing + i - 1) % len(rotation)]
        content = build_content(ctx, q, run_id, i, template, use_llm=use_llm)
        write_content_files(ctx, content)
        upsert(ctx, {
            "video_id": content["video_id"], "run_id": run_id, "seq": i, "quote_id": q["quote_id"],
            "topic": q["topic"], "template": template, "status": "DRAFT", "has_voice": "no",
            "voice_provider": "", "duration_sec": "", "file_name": content["file_stem"] + ".mp4",
            "video_path": "", "srt_path": "", "qc_status": "", "error": "",
        })
        ctx.logger.info("[%s] Tạo nội dung %s (%s, %s)", run_id, content["video_id"], q["quote_id"], template)
        results.append(content)
    return results
