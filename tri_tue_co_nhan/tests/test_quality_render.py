"""6. Kiểm tra tài nguyên · 7. Dựng video mẫu · 8. Phát hiện video lỗi."""
import pytest
from conftest import make_test_video, requires_ffmpeg

from src import pipeline, quality_checker
from src.production_queue import videos_for_run


def test_assets_empty_reports_errors(project):
    rep = quality_checker.check_assets(project)
    assert not rep["ok"]
    assert any("backgrounds trống" in e for e in rep["errors"])
    assert any("music trống" in w for w in rep["warnings"])


@requires_ffmpeg
def test_assets_placeholder_warning_and_corrupt_file(demo_assets):
    rep = quality_checker.check_assets(demo_assets)
    assert rep["ok"] and rep["counts"]["backgrounds"] == 6
    assert any("placeholder" in w for w in rep["warnings"])
    (demo_assets.path("assets", "backgrounds") / "hong.jpg").write_bytes(b"not an image")
    rep2 = quality_checker.check_assets(demo_assets)
    assert any("hong.jpg" in e for e in rep2["errors"])
    assert any("LICENSES.csv" in w for w in rep2["warnings"])


@requires_ffmpeg
def test_detect_broken_videos(project, tmp_path):
    garbage = tmp_path / "garbage.mp4"
    garbage.write_bytes(b"\x00" * 5000)
    r = quality_checker.check_video(project, garbage)
    assert r["status"] == "FAIL"

    missing = quality_checker.check_video(project, tmp_path / "khong_co.mp4")
    assert missing["status"] == "FAIL"

    wrong = make_test_video(tmp_path / "wrong.mp4", 640, 360, 16)
    r = quality_checker.check_video(project, wrong)
    assert r["status"] == "FAIL" and any("1080x1920" in e for e in r["errors"])

    short = make_test_video(tmp_path / "short.mp4", 1080, 1920, 5)
    r = quality_checker.check_video(project, short)
    assert any("Thời lượng" in e for e in r["errors"])

    silent = make_test_video(tmp_path / "silent.mp4", 1080, 1920, 16, audio=False)
    r = quality_checker.check_video(project, silent)
    assert any("âm thanh" in e for e in r["errors"])

    good = make_test_video(tmp_path / "good.mp4", 1080, 1920, 16)
    r = quality_checker.check_video(project, good)
    assert r["status"] == "PASS", r["errors"]

    # cắt cụt tệp hợp lệ -> phải phát hiện
    data = good.read_bytes()
    trunc = tmp_path / "trunc.mp4"
    trunc.write_bytes(data[: len(data) // 2])
    assert quality_checker.check_video(project, trunc)["status"] == "FAIL"


@requires_ffmpeg
@pytest.mark.slow
def test_render_one_real_video(demo_assets):
    ctx = demo_assets
    ctx.settings["video"]["preset"] = "ultrafast"
    manifest = pipeline.load_manifest(ctx, "RUN_RENDER_TEST")
    pipeline.run_content(ctx, manifest, 1)
    pipeline.run_voice_and_subtitles(ctx, manifest)
    pipeline.run_render(ctx, manifest)
    results = pipeline.run_quality(ctx, manifest)
    (vid, res), = results.items()
    assert res["status"] == "PASS", res["errors"]
    names = {c["name"]: c for c in res["checks"]}
    assert names["Kích thước 1080x1920 (9:16)"]["ok"]
    assert names["Codec video H.264"]["ok"] and names["Codec âm thanh AAC"]["ok"]
    assert names["Phụ đề SRT hợp lệ"]["ok"] and names["Giải mã toàn bộ không lỗi"]["ok"]
    assert not names["Có giọng đọc"]["ok"]  # trung thực: chưa có TTS
    v = videos_for_run(ctx, "RUN_RENDER_TEST")[0]
    assert v["status"] == "QC_PASSED" and ctx.path(v["video_path"]).exists()
    assert ctx.path("reports", "quality_reports", "RUN_RENDER_TEST.md").exists()
