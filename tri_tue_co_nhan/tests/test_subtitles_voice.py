"""5. Sinh phụ đề SRT · giao diện giọng đọc."""
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
