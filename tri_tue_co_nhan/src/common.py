"""Tiện ích dùng chung: cấu hình, đường dẫn, CSV, thời gian, nhật ký, ffmpeg."""
from __future__ import annotations

import csv
import json
import logging
import os
import re
import secrets
import shutil
import subprocess
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent

QUOTE_FIELDS = [
    "quote_id", "topic", "original_quote", "translation_vi", "author",
    "source_title", "source_reference", "source_status", "interpretation",
    "voice_script", "background_keywords", "title", "description", "hashtags",
    "usage_status", "reserved_run_id", "notes", "created_at",
]
QUEUE_FIELDS = [
    "video_id", "run_id", "seq", "quote_id", "topic", "template", "status",
    "has_voice", "voice_provider", "duration_sec", "file_name", "video_path",
    "srt_path", "qc_status", "error", "created_at", "updated_at",
]
PUBLISHING_LOG_FIELDS = [
    "log_id", "video_id", "quote_id", "platform", "action", "package_path",
    "url", "note", "timestamp",
]
ANALYTICS_FIELDS = [
    "date", "video_id", "platform", "views", "watch_time_sec",
    "avg_view_duration_sec", "likes", "comments", "shares", "follows_gained",
]

TOPICS = {
    "A": "Buông bỏ và an nhiên",
    "B": "Nhân sinh và vô thường",
    "C": "Nhân quả và lòng từ bi",
    "D": "Đối nhân xử thế",
    "E": "Biết đủ và sống giản dị",
    "F": "Tu thân và kỷ luật",
    "G": "Gia đình và tình người",
    "H": "Danh lợi và thành công",
}
TOPIC_TARGETS = {"A": 200, "B": 150, "C": 150, "D": 150, "E": 100, "F": 100, "G": 100, "H": 50}

SOURCE_STATUSES = {
    "VERIFIED": "Người dùng đã đối chiếu với văn bản gốc",
    "SOURCE_CITED": "Có trích dẫn tác phẩm/chương cụ thể – nên đối chiếu trước khi đăng",
    "TRADITIONAL": "Ca dao, tục ngữ, câu lưu truyền – khuyết danh",
    "PARAPHRASE": "Diễn ý, không phải nguyên văn",
    "NEEDS_VERIFICATION": "Chưa xác minh được nguồn – KHÔNG đưa vào sản xuất",
}
USAGE_STATUSES = ["AVAILABLE", "RESERVED", "PRODUCED", "PUBLISHED", "RETIRED"]

# Trạng thái video trong content_queue.csv (theo thứ tự tiến trình)
VIDEO_STATUS_ORDER = [
    "DRAFT", "VOICED", "SUBTITLED", "RENDERED", "QC_FAILED", "QC_PASSED",
    "APPROVED", "PACKAGED", "PUBLISHED",
]

SECRET_PATTERN = re.compile(r"(sk-ant-[A-Za-z0-9_\-]+|AIza[0-9A-Za-z_\-]{20,}|key=[^&\s]+)")


# ---------------------------------------------------------------- context
@dataclass
class Context:
    root: Path
    settings: dict
    templates: dict
    logger: logging.Logger = field(repr=False, default=None)

    def path(self, *parts: str) -> Path:
        return self.root.joinpath(*parts)

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.settings["project"].get("timezone", "Asia/Ho_Chi_Minh"))

    def now(self) -> datetime:
        return datetime.now(self.tz)

    def now_iso(self) -> str:
        return self.now().isoformat(timespec="seconds")

    def cfg(self, dotted: str, default: Any = None) -> Any:
        cur: Any = self.settings
        for part in dotted.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return default
            cur = cur[part]
        return cur


def load_context(root: Path | str | None = None) -> Context:
    root = Path(root or os.environ.get("TTCN_ROOT") or PROJECT_ROOT).resolve()
    try:
        from dotenv import load_dotenv
        load_dotenv(root / ".env", override=False)
    except ImportError:  # pragma: no cover
        pass
    settings = yaml.safe_load((root / "config" / "settings.yaml").read_text(encoding="utf-8"))
    templates = yaml.safe_load((root / "config" / "video_template.yaml").read_text(encoding="utf-8"))
    ctx = Context(root=root, settings=settings, templates=templates.get("templates", {}))
    ctx.logger = setup_logger(root)
    return ctx


