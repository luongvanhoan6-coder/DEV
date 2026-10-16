"""Quản lý kho câu nói: đọc/ghi CSV, kiểm tra trùng lặp, kiểm tra nguồn, chọn câu cho lô sản xuất."""
from __future__ import annotations

import difflib
import io
import os
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .common import (
    QUOTE_FIELDS, SOURCE_STATUSES, TOPIC_TARGETS, TOPICS, USAGE_STATUSES, Context,
    normalize_for_compare, read_csv, write_csv,
)

# Những danh xưng nhạy cảm: nếu xuất hiện trong tác giả thì bắt buộc phải có nguồn cụ thể.
SENSITIVE_AUTHORS = [
    "phat", "buddha", "khong tu", "confucius", "lao tu", "laozi", "trang tu", "manh tu",
    "thich nhat hanh", "dat lai lat ma", "dalai lama",
]
REQUIRED_FIELDS = ["quote_id", "topic", "original_quote", "author", "source_status"]
NEAR_DUP_THRESHOLD = 0.88


def quotes_path(ctx: Context) -> Path:
    return ctx.path("data", "quotes.csv")


def load_quotes(ctx: Context) -> list[dict]:
    rows = read_csv(quotes_path(ctx))
    for r in rows:
        for f in QUOTE_FIELDS:
            r.setdefault(f, "")
    return rows


def save_quotes(ctx: Context, rows: list[dict]) -> None:
    write_csv(quotes_path(ctx), rows, QUOTE_FIELDS)


# ---------------------------------------------------------------- trùng lặp
@dataclass
class DuplicateReport:
    exact: list[tuple[str, str]] = field(default_factory=list)   # (id1, id2)
    near: list[tuple[str, str, float]] = field(default_factory=list)
    duplicate_ids: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.exact and not self.duplicate_ids


def _compare_keys(row: dict) -> list[str]:
    keys = [normalize_for_compare(row.get("original_quote", ""))]
    tr = normalize_for_compare(row.get("translation_vi", ""))
    if tr and tr != keys[0]:
        keys.append(tr)
    return [k for k in keys if k]


def find_duplicates(rows: list[dict], near_threshold: float = NEAR_DUP_THRESHOLD) -> DuplicateReport:
    rep = DuplicateReport()
    ids = Counter(r.get("quote_id", "") for r in rows)
    rep.duplicate_ids = [i for i, c in ids.items() if i and c > 1]
    seen: dict[str, str] = {}
    keyed = []
    for r in rows:
        keys = _compare_keys(r)
        keyed.append((r.get("quote_id", ""), keys))
        for k in keys:
            if k in seen and seen[k] != r.get("quote_id"):
                rep.exact.append((seen[k], r.get("quote_id", "")))
            else:
                seen.setdefault(k, r.get("quote_id", ""))
    exact_pairs = {tuple(sorted(p)) for p in rep.exact}
    for i in range(len(keyed)):
        for j in range(i + 1, len(keyed)):
            id1, k1 = keyed[i]
            id2, k2 = keyed[j]
            if tuple(sorted((id1, id2))) in exact_pairs:
                continue
            best = 0.0
            for a in k1:
                for b in k2:
                    if abs(len(a) - len(b)) > max(len(a), len(b)) * 0.4:
                        continue
                    best = max(best, difflib.SequenceMatcher(None, a, b).ratio())
            if best >= near_threshold:
                rep.near.append((id1, id2, round(best, 3)))
    return rep


def is_duplicate_of(candidate: dict, rows: list[dict]) -> str | None:
    """Trả về quote_id bị trùng (khớp chính xác sau chuẩn hóa) hoặc None."""
    cand_keys = set(_compare_keys(candidate))
    for r in rows:
        if cand_keys & set(_compare_keys(r)):
            return r.get("quote_id")
    return None


