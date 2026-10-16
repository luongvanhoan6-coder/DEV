"""Tích hợp TÙY CHỌN với Claude API để viết lại lời đọc/tiêu đề.

- Chỉ chạy khi content.provider = anthropic VÀ có ANTHROPIC_API_KEY (hoặc hồ sơ `ant auth login`).
- Tính phí theo token – xem `python main.py cost`.
- Câu nói gốc/bản dịch KHÔNG được thay đổi: nếu lời đọc trả về không chứa nguyên văn bản dịch,
  kết quả bị loại và hệ thống quay về mẫu có sẵn.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from .common import Context, normalize_for_compare, word_count

PROMPT_FILE = Path(__file__).resolve().parent.parent / "templates" / "prompts" / "content_rewrite_system.md"


def load_system_prompt(ctx: Context) -> str:
    path = ctx.path("templates", "prompts", "content_rewrite_system.md")
    if not path.exists():
        path = PROMPT_FILE
    text = path.read_text(encoding="utf-8")
    return re.sub(r"^<!--.*?-->\n", "", text, flags=re.S)


class LLMUnavailable(RuntimeError):
    pass


def is_configured() -> bool:
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return True


def rewrite_content(ctx: Context, quote: dict) -> dict:
    """Gọi Claude để đề xuất lời đọc. Trả về dict hoặc raise LLMUnavailable."""
    if not is_configured():
        raise LLMUnavailable("Chưa cài gói 'anthropic' hoặc chưa đặt ANTHROPIC_API_KEY trong .env")
    import anthropic

    cfg = ctx.cfg("content.anthropic", {}) or {}
    model = os.environ.get(cfg.get("model_env", "ANTHROPIC_MODEL")) or cfg.get("default_model", "claude-opus-5-5")
    system = load_system_prompt(ctx).format(
        min_w=ctx.cfg("content.voice_script_min_words", 35),
        max_w=ctx.cfg("content.voice_script_max_words", 75),
        title_max=ctx.cfg("content.title_max_chars", 90),
    )
    payload = {k: quote.get(k, "") for k in (
        "original_quote", "translation_vi", "author", "source_title", "source_reference",
        "source_status", "interpretation", "topic")}
    client = anthropic.Anthropic()
    try:
        response = client.beta.messages.create(
            model=model,
            max_tokens=int(cfg.get("max_tokens", 2000)),
            system=system,
            output_config={"effort": cfg.get("effort", "medium")},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
    except anthropic.RateLimitError as exc:
        raise LLMUnavailable(f"Claude API giới hạn tốc độ: {exc.__class__.__name__}") from exc
    except anthropic.APIStatusError as exc:
        raise LLMUnavailable(f"Claude API lỗi HTTP {exc.status_code}") from exc
    except anthropic.APIConnectionError as exc:
        raise LLMUnavailable("Không kết nối được Claude API") from exc

    if response.stop_reason == "refusal":
        raise LLMUnavailable("Claude từ chối yêu cầu này")
    text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise LLMUnavailable("Phản hồi không có JSON")
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise LLMUnavailable("JSON không hợp lệ") from exc

    script = (data.get("voice_script") or "").strip()
    translation = quote.get("translation_vi") or quote.get("original_quote") or ""
    if normalize_for_compare(translation) not in normalize_for_compare(script):
        raise LLMUnavailable("Lời đọc không giữ nguyên văn câu trích – đã loại bỏ")
    wc = word_count(script)
    if not (ctx.cfg("content.voice_script_min_words", 35) <= wc <= ctx.cfg("content.voice_script_max_words", 75) + 10):
        raise LLMUnavailable(f"Lời đọc dài {wc} từ, ngoài khoảng cho phép")
    usage = getattr(response, "usage", None)
    return {
        "voice_script": script,
        "title": (data.get("title") or "").strip(),
        "interpretation": (data.get("interpretation") or "").strip(),
        "model": getattr(response, "model", model),
        "input_tokens": getattr(usage, "input_tokens", None),
        "output_tokens": getattr(usage, "output_tokens", None),
    }
