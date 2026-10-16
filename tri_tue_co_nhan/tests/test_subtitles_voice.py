"""5. Sinh phụ đề SRT · giao diện giọng đọc."""
import io
import subprocess

from conftest import requires_ffmpeg

from src import subtitle_generator as sg
from src import voice_generator as vg
from src.common import ffmpeg_bin

SCRIPT = ("Có những ngày, một lời chê cũng đủ làm ta mất ngủ. Kinh Pháp Cú dạy: như tảng đá kiên cố "
          "không lay động trước gió, người trí không dao động trước lời khen hay tiếng chê. Khen chê như gió "
          "thoảng qua. Giữ lòng vững vàng, ta mới thật sự bình an.")


def test_srt_format_and_validation(project, tmp_path):
    cues = sg.build_cues(project, SCRIPT, 20.0, 1.2)
    p = tmp_path / "a.srt"
    sg.write_srt(p, cues)
    text = p.read_text(encoding="utf-8")
    assert text.startswith("1\n00:00:01,200 --> ")
    assert "tảng đá kiên cố" in text            # giữ nguyên dấu tiếng Việt
    parsed, errors = sg.validate_srt(p, video_duration=25.0)
    assert errors == [] and len(parsed) == len(cues)
    assert abs(parsed[-1].end - 21.2) < 0.6
    for c in parsed:
        assert all(len(line) <= 34 for line in c.text.splitlines())
        assert len(c.text.splitlines()) <= 2


def test_srt_validation_detects_errors(tmp_path):
    bad = tmp_path / "bad.srt"
    bad.write_text("1\n00:00:05,000 --> 00:00:04,000\nA\n\n3\n00:00:03,000 --> 00:00:09,000\nB\n\n"
                   "3\n00:00:0x --> 00:00:10,000\nC\n", encoding="utf-8")
    _, errors = sg.validate_srt(bad, video_duration=6.0)
    joined = " ".join(errors)
    assert "không sau" in joined and "chồng lấn" in joined and "số thứ tự" in joined and "định dạng" in joined
    assert "kết thúc" in joined
    assert sg.validate_srt(tmp_path / "none.srt")[1]


def test_timeline_clamped(project):
    short = sg.compute_timeline(project, 5.0)
    assert short["total"] == 15.0 and short["within_limits"]
    long = sg.compute_timeline(project, 27.5)
    assert long["total"] <= 30.0 and long["head"] >= 0.5
    too_long = sg.compute_timeline(project, 40.0)
    assert not too_long["within_limits"]


def test_sentence_timings_alignment(project):
    sentences = sg.split_sentences(SCRIPT)
    timings, t = [], 0.0
    for s in sentences:
        timings.append({"start": t, "end": t + len(s) / 20, "text": s})
        t += len(s) / 20 + 0.4
    cues = sg.build_cues(project, SCRIPT, t, 1.0, timings)
    assert abs(cues[0].start - 1.0) < 1e-6
    assert abs(cues[-1].end - (1.0 + timings[-1]["end"])) < 0.01


def test_ass_contains_style_and_text(project):
    cues = sg.build_cues(project, SCRIPT, 20.0, 1.0)
    ass = sg.to_ass(cues, {"font_size": 60, "color": "#FFFFFF", "outline_color": "#000000"}, "DejaVu Serif", 1080, 1920)
    assert "PlayResX: 1080" in ass and "Style: Sub,DejaVu Serif,60" in ass
    assert "\\N" in ass and "tảng đá" in ass


def test_voice_provider_none_returns_none(project, tmp_path):
    assert vg.generate_voice(project, SCRIPT, tmp_path / "v") is None
    assert not list((tmp_path / "v").glob("voice.*"))  # không tạo âm thanh giả


def test_unknown_provider_rejected(project):
    try:
        vg.get_provider(project, "abc")
    except ValueError:
        pass
    else:
        raise AssertionError


