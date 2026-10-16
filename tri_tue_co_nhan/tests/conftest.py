"""Fixture: tạo một dự án tạm (bản sao config + kho câu nói) để kiểm thử không đụng dữ liệu thật."""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.common import PUBLISHING_LOG_FIELDS, QUEUE_FIELDS, ffmpeg_bin, load_context, write_csv  # noqa: E402

requires_ffmpeg = pytest.mark.skipif(not ffmpeg_bin(), reason="Cần ffmpeg")


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "proj"
    shutil.copytree(ROOT / "config", root / "config")
    (root / "data").mkdir(parents=True)
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_seed_quotes.py")], check=True,
                   capture_output=True)  # đảm bảo tệp seed tồn tại
    shutil.copy2(ROOT / "data" / "quotes.csv", root / "data" / "quotes.csv")
    # kho câu nói sạch: mọi câu AVAILABLE
    from src.common import QUOTE_FIELDS, read_csv
    rows = read_csv(root / "data" / "quotes.csv")
    for r in rows:
        r["usage_status"], r["reserved_run_id"] = "AVAILABLE", ""
    write_csv(root / "data" / "quotes.csv", rows, QUOTE_FIELDS)
    write_csv(root / "data" / "content_queue.csv", [], QUEUE_FIELDS)
    write_csv(root / "data" / "publishing_log.csv", [], PUBLISHING_LOG_FIELDS)
    for d in ("assets/backgrounds", "assets/music", "assets/fonts", "assets/logo", "output/drafts",
              "output/approved", "output/videos", "output/subtitles", "output/publishing_packages",
              "reports/quality_reports", "reports/runs"):
        (root / d).mkdir(parents=True, exist_ok=True)
    ctx = load_context(root)
    ctx.settings["voice"]["provider"] = "none"
    ctx.settings["content"]["provider"] = "template"
    return ctx


@pytest.fixture
def demo_assets(project):
    subprocess.run([sys.executable, str(ROOT / "scripts" / "generate_placeholder_assets.py"),
                    "--root", str(project.root)], check=True, capture_output=True)
    return project


def make_test_video(path: Path, width=1080, height=1920, duration=16.0, audio=True) -> Path:
    """Tạo nhanh một video thử bằng ffmpeg lavfi."""
    cmd = [ffmpeg_bin(), "-y", "-loglevel", "error", "-f", "lavfi", "-i",
           f"color=c=0x335566:s={width}x{height}:r=30:d={duration}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=f=220:d={duration}:sample_rate=48000"]
    cmd += ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
    cmd += (["-c:a", "aac", "-shortest"] if audio else [])
    cmd += [str(path)]
    subprocess.run(cmd, check=True)
    return path
