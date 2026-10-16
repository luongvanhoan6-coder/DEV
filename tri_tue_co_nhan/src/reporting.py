"""Báo cáo sau mỗi lần chạy, vòng phản hồi (FEEDBACK_LOOP.md), ước tính chi phí và báo cáo Analytics."""
from __future__ import annotations

import os
import re
from collections import defaultdict
from pathlib import Path

from .common import ANALYTICS_FIELDS, Context, read_csv, read_json, write_csv
from .production_queue import load_queue

FEEDBACK_HEADER = """# VÒNG PHẢN HỒI SẢN XUẤT – TRÍ TUỆ CỔ NHÂN

Tệp này được cập nhật bằng `python main.py report`. Mỗi lần chạy có một mục riêng (theo run_id).
Mục **"Thay đổi đã thực hiện ở lần chạy tiếp theo"** do người vận hành điền tay – hệ thống sẽ giữ nguyên
nội dung bạn viết khi cập nhật lại báo cáo của cùng run_id.

Không ghi số liệu lượt xem/chi phí nếu chưa có dữ liệu thật.
"""


# ---------------------------------------------------------------- chi phí
def estimate_costs(ctx: Context, videos_per_day: int | None = None, chars_per_video: int | None = None) -> dict:
    vpd = videos_per_day or int(ctx.cfg("production.videos_per_day", 5))
    per_month = vpd * 30
    if chars_per_video is None:
        from .quote_manager import load_quotes
        scripts = [q["voice_script"] for q in load_quotes(ctx) if q.get("voice_script")]
        chars_per_video = int(sum(len(s) for s in scripts) / len(scripts)) if scripts else 350
    rate = float(ctx.cfg("costs.usd_to_vnd", 25500))
    items = []
    # Claude API
    model = os.environ.get("ANTHROPIC_MODEL") or ctx.cfg("content.anthropic.default_model", "claude-opus-5-5")
    prices = (ctx.cfg("costs.anthropic_price_per_mtok") or {}).get(model, [4.0, 20.0])
    tin, tout = ctx.cfg("costs.anthropic_est_tokens_per_video", [900, 1500])
    llm_usd = per_month * (tin * prices[0] + tout * prices[1]) / 1e6
    items.append({"item": f"Claude API ({model}) – viết lại lời đọc", "enabled": ctx.cfg("content.provider") == "anthropic",
                  "paid": True, "calls_per_month": per_month, "usd_month": round(llm_usd, 2),
                  "vnd_month": round(llm_usd * rate, -3),
                  "note": "Tùy chọn. Mặc định dùng CSV + mẫu (0 đ). Ước tính theo token trung bình."})
    # Google TTS
    g = ctx.cfg("costs.google_tts", {}) or {}
    chars = per_month * chars_per_video
    billable = max(0, chars - int(g.get("free_chars_per_month", 1_000_000)))
    tts_usd = billable * float(g.get("usd_per_million_chars", 16.0)) / 1e6
    items.append({"item": "Google Cloud TTS (Neural2/WaveNet)", "enabled": ctx.cfg("voice.provider") == "google_cloud",
                  "paid": True, "calls_per_month": per_month, "chars_per_month": chars,
                  "usd_month": round(tts_usd, 2), "vnd_month": round(tts_usd * rate, -3),
                  "note": "Nằm trong hạn mức miễn phí hằng tháng nếu số ký tự < hạn mức (cần tài khoản thanh toán Google Cloud)."})
    items.append({"item": "Gemini API TTS", "enabled": ctx.cfg("voice.provider") == "gemini", "paid": False,
                  "calls_per_month": per_month, "usd_month": 0, "vnd_month": 0,
                  "note": "Gói miễn phí của Google AI Studio (giới hạn lượt/phút, lượt/ngày). Nếu chuyển gói trả phí: "
                          "tính theo token, xem https://ai.google.dev/pricing – chưa đưa vào ước tính."})
    items.append({"item": "edge-tts", "enabled": ctx.cfg("voice.provider") == "edge_tts", "paid": False,
                  "usd_month": 0, "vnd_month": 0, "note": "Miễn phí nhưng không chính thức – có thể ngừng hoạt động bất kỳ lúc nào."})
    items.append({"item": "FFmpeg, Python, Pillow (dựng video)", "enabled": True, "paid": False, "usd_month": 0,
                  "vnd_month": 0, "note": "Mã nguồn mở, chạy trên máy của bạn."})
    items.append({"item": "Đăng bài thủ công / công cụ lên lịch chính thức", "enabled": True, "paid": False,
                  "usd_month": 0, "vnd_month": 0, "note": "Meta Business Suite, TikTok Studio, YouTube Studio: miễn phí."})
    enabled_vnd = sum(i["vnd_month"] for i in items if i["enabled"])
    max_vnd = sum(i["vnd_month"] for i in items)
    return {"videos_per_day": vpd, "videos_per_month": per_month, "avg_chars_per_video": chars_per_video,
            "items": items, "current_config_vnd_month": enabled_vnd, "all_paid_options_vnd_month": max_vnd,
            "budget_vnd_month": 500_000,
            "disclaimer": "Giá tham khảo trong config/settings.yaml – luôn kiểm tra bảng giá chính thức trước khi bật."}