# ---------------------------------------------------------------- kiểm tra nguồn
def check_source(row: dict, allowed: list[str] | None = None) -> list[str]:
    """Trả về danh sách vấn đề; rỗng = được phép đưa vào sản xuất."""
    problems: list[str] = []
    status = (row.get("source_status") or "").strip()
    allowed = allowed or ["VERIFIED", "SOURCE_CITED", "TRADITIONAL", "PARAPHRASE"]
    if status not in SOURCE_STATUSES:
        problems.append(f"source_status không hợp lệ: '{status}'")
    elif status == "NEEDS_VERIFICATION":
        problems.append("Nguồn chưa được xác minh (NEEDS_VERIFICATION)")
    elif status not in allowed:
        problems.append(f"Trạng thái nguồn '{status}' không nằm trong danh sách cho phép")
    for f in REQUIRED_FIELDS:
        if not (row.get(f) or "").strip():
            problems.append(f"Thiếu trường bắt buộc: {f}")
    if (row.get("topic") or "") not in TOPICS:
        problems.append(f"Chủ đề không hợp lệ: '{row.get('topic')}'")
    if status in ("VERIFIED", "SOURCE_CITED"):
        if not (row.get("source_title") or "").strip():
            problems.append("Có trạng thái trích dẫn nhưng thiếu source_title")
        if not (row.get("source_reference") or "").strip():
            problems.append("Có trạng thái trích dẫn nhưng thiếu source_reference")
    author_norm = normalize_for_compare(row.get("author", ""))
    if any(s in author_norm for s in SENSITIVE_AUTHORS) and status in ("TRADITIONAL", "PARAPHRASE"):
        if not (row.get("source_title") or "").strip():
            problems.append("Gán cho danh nhân/tôn giáo nhưng không có nguồn – cần xác minh")
    return problems


def source_report(ctx: Context, rows: list[dict] | None = None) -> dict[str, list[str]]:
    rows = rows if rows is not None else load_quotes(ctx)
    allowed = ctx.cfg("production.allowed_source_statuses")
    return {r["quote_id"]: p for r in rows if (p := check_source(r, allowed))}


# ---------------------------------------------------------------- thống kê
def stats(rows: list[dict]) -> dict:
    by_topic = Counter(r.get("topic") for r in rows)
    by_status = Counter(r.get("source_status") for r in rows)
    by_usage = Counter(r.get("usage_status") or "AVAILABLE" for r in rows)
    progress = {
        t: {"name": TOPICS[t], "have": by_topic.get(t, 0), "target": TOPIC_TARGETS[t]}
        for t in TOPICS
    }
    return {"total": len(rows), "target_total": sum(TOPIC_TARGETS.values()),
            "by_topic": progress, "by_source_status": dict(by_status), "by_usage": dict(by_usage)}


# ---------------------------------------------------------------- chọn câu
def is_producible(row: dict, ctx: Context, allow_reuse: bool = False) -> bool:
    usage = row.get("usage_status") or "AVAILABLE"
    if usage == "RETIRED":
        return False
    if usage != "AVAILABLE" and not allow_reuse:
        return False
    if usage == "RESERVED":
        return False
    return not check_source(row, ctx.cfg("production.allowed_source_statuses"))


def select_quotes(ctx: Context, count: int, allow_reuse: bool = False,
                  topic: str | None = None, quote_ids: list[str] | None = None) -> list[dict]:
    rows = load_quotes(ctx)
    if quote_ids:
        by_id = {r["quote_id"]: r for r in rows}
        missing = [q for q in quote_ids if q not in by_id]
        if missing:
            raise ValueError(f"Không tìm thấy quote_id: {', '.join(missing)}")
        chosen = [by_id[q] for q in quote_ids]
        blocked = [q["quote_id"] for q in chosen if not is_producible(q, ctx, allow_reuse)]
        if blocked:
            raise ValueError("Các câu sau không đủ điều kiện sản xuất (nguồn chưa xác minh hoặc đã dùng): "
                             + ", ".join(blocked))
        return chosen
    pool = [r for r in rows if is_producible(r, ctx, allow_reuse) and (not topic or r["topic"] == topic)]
    # Ưu tiên câu chưa dùng, sau đó xoay vòng chủ đề để một lô không trùng chủ đề.
    pool.sort(key=lambda r: (r.get("usage_status") != "AVAILABLE", r["quote_id"]))
    if not ctx.cfg("production.rotate_topics", True):
        return pool[:count]
    usage_by_topic = Counter(r["topic"] for r in rows if r.get("usage_status") in ("PRODUCED", "PUBLISHED"))
    buckets: dict[str, list[dict]] = {}
    for r in pool:
        buckets.setdefault(r["topic"], []).append(r)
    order = sorted(buckets, key=lambda t: (usage_by_topic.get(t, 0) / TOPIC_TARGETS.get(t, 1), t))
    chosen: list[dict] = []
    while len(chosen) < count and any(buckets.values()):
        for t in order:
            if buckets[t] and len(chosen) < count:
                chosen.append(buckets[t].pop(0))
    return chosen