# ---------------------------------------------------------------- logging
class _RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(str(record.msg))
        if record.args:
            record.args = tuple(redact(str(a)) for a in record.args)
        return True


def redact(text: str) -> str:
    """Che mọi chuỗi giống API key trước khi ghi nhật ký."""
    text = SECRET_PATTERN.sub("***REDACTED***", text)
    for env_name in ("ANTHROPIC_API_KEY", "GOOGLE_TTS_API_KEY"):
        val = os.environ.get(env_name)
        if val and len(val) > 6:
            text = text.replace(val, "***REDACTED***")
    return text


def setup_logger(root: Path) -> logging.Logger:
    logger = logging.getLogger(f"ttcn.{root}")
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    log_dir = root / "reports" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    fh = logging.FileHandler(log_dir / "production.log", encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s"))
    fh.addFilter(_RedactFilter())
    logger.addHandler(fh)
    logger.propagate = False
    return logger


# ---------------------------------------------------------------- CSV
def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return [dict(row) for row in csv.DictReader(f)]


def write_csv(path: Path, rows: Iterable[dict], fields: list[str]) -> None:
    """Ghi CSV an toàn (ghi tệp tạm rồi thay thế) để không hỏng dữ liệu khi lỗi giữa chừng."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in fields})
    os.replace(tmp, path)


def append_csv(path: Path, row: dict, fields: list[str]) -> None:
    exists = path.exists() and path.stat().st_size > 0
    with path.open("a", encoding="utf-8-sig" if not exists else "utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        if not exists:
            writer.writeheader()
        writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in fields})


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


# ---------------------------------------------------------------- text
def strip_accents(text: str) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def slugify(text: str, max_len: int = 40) -> str:
    s = strip_accents(text).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:max_len].rstrip("-") or "video"


def normalize_for_compare(text: str) -> str:
    s = strip_accents(unicodedata.normalize("NFC", text or "")).lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def word_count(text: str) -> int:
    return len(re.findall(r"\w+", text or ""))


def new_run_id(ctx: Context) -> str:
    return f"RUN_{ctx.now().strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(2)}"


# ---------------------------------------------------------------- ffmpeg
def _bin(env_name: str, default: str) -> str | None:
    configured = os.environ.get(env_name, "").strip()
    if configured:
        return configured if Path(configured).is_file() else None
    return shutil.which(default)


def ffmpeg_bin() -> str | None:
    return _bin("FFMPEG_BIN", "ffmpeg")


def ffprobe_bin() -> str | None:
    return _bin("FFPROBE_BIN", "ffprobe")


def run_cmd(cmd: list[str], cwd: Path | None = None, timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True,
                          text=True, encoding="utf-8", errors="replace", timeout=timeout)


def ffprobe_json(path: Path) -> dict | None:
    probe = ffprobe_bin()
    if not probe or not Path(path).exists():
        return None
    res = run_cmd([probe, "-v", "error", "-print_format", "json", "-show_format",
                   "-show_streams", str(path)], timeout=60)
    if res.returncode != 0:
        return None
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError:
        return None


def media_duration(path: Path) -> float | None:
    info = ffprobe_json(path)
    if not info:
        return None
    try:
        return float(info["format"]["duration"])
    except (KeyError, TypeError, ValueError):
        return None


# ---------------------------------------------------------------- fonts
FONT_CANDIDATES = [
    # Linux
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSerif-Bold.ttf",
    # Windows
    "C:/Windows/Fonts/timesbd.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    # macOS
    "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]


def find_font(ctx: Context, kind: str = "quote") -> Path | None:
    """Ưu tiên: cấu hình -> assets/fonts -> phông hệ thống có hỗ trợ tiếng Việt."""
    configured = ctx.cfg(f"video.fonts.{kind}") or ""
    if configured:
        p = ctx.path(configured) if not Path(configured).is_absolute() else Path(configured)
        if p.exists():
            return p
    fonts = sorted(list(ctx.path("assets", "fonts").glob("*.ttf")) + list(ctx.path("assets", "fonts").glob("*.otf")))
    if fonts:
        bold = [f for f in fonts if "bold" in f.name.lower()]
        return (bold or fonts)[0]
    for cand in FONT_CANDIDATES:
        if Path(cand).exists():
            return Path(cand)
    return None


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
