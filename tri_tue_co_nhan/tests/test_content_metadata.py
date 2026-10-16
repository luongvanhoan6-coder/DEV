"""4. Sinh nội dung & metadata (không cần API key)."""
import re

from src import content_generator as cg
from src import llm_client
from src import metadata_generator as mg
from src import quote_manager as qm


def _quote(project, qid):
    return next(r for r in qm.load_quotes(project) if r["quote_id"] == qid)


def test_build_content_has_all_outputs(project):
    q = _quote(project, "QE0001")
    c = cg.build_content(project, q, "RUN_T", 1, "suong_mai")
    for key in ("original_quote", "author", "source_title", "source_status", "voice_script", "interpretation",
                "title", "description", "hashtags", "background_keywords", "file_stem"):
        assert c[key], key
    assert c["quote_display"] in c["description"]
    assert "Chương 33" in c["description"]
    assert "Có dẫn nguồn" in c["description"]
    assert re.fullmatch(r"[0-9a-z_\-A-Z]+", c["file_stem"])  # tên tệp không dấu
    assert c["content_provider"] == "csv"


def test_template_voice_script_keeps_quote_and_neutral_attribution():
    q = {"quote_id": "QX0001", "topic": "D", "original_quote": "Lời nói chẳng mất tiền mua",
         "translation_vi": "Lời nói chẳng mất tiền mua, lựa lời mà nói cho vừa lòng nhau.",
         "author": "Ca dao Việt Nam", "source_status": "TRADITIONAL", "interpretation": "Nói thật bằng sự tử tế."}
    s = cg.template_voice_script(q)
    assert "lựa lời mà nói cho vừa lòng nhau" in s
    assert s.count("Người xưa có câu") == 1
    assert "Khổng Tử" not in s and "Đức Phật" not in s


def test_hashtags_and_titles():
    tags = mg.build_hashtags("E", ["#shorts"], limit=8)
    assert tags[0] == "#bietdu" and "#shorts" in tags and len(tags) <= 8
    long_title = {"title": "a " * 80}
    assert len(mg.build_title(long_title, 50)) <= 50


def test_platform_captions_respect_limits(project):
    q = _quote(project, "QA0001")
    c = cg.build_content(project, q, "RUN_T", 1, "mat_ho")
    plats = project.cfg("publishing.platforms")
    yt = mg.platform_caption(c, "youtube_shorts", plats["youtube_shorts"])
    tk = mg.platform_caption(c, "tiktok", plats["tiktok"])
    assert len(yt["title"]) <= 100 and "#shorts" in yt["caption"]
    assert tk["title"] == "" and len(tk["caption"]) <= 2200
    assert c["attribution_short"] in tk["caption"]


def test_llm_without_key_falls_back(project, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    assert not llm_client.is_configured()
    q = _quote(project, "QB0001")
    c = cg.build_content(project, q, "RUN_T", 1, "truc_lam", use_llm=True)
    assert c["content_provider"] == "csv" and c["llm_error"]


def test_generate_batch_writes_files(project):
    contents = cg.generate_batch(project, "RUN_BATCH", count=5)
    assert len(contents) == 5
    assert len({c["template"] for c in contents}) == 3  # xoay vòng ≥ 3 mẫu
    for c in contents:
        d = project.path("output", "drafts", "RUN_BATCH", c["video_id"])
        assert (d / "voice_script.txt").read_text(encoding="utf-8").strip() == c["voice_script"]
        assert (d / "metadata.txt").exists() and (d / "content.json").exists()
    reserved = [r for r in qm.load_quotes(project) if r["usage_status"] == "RESERVED"]
    assert len(reserved) == 5 and all(r["reserved_run_id"] == "RUN_BATCH" for r in reserved)