def actual_llm_cost(ctx: Context, manifest: dict) -> float | None:
    usages = [v.get("llm_usage") for v in manifest.get("videos", {}).values() if v.get("llm_usage")]
    if not usages:
        return None
    total = 0.0
    for u in usages:
        prices = (ctx.cfg("costs.anthropic_price_per_mtok") or {}).get(u.get("model"), [4.0, 20.0])
        total += ((u.get("input_tokens") or 0) * prices[0] + (u.get("output_tokens") or 0) * prices[1]) / 1e6
    return total * float(ctx.cfg("costs.usd_to_vnd", 25500))


# ---------------------------------------------------------------- FEEDBACK_LOOP.md
def _improvements(manifest: dict) -> list[str]:
    tips: list[str] = []
    s = manifest.get("summary", {})
    if s.get("with_voice", 0) < s.get("quotes_processed", 0):
        tips.append("Cấu hình nhà cung cấp giọng đọc (voice.provider) – video chưa có giọng đọc không được duyệt.")
    assets = manifest.get("assets", {})
    for w in assets.get("warnings", []) + assets.get("errors", []):
        tips.append(w)
    for vid, v in manifest.get("videos", {}).items():
        for e in v.get("errors", []):
            tips.append(f"{vid}: {e}")
        for w in v.get("warnings", []):
            if "Thời lượng" in w:
                tips.append(f"{vid}: {w}")
    seen, out = set(), []
    for t in tips:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out or ["Không phát hiện vấn đề tự động. Hãy xem lại video thủ công và ghi nhận xét."]


def feedback_entry(ctx: Context, manifest: dict, manual_notes: str) -> str:
    s = manifest.get("summary", {})
    failed = {vid: v.get("errors", []) + (v.get("qc", {}).get("errors", []) if v.get("qc") else [])
              for vid, v in manifest.get("videos", {}).items()}
    failed = {k: v for k, v in failed.items() if v}
    cost = actual_llm_cost(ctx, manifest)
    paid_used = ctx.cfg("voice.provider") == "google_cloud" or manifest.get("settings_snapshot", {}).get("content_provider") == "anthropic"
    cost_line = (f"{cost:,.0f} đ (Claude API, theo token thực tế)" if cost is not None
                 else ("Có dùng dịch vụ tính phí – xem hóa đơn của nhà cung cấp" if paid_used
                       else "0 đ – không dùng dịch vụ tính phí"))
    lines = [
        f"<!-- RUN:{manifest['run_id']}:START -->",
        f"## {manifest.get('created_at', '')[:10]} – {manifest['run_id']}", "",
        "| Chỉ số | Giá trị |", "|---|---|",
        f"| Ngày chạy | {manifest.get('created_at', '')} |",
        f"| Run ID | `{manifest['run_id']}` (số lần chạy: {manifest.get('attempts', 1)}) |",
        f"| Số câu đã xử lý | {s.get('quotes_processed', 0)} |",
        f"| Video thành công (qua QC) | {s.get('videos_succeeded', 0)} |",
        f"| Video lỗi | {s.get('videos_failed', 0)} |",
        f"| Video có giọng đọc | {s.get('with_voice', 0)} |",
        f"| Thời gian xử lý | {s.get('total_seconds', 0)} giây |",
        f"| Chi phí ước tính | {cost_line} |",
        f"| Giọng đọc / Nội dung | {manifest.get('settings_snapshot', {}).get('voice_provider')} / "
        f"{manifest.get('settings_snapshot', {}).get('content_provider')} |", "",
        "**Nguyên nhân lỗi:**", "",
    ]
    lines += [f"- {vid}: {'; '.join(errs)}" for vid, errs in failed.items()] or ["- Không có"]
    lines += ["", "**Điểm cần cải thiện (tự động):**", ""]
    lines += [f"- {t}" for t in _improvements(manifest)]
    lines += ["", "**Thay đổi đã thực hiện ở lần chạy tiếp theo:**", "<!-- MANUAL:START -->",
              manual_notes.strip() or "- _(người vận hành ghi tại đây)_", "<!-- MANUAL:END -->",
              f"<!-- RUN:{manifest['run_id']}:END -->", ""]
    return "\n".join(lines)