def set_usage(ctx: Context, quote_ids: list[str], status: str, run_id: str = "") -> None:
    if status not in USAGE_STATUSES:
        raise ValueError(status)
    rows = load_quotes(ctx)
    ids = set(quote_ids)
    for r in rows:
        if r["quote_id"] in ids:
            r["usage_status"] = status
            r["reserved_run_id"] = run_id if status == "RESERVED" else (r.get("reserved_run_id") or run_id)
    save_quotes(ctx, rows)


def release_run(ctx: Context, run_id: str) -> list[str]:
    """Trả các câu đang RESERVED của một lần chạy về AVAILABLE."""
    rows = load_quotes(ctx)
    released = []
    for r in rows:
        if r.get("usage_status") == "RESERVED" and r.get("reserved_run_id") == run_id:
            r["usage_status"] = "AVAILABLE"
            r["reserved_run_id"] = ""
            released.append(r["quote_id"])
    save_quotes(ctx, rows)
    return released


# ---------------------------------------------------------------- nhập / xuất
def next_quote_id(rows: list[dict], topic: str) -> str:
    nums = [int(r["quote_id"][2:]) for r in rows
            if r.get("quote_id", "").startswith(f"Q{topic}") and r["quote_id"][2:].isdigit()]
    return f"Q{topic}{(max(nums) + 1 if nums else 1):04d}"


@dataclass
class ImportResult:
    added: list[str] = field(default_factory=list)
    skipped_duplicates: list[str] = field(default_factory=list)
    invalid: list[str] = field(default_factory=list)
    flagged_needs_verification: list[str] = field(default_factory=list)


def import_rows(ctx: Context, new_rows: list[dict], dry_run: bool = False) -> ImportResult:
    rows = load_quotes(ctx)
    res = ImportResult()
    now = ctx.now_iso()
    for i, raw in enumerate(new_rows, start=1):
        row = {f: (raw.get(f) or "").strip() for f in QUOTE_FIELDS}
        label = row["quote_id"] or f"dòng {i}"
        if not row["original_quote"] or row["topic"] not in TOPICS:
            res.invalid.append(f"{label}: thiếu original_quote hoặc topic không hợp lệ (A–H)")
            continue
        dup = is_duplicate_of(row, rows)
        if dup:
            res.skipped_duplicates.append(f"{label} (trùng {dup})")
            continue
        if row["source_status"] not in SOURCE_STATUSES:
            row["source_status"] = "NEEDS_VERIFICATION"
        # Không tự nâng trạng thái: thiếu nguồn mà ghi SOURCE_CITED -> hạ về NEEDS_VERIFICATION
        if row["source_status"] in ("VERIFIED", "SOURCE_CITED") and not (row["source_title"] and row["source_reference"]):
            row["source_status"] = "NEEDS_VERIFICATION"
        if row["source_status"] == "NEEDS_VERIFICATION":
            res.flagged_needs_verification.append(label)
        if not row["quote_id"] or any(r["quote_id"] == row["quote_id"] for r in rows):
            row["quote_id"] = next_quote_id(rows, row["topic"])
        row["usage_status"] = row["usage_status"] if row["usage_status"] in USAGE_STATUSES else "AVAILABLE"
        if row["usage_status"] == "RESERVED":
            row["usage_status"] = "AVAILABLE"
        row["created_at"] = row["created_at"] or now
        rows.append(row)
        res.added.append(row["quote_id"])
    if not dry_run:
        save_quotes(ctx, rows)
    return res


def import_csv_file(ctx: Context, path: Path, dry_run: bool = False) -> ImportResult:
    return import_rows(ctx, read_csv(Path(path)), dry_run=dry_run)


def import_google_sheet(ctx: Context, dry_run: bool = False) -> ImportResult:
    env_name = ctx.cfg("google_sheets.csv_url_env", "GSHEET_CSV_URL")
    url = os.environ.get(env_name, "").strip()
    if not url:
        raise RuntimeError(
            f"Chưa cấu hình {env_name}. Trong Google Sheets: Tệp > Chia sẻ > Công bố lên web > "
            f"chọn trang tính > định dạng CSV, sao chép đường dẫn vào tệp .env ({env_name}=...).")
    import csv
    import requests
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    new_rows = [dict(r) for r in csv.DictReader(io.StringIO(resp.text))]
    return import_rows(ctx, new_rows, dry_run=dry_run)


def export_csv(ctx: Context, dest: Path, topic: str | None = None, status: str | None = None) -> int:
    rows = [r for r in load_quotes(ctx)
            if (not topic or r["topic"] == topic) and (not status or r["source_status"] == status)]
    write_csv(Path(dest), rows, QUOTE_FIELDS)
    return len(rows)