@requires_ffmpeg
def test_manual_voice_provider(project, tmp_path):
    d = tmp_path / "v"
    d.mkdir()
    assert vg.generate_voice(project, SCRIPT, d, provider_name="manual") is None
    subprocess.run([ffmpeg_bin(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=200:d=3",
                    str(d / "voice.wav")], check=True)
    res = vg.generate_voice(project, SCRIPT, d, provider_name="manual")
    assert res and abs(res.duration - 3.0) < 0.2 and (d / "voice_meta.json").exists()


class _Resp:
    def __init__(self, status, payload):
        self.status_code, self._payload = status, payload
        self.text = str(payload)

    def json(self):
        return self._payload


def _pcm_payload(seconds, rate=24000):
    import base64
    data = base64.b64encode(b"\x00\x00" * int(seconds * rate)).decode()
    return {"candidates": [{"content": {"parts": [{"inlineData": {
        "mimeType": f"audio/L16;codec=pcm;rate={rate}", "data": data}}]}}]}


def test_gemini_not_configured_without_key(project, tmp_path, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    ok, msg = vg.get_provider(project, "gemini").is_configured()
    assert not ok and "aistudio" in msg
    assert vg.generate_voice(project, SCRIPT, tmp_path / "g", provider_name="gemini") is None


@requires_ffmpeg
def test_gemini_writes_wav_and_keeps_key_out_of_url(project, tmp_path, monkeypatch):
    import requests
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaTEST_KEY_123")
    seen = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        seen.update(url=url, headers=headers, body=json)
        return _Resp(200, _pcm_payload(20.0))

    monkeypatch.setattr(requests, "post", fake_post)
    d = tmp_path / "g"
    res = vg.generate_voice(project, SCRIPT, d, provider_name="gemini")
    assert res and res.path.name == "voice.wav" and abs(res.duration - 20.0) < 0.1
    assert "AIzaTEST" not in seen["url"] and seen["headers"]["x-goog-api-key"] == "AIzaTEST_KEY_123"
    assert seen["body"]["generationConfig"]["responseModalities"] == ["AUDIO"]
    assert SCRIPT in seen["body"]["contents"][0]["parts"][0]["text"]


def test_gemini_errors_and_abnormal_duration(project, tmp_path, monkeypatch):
    import requests
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaTEST_KEY_123")
    project.settings["voice"]["gemini"]["max_retries"] = 0
    monkeypatch.setattr(requests, "post", lambda *a, **k: _Resp(400, {"error": {"message": "API key not valid."}}))
    try:
        vg.generate_voice(project, SCRIPT, tmp_path / "e1", provider_name="gemini")
    except vg.VoiceGenerationError as exc:
        assert "API key not valid" in str(exc) and "GEMINI_API_KEY" in str(exc)
    else:
        raise AssertionError
    # 120 giây cho ~55 từ -> nghi đọc cả lời hướng dẫn -> từ chối, không giữ tệp
    monkeypatch.setattr(requests, "post", lambda *a, **k: _Resp(200, _pcm_payload(120.0)))
    try:
        vg.generate_voice(project, SCRIPT, tmp_path / "e2", provider_name="gemini")
    except vg.VoiceGenerationError as exc:
        assert "bất thường" in str(exc)
    else:
        raise AssertionError
    assert not (tmp_path / "e2" / "voice.wav").exists()


def test_no_orphan_short_subtitle_chunk():
    chunks = sg.split_into_chunks("như tảng đá kiên cố không lay động trước gió, người trí không dao động "
                                  "trước lời khen hay tiếng chê.", 26, 2)
    assert all(len(c) >= 16 for c, _ in chunks) and all(len(c) <= 60 for c, _ in chunks)
    assert " ".join(c for c, _ in chunks).endswith("tiếng chê.")


@requires_ffmpeg
def test_align_sentences_by_real_silences(tmp_path):
    # 3 "câu" dài 2s / 3s / 1.5s, cách nhau bởi khoảng lặng 0.5s
    wav = tmp_path / "v.wav"
    subprocess.run([ffmpeg_bin(), "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                    "sine=f=220:d=7.5:sample_rate=48000",
                    "-af", "volume='if(between(t,2,2.5)+between(t,5.5,6),0,1)':eval=frame", str(wav)], check=True)
    text = "Câu thứ nhất khá ngắn. Câu thứ hai dài hơn câu thứ nhất một chút nữa. Câu ba."
    t = vg.align_sentences_by_silence(wav, text, 7.5)
    assert len(t) == 3
    assert abs(t[0]["end"] - 2.0) < 0.1 and abs(t[1]["start"] - 2.5) < 0.1
    assert abs(t[1]["end"] - 5.5) < 0.1 and abs(t[2]["start"] - 6.0) < 0.1
    # không đủ khoảng lặng -> trả về rỗng để dùng cách chia theo tỉ lệ
    assert vg.align_sentences_by_silence(wav, "Một. Hai. Ba. Bốn. Năm.", 7.5) == []


@requires_ffmpeg
def test_espeak_provider_if_installed(project, tmp_path):
    p = vg.get_provider(project, "espeak")
    if not p.is_configured()[0]:
        import pytest
        pytest.skip("espeak-ng chưa cài")
    res = vg.generate_voice(project, "Người biết đủ là người giàu. Thắng mình mới là mạnh.", tmp_path / "e",
                            provider_name="espeak")
    assert res and res.duration > 2 and res.path.name == "voice.wav"


def test_voice_profiles_override_provider_config(project):
    male = vg.get_provider(project, "gemini", "nam_tram").cfg()
    female = vg.get_provider(project, "gemini", "nu_tram_am").cfg()
    assert male["voice_name"] != female["voice_name"]
    assert "phát thanh viên" in female["style_prompt"] and "nữ" in female["style_prompt"]
    assert female["model"] == project.cfg("voice.gemini.model")       # khóa không ghi đè vẫn giữ
    assert vg.get_provider(project, "espeak", "nu_tram_am").cfg()["voice"] == "vi+linda"
    try:
        vg.get_provider(project, "gemini", "khong_co")
    except ValueError:
        pass
    else:
        raise AssertionError


def test_default_profile_rotation(project):
    assert vg.default_profile(project, 3) == "nam_tram"
    project.settings["voice"]["profile_rotation"] = ["nam_tram", "nu_tram_am"]
    assert [vg.default_profile(project, i) for i in (1, 2, 3)] == ["nam_tram", "nu_tram_am", "nam_tram"]


@requires_ffmpeg
def test_changing_profile_regenerates_voice(project, tmp_path):
    if not vg.get_provider(project, "espeak").is_configured()[0]:
        import pytest
        pytest.skip("espeak-ng chưa cài")
    d = tmp_path / "p"
    text = "Người biết đủ là người giàu. Thắng mình mới là mạnh."
    a = vg.generate_voice(project, text, d, provider_name="espeak", profile="nam_tram")
    size_a = a.path.stat().st_size
    same = vg.generate_voice(project, text, d, provider_name="espeak", profile="nam_tram")
    assert same.path.stat().st_size == size_a                     # dùng lại bản cũ
    b = vg.generate_voice(project, text, d, provider_name="espeak", profile="nu_tram_am")
    from src.common import read_json
    assert read_json(d / "voice_meta.json")["profile"] == "nu_tram_am" and b.path.exists()


def test_piper_reports_missing_model(project):
    project.settings["voice"]["piper"]["model"] = "assets/voices/khong_co/model.onnx"
    ok, msg = vg.get_provider(project, "piper").is_configured()
    assert not ok and ("download_voice_models" in msg or "piper-tts" in msg)


@requires_ffmpeg
def test_piper_real_model_if_downloaded(project, tmp_path):
    from conftest import ROOT
    model = ROOT / "assets" / "voices" / "vi_VN-vais1000-medium" / "vi_VN-vais1000-medium.onnx"
    project.settings["voice"]["piper"]["model"] = str(model)
    if not vg.get_provider(project, "piper").is_configured()[0]:
        import pytest
        pytest.skip("Chưa cài piper-tts hoặc chưa tải mô hình")
    res = vg.generate_voice(project, "Người biết đủ là người giàu. Thắng mình mới là mạnh.", tmp_path / "pp",
                            provider_name="piper", profile="nu_tram_am")
    assert res and 2.0 < res.duration < 12.0 and res.path.name == "voice.wav"


def test_download_script_rejects_tampered_file(monkeypatch, tmp_path):
    import importlib.util
    from conftest import ROOT
    spec = importlib.util.spec_from_file_location("dvm", ROOT / "scripts" / "download_voice_models.py")
    dvm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dvm)

    class FakeResp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(dvm.urllib.request, "urlopen", lambda *a, **k: FakeResp(b"tep bi thay doi"))
    monkeypatch.setattr(dvm, "ROOT", tmp_path)
    monkeypatch.setattr("sys.argv", ["x"])
    try:
        dvm.main()
    except SystemExit as exc:
        assert "SHA-256 không khớp" in str(exc)
    else:
        raise AssertionError
    assert not (tmp_path / "assets" / "voices").exists()
