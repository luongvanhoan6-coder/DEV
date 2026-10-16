"""9. Gói đăng bài · 10. Ghi nhật ký và tiếp tục sau lỗi · bảo mật."""
import json
import shutil

import pytest
from conftest import ROOT, make_test_video, requires_ffmpeg

from src import pipeline, publishing_manager, quote_manager, reporting, video_renderer
from src.common import read_csv, redact, setup_logger
from src.production_queue import load_queue, update_status, videos_for_run


def _fake_render(ctx, content, work_dir, **kw):
    out_dir = ctx.path("output", "videos", content["run_id"])
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{content['file_stem']}.mp4"
    out.write_bytes(b"fake")
    srt_dir = ctx.path("output", "subtitles", content["run_id"])
    srt_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(work_dir / "subtitles.srt", srt_dir / f"{content['file_stem']}.srt")
    meta = {"video_path": str(out.relative_to(ctx.root)),
            "srt_path": str((srt_dir / f"{content['file_stem']}.srt").relative_to(ctx.root)),
            "background": None, "music": None, "render_seconds": 0.0, "output_duration": 20.0,
            "timeline": kw["timeline"]}
    (work_dir / "render_meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return meta


def test_resume_after_failure_without_duplicates(project, monkeypatch):
    calls = []

    def flaky(ctx, content, work_dir, **kw):
        calls.append(content["video_id"])
        if content["seq"] == 2 and calls.count(content["video_id"]) == 1:
            raise video_renderer.RenderError("Mất điện giả lập")
        return _fake_render(ctx, content, work_dir, **kw)

    monkeypatch.setattr(video_renderer, "render_video", flaky)
    m1 = pipeline.load_manifest(project, "RUN_RESUME")
    pipeline.run_content(project, m1, 3)
    pipeline.run_voice_and_subtitles(project, m1)
    pipeline.run_render(project, m1)
    vids = videos_for_run(project, "RUN_RESUME")
    assert [v["status"] for v in vids] == ["RENDERED", "SUBTITLED", "RENDERED"]
    assert "Mất điện" in vids[1]["error"]
    reserved_before = {r["quote_id"] for r in quote_manager.load_quotes(project) if r["usage_status"] == "RESERVED"}

    # chạy tiếp
    m2 = pipeline.load_manifest(project, "RUN_RESUME")
    pipeline.run_content(project, m2, 3)
    pipeline.run_voice_and_subtitles(project, m2)
    pipeline.run_render(project, m2)
    vids = videos_for_run(project, "RUN_RESUME")
    assert all(v["status"] == "RENDERED" for v in vids)
    assert len(load_queue(project)) == 3                    # không tạo trùng video
    assert calls.count(vids[0]["video_id"]) == 1            # video đã xong không dựng lại
    assert calls.count(vids[1]["video_id"]) == 2
    reserved_after = {r["quote_id"] for r in quote_manager.load_quotes(project) if r["usage_status"] == "RESERVED"}
    assert reserved_after == reserved_before                # không giữ chỗ thêm câu mới
    assert pipeline.manifest_path(project, "RUN_RESUME").exists()
    assert project.path("reports", "run_manifest.json").exists()


def test_feedback_loop_written_once_and_keeps_manual_notes(project, monkeypatch):
    monkeypatch.setattr(video_renderer, "render_video", _fake_render)
    m = pipeline.load_manifest(project, "RUN_FB")
    pipeline.run_content(project, m, 2)
    pipeline.summarize(project, m)
    path = reporting.update_feedback_loop(project, m)
    text = path.read_text(encoding="utf-8")
    assert text.count("<!-- RUN:RUN_FB:START -->") == 1 and "Số câu đã xử lý | 2" in text
    text = text.replace("- _(người vận hành ghi tại đây)_", "- Đổi giọng đọc sang nữ")
    path.write_text(text, encoding="utf-8")
    reporting.update_feedback_loop(project, m)
    text2 = path.read_text(encoding="utf-8")
    assert text2.count("<!-- RUN:RUN_FB:START -->") == 1 and "Đổi giọng đọc sang nữ" in text2


def _prepare_passed_video(project, tmp_path, has_voice):
    m = pipeline.load_manifest(project, "RUN_PUB")
    pipeline.run_content(project, m, 1)
    pipeline.run_voice_and_subtitles(project, m)
    v = videos_for_run(project, "RUN_PUB")[0]
    vid_dir = project.path("output", "videos", "RUN_PUB")
    vid_dir.mkdir(parents=True, exist_ok=True)
    make_test_video(vid_dir / v["file_name"], duration=16)
    srt = project.path("output", "subtitles", "RUN_PUB", v["file_name"].replace(".mp4", ".srt"))
    srt.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(project.path("output", "drafts", "RUN_PUB", v["video_id"], "subtitles.srt"), srt)
    update_status(project, v["video_id"], "QC_PASSED", has_voice="yes" if has_voice else "no",
                  video_path=str((vid_dir / v["file_name"]).relative_to(project.root)),
                  srt_path=str(srt.relative_to(project.root)), duration_sec=16)
    return v["video_id"]


@requires_ffmpeg
def test_approval_package_and_publish_log(project, tmp_path):
    vid = _prepare_passed_video(project, tmp_path, has_voice=False)
    with pytest.raises(publishing_manager.ApprovalError):
        publishing_manager.approve(project, vid)           # chưa có giọng đọc -> chặn
    assert publishing_manager.package(project, "RUN_PUB") == []  # chưa duyệt -> không đóng gói
    publishing_manager.approve(project, vid, allow_no_voice=True)
    dirs = publishing_manager.package(project, "RUN_PUB", publish_date="2026-10-20")
    base = dirs[0]
    for plat in ("facebook_reels", "tiktok", "youtube_shorts"):
        d = base / plat / vid
        for f in ("caption.txt", "description.txt", "hashtags.txt", "subtitles.srt", "source.txt",
                  "checklist.md", "metadata.json"):
            assert (d / f).exists(), (plat, f)
        assert list(d.glob("*.mp4"))
    assert (base / "schedule.csv").exists()
    log = read_csv(project.path("data", "publishing_log.csv"))
    assert {r["action"] for r in log} == {"PACKAGED"} and len(log) == 3
    v = next(r for r in load_queue(project) if r["video_id"] == vid)
    assert v["status"] == "PACKAGED"                         # đóng gói KHÔNG phải đã đăng
    with pytest.raises(ValueError):
        publishing_manager.mark_published(project, vid, "tiktok", "")
    publishing_manager.mark_published(project, vid, "tiktok", "https://www.tiktok.com/@kenh/video/1")
    log = read_csv(project.path("data", "publishing_log.csv"))
    assert log[-1]["action"] == "PUBLISHED_CONFIRMED_BY_USER"
    q = next(r for r in quote_manager.load_quotes(project) if r["quote_id"] == v["quote_id"])
    assert q["usage_status"] == "PUBLISHED"


def test_secrets_are_redacted(project, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-1234567890abcdef")
    assert "1234567890" not in redact("key sk-ant-test-1234567890abcdef in text")
    assert "AIzaSy" not in redact("url?key=AIzaSyA1234567890123456789012")
    logger = setup_logger(project.root)
    logger.error("Lỗi với khóa %s", "sk-ant-test-1234567890abcdef")
    for h in logger.handlers:
        h.flush()
    log_text = project.path("reports", "logs", "production.log").read_text(encoding="utf-8")
    assert "1234567890abcdef" not in log_text and "REDACTED" in log_text


def test_env_is_gitignored_and_example_has_no_secrets():
    assert ".env" in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    example = (ROOT / ".env.example").read_text(encoding="utf-8")
    for line in example.splitlines():
        if line and not line.startswith("#") and "=" in line:
            assert line.split("=", 1)[1].strip() == "", line


def test_cost_estimate_free_by_default(project):
    est = reporting.estimate_costs(project)
    assert est["videos_per_month"] == 150
    assert est["current_config_vnd_month"] == 0
    assert est["all_paid_options_vnd_month"] < 500_000


def test_voice_failure_is_recorded_not_faked(project, monkeypatch):
    from src import voice_generator as vg

    class Broken(vg.VoiceProvider):
        name = "broken"

        def is_configured(self):
            return True, "giả lập"

        def synthesize(self, text, out_dir):
            raise vg.VoiceGenerationError("dịch vụ TTS không phản hồi")

    monkeypatch.setitem(vg.PROVIDERS, "broken", Broken)
    project.settings["voice"]["provider"] = "broken"
    m = pipeline.load_manifest(project, "RUN_VOICE_ERR")
    pipeline.run_content(project, m, 2)
    pipeline.run_voice_and_subtitles(project, m)
    vids = videos_for_run(project, "RUN_VOICE_ERR")
    assert all(v["status"] == "DRAFT" and "TTS" in v["error"] for v in vids)
    for v in vids:
        d = project.path("output", "drafts", "RUN_VOICE_ERR", v["video_id"])
        assert not list(d.glob("voice.*"))       # không có âm thanh giả
    step = next(s for s in m["steps"] if s["name"] == "voice_subtitles")
    assert not step["ok"] and len(step["errors"]) == 2