def update_feedback_loop(ctx: Context, manifest: dict) -> Path:
    path = ctx.path("reports", "FEEDBACK_LOOP.md")
    text = path.read_text(encoding="utf-8") if path.exists() else FEEDBACK_HEADER
    rid = re.escape(manifest["run_id"])
    pattern = re.compile(rf"<!-- RUN:{rid}:START -->.*?<!-- RUN:{rid}:END -->\n?", re.S)
    manual = ""
    m = pattern.search(text)
    if m:
        mm = re.search(r"<!-- MANUAL:START -->\n(.*?)\n<!-- MANUAL:END -->", m.group(0), re.S)
        if mm and "người vận hành ghi tại đây" not in mm.group(1):
            manual = mm.group(1)
        text = pattern.sub(lambda _: feedback_entry(ctx, manifest, manual), text)
    else:
        text = text.rstrip() + "\n\n" + feedback_entry(ctx, manifest, manual)
    path.write_text(text, encoding="utf-8")
    return path


def run_report(ctx: Context, run_id: str) -> dict:
    manifest = read_json(ctx.path("reports", "runs", f"{run_id}.json"), None)
    if not manifest:
        raise FileNotFoundError(f"Không có manifest cho {run_id}")
    from .pipeline import summarize
    summarize(ctx, manifest)
    update_feedback_loop(ctx, manifest)
    return manifest


# ---------------------------------------------------------------- Analytics
def analytics_path(ctx: Context) -> Path:
    return ctx.path("data", "analytics.csv")


def import_analytics(ctx: Context, src: Path) -> int:
    rows = read_csv(Path(src))
    missing = [f for f in ("video_id", "platform", "views") if rows and f not in rows[0]]
    if missing:
        raise ValueError(f"Tệp analytics thiếu cột: {', '.join(missing)}")
    existing = read_csv(analytics_path(ctx))
    keys = {(r["date"], r["video_id"], r["platform"]) for r in existing}
    added = 0
    for r in rows:
        k = (r.get("date", ""), r["video_id"], r["platform"])
        if k in keys:
            continue
        existing.append(r)
        keys.add(k)
        added += 1
    write_csv(analytics_path(ctx), existing, ANALYTICS_FIELDS)
    return added


def _num(v) -> float:
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


def analytics_report(ctx: Context) -> Path | None:
    data = [r for r in read_csv(analytics_path(ctx)) if r.get("video_id")]
    if not data:
        return None
    queue = {r["video_id"]: r for r in load_queue(ctx)}
    groups: dict[str, dict[str, list]] = {"Chủ đề": defaultdict(list), "Nền tảng": defaultdict(list),
                                          "Thời lượng": defaultdict(list)}
    for r in data:
        q = queue.get(r["video_id"], {})
        dur = _num(q.get("duration_sec"))
        bucket = "chưa rõ" if not dur else ("15–20s" if dur < 20 else "20–25s" if dur < 25 else "25–30s+")
        groups["Chủ đề"][q.get("topic") or "chưa rõ"].append(r)
        groups["Nền tảng"][r["platform"]].append(r)
        groups["Thời lượng"][bucket].append(r)
    lines = ["# Báo cáo hiệu quả (từ dữ liệu Analytics đã nhập)", "", f"Số dòng dữ liệu: {len(data)}", ""]
    for gname, g in groups.items():
        lines += [f"## Theo {gname.lower()}", "", "| Nhóm | Số video | Tổng lượt xem | TB lượt xem | TB thời gian xem (s) | Tương tác/1000 view |",
                  "|---|---|---|---|---|---|"]
        for key, rows in sorted(g.items(), key=lambda kv: -sum(_num(r["views"]) for r in kv[1])):
            views = sum(_num(r["views"]) for r in rows)
            avd = [_num(r.get("avg_view_duration_sec")) for r in rows if r.get("avg_view_duration_sec")]
            eng = sum(_num(r.get("likes")) + _num(r.get("comments")) + _num(r.get("shares")) for r in rows)
            lines.append(f"| {key} | {len({r['video_id'] for r in rows})} | {views:,.0f} | {views / len(rows):,.0f} | "
                         f"{(sum(avd) / len(avd)) if avd else 0:.1f} | {(eng / views * 1000) if views else 0:.1f} |")
        lines.append("")
    out = ctx.path("reports", f"analytics_report_{ctx.now().strftime('%Y%m%d')}.md")
    out.write_text("\n".join(lines), encoding="utf-8")
    return out
