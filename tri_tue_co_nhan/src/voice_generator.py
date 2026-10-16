"""Giao diện nhà cung cấp giọng đọc (TTS) có thể thay thế.

Nhà cung cấp hỗ trợ (voice.provider trong config/settings.yaml):
  none         – chưa cấu hình: KHÔNG tạo âm thanh; vẫn có voice_script.txt + SRT.
  manual       – bạn tự thu âm, đặt voice.mp3 / voice.wav / voice.m4a vào thư mục nháp của video.
  edge_tts     – Microsoft Edge Read-Aloud qua gói `edge-tts` (miễn phí, KHÔNG phải API chính thức).
  google_cloud – Google Cloud Text-to-Speech REST API (chính thức; cần GOOGLE_TTS_API_KEY).
  espeak       – eSpeak-NG offline (giọng máy, chỉ để thử nghiệm).
  gemini       – Gemini API (Google AI Studio) – mô hình TTS, có hạn mức miễn phí; cần GEMINI_API_KEY.

Hệ thống không bao giờ tạo tệp âm thanh giả để thay cho giọng đọc.
"""
from __future__ import annotations

import base64
import html
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from .common import Context, media_duration, write_json

MANUAL_NAMES = ["voice.mp3", "voice.wav", "voice.m4a"]


class VoiceNotConfigured(RuntimeError):
    pass


class VoiceGenerationError(RuntimeError):
    pass


@dataclass
class VoiceResult:
    path: Path
    duration: float
    provider: str
    sentence_timings: list[dict] = field(default_factory=list)  # [{start, end, text}] (giây)


class VoiceProvider:
    name = "base"

    def __init__(self, ctx: Context):
        self.ctx = ctx

    def is_configured(self) -> tuple[bool, str]:
        raise NotImplementedError

    def synthesize(self, text: str, out_dir: Path) -> VoiceResult:
        raise NotImplementedError


class NoVoiceProvider(VoiceProvider):
    name = "none"

    def is_configured(self):
        return False, ("Chưa cấu hình giọng đọc (voice.provider: none). Xem docs/HUONG_DAN_GIONG_DOC.md. "
                       "Video vẫn được dựng với phụ đề và nhạc nền (nếu có), nhưng sẽ không được duyệt "
                       "khi quality.require_voice_for_approval = true.")

    def synthesize(self, text, out_dir):
        raise VoiceNotConfigured(self.is_configured()[1])


class ManualVoiceProvider(VoiceProvider):
    name = "manual"

    def is_configured(self):
        return True, "Đặt tệp voice.mp3/voice.wav/voice.m4a vào thư mục nháp của từng video."

    def synthesize(self, text, out_dir):
        for n in MANUAL_NAMES:
            p = out_dir / n
            if p.exists():
                dur = media_duration(p)
                if not dur or dur < 1.0:
                    raise VoiceGenerationError(f"Tệp {p.name} không đọc được hoặc quá ngắn")
                return VoiceResult(p, dur, self.name)
        raise VoiceNotConfigured(f"Chưa có tệp giọng đọc trong {out_dir} (cần một trong: {', '.join(MANUAL_NAMES)})")


class EdgeTTSProvider(VoiceProvider):
    name = "edge_tts"

    def is_configured(self):
        try:
            import edge_tts  # noqa: F401
        except ImportError:
            return False, "Chưa cài gói edge-tts: pip install edge-tts"
        return True, "edge-tts đã cài (dịch vụ không chính thức, cần Internet)."

    def synthesize(self, text, out_dir):
        ok, msg = self.is_configured()
        if not ok:
            raise VoiceNotConfigured(msg)
        import asyncio

        import edge_tts
        cfg = self.ctx.cfg("voice.edge_tts", {}) or {}
        out = out_dir / "voice.mp3"
        timings: list[dict] = []
        timeout = float(cfg.get("timeout_sec", 90))

        async def _run() -> None:
            comm = edge_tts.Communicate(
                text, cfg.get("voice", "vi-VN-NamMinhNeural"), rate=cfg.get("rate", "-12%"),
                pitch=cfg.get("pitch", "-4Hz"), volume=cfg.get("volume", "+0%"), boundary="SentenceBoundary",
                proxy=os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or None,
                connect_timeout=15, receive_timeout=60)
            with out.open("wb") as f:
                async for chunk in comm.stream():
                    if chunk["type"] == "audio":
                        f.write(chunk["data"])
                    elif chunk["type"] in ("SentenceBoundary", "WordBoundary"):
                        start = chunk["offset"] / 1e7
                        timings.append({"start": start, "end": start + chunk["duration"] / 1e7,
                                        "text": chunk.get("text", "")})

        try:
            asyncio.run(asyncio.wait_for(_run(), timeout=timeout))
        except asyncio.TimeoutError as exc:
            out.unlink(missing_ok=True)
            raise VoiceGenerationError(f"edge-tts quá {timeout:.0f}s không phản hồi (mạng/dịch vụ bị chặn?)") from exc
        except Exception as exc:  # mạng, dịch vụ thay đổi...
            out.unlink(missing_ok=True)
            raise VoiceGenerationError(f"edge-tts lỗi: {exc.__class__.__name__}: {str(exc)[:200]}") from exc
        dur = media_duration(out)
        if not dur or dur < 1.0:
            out.unlink(missing_ok=True)
            raise VoiceGenerationError("edge-tts trả về âm thanh rỗng")
        return VoiceResult(out, dur, self.name, timings)


def _ssml(text: str, pause_ms: int = 450) -> str:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text) if s.strip()]
    body = f'<break time="{pause_ms}ms"/>'.join(html.escape(s) for s in sentences)
    return f"<speak>{body}</speak>"


class GoogleCloudTTSProvider(VoiceProvider):
    name = "google_cloud"
    ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"

    def is_configured(self):
        if not os.environ.get("GOOGLE_TTS_API_KEY"):
            return False, "Chưa đặt GOOGLE_TTS_API_KEY trong .env (xem docs/HUONG_DAN_GIONG_DOC.md)"
        return True, "Google Cloud TTS đã có API key (chưa kiểm chứng cho tới khi chạy thật)."

    def synthesize(self, text, out_dir):
        ok, msg = self.is_configured()
        if not ok:
            raise VoiceNotConfigured(msg)
        import requests
        cfg = self.ctx.cfg("voice.google_cloud", {}) or {}
        body = {
            "input": {"ssml": _ssml(text)},
            "voice": {"languageCode": cfg.get("language_code", "vi-VN"), "name": cfg.get("voice_name", "vi-VN-Neural2-D")},
            "audioConfig": {"audioEncoding": "MP3", "speakingRate": cfg.get("speaking_rate", 0.88),
                            "pitch": cfg.get("pitch", -2.0), "sampleRateHertz": 48000},
        }
        try:
            resp = requests.post(self.ENDPOINT, params={"key": os.environ["GOOGLE_TTS_API_KEY"]},
                                 json=body, timeout=60)
        except requests.RequestException as exc:
            raise VoiceGenerationError(f"Không kết nối được Google TTS: {exc.__class__.__name__}") from exc
        if resp.status_code != 200:
            raise VoiceGenerationError(f"Google TTS lỗi HTTP {resp.status_code}: {resp.text[:200]}")
        out = out_dir / "voice.mp3"
        out.write_bytes(base64.b64decode(resp.json()["audioContent"]))
        dur = media_duration(out)
        if not dur or dur < 1.0:
            raise VoiceGenerationError("Google TTS trả về âm thanh không hợp lệ")
        return VoiceResult(out, dur, self.name)


GEMINI_HINTS = {
    400: "kiểm tra GEMINI_API_KEY và tên model/giọng trong voice.gemini",
    403: "khóa không có quyền dùng Gemini API hoặc khu vực không được hỗ trợ",
    404: "tên model TTS không tồn tại – cập nhật voice.gemini.model",
    429: "vượt hạn mức miễn phí – chờ vài phút hoặc chạy ít video hơn mỗi lần",
}


def _gemini_error(resp) -> str:
    try:
        msg = resp.json()["error"]["message"]
    except (ValueError, KeyError, TypeError):
        msg = resp.text[:200]
    hint = GEMINI_HINTS.get(resp.status_code)
    return f"{msg[:200]}" + (f" ({hint})" if hint else "")


class GeminiTTSProvider(VoiceProvider):
    """Gemini API (Google AI Studio) – mô hình TTS trả về PCM 16-bit, được ghi thành voice.wav.

    Khóa đọc từ GEMINI_API_KEY (hoặc GOOGLE_API_KEY), gửi qua header – không nằm trong URL/nhật ký.
    """
    name = "gemini"
    ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    @staticmethod
    def _key() -> str:
        return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""

    def is_configured(self):
        if not self._key():
            return False, ("Chưa đặt GEMINI_API_KEY trong .env – lấy khóa miễn phí tại "
                           "https://aistudio.google.com/apikey (xem docs/HUONG_DAN_GIONG_DOC.md)")
        cfg = self.ctx.cfg("voice.gemini", {}) or {}
        return True, f"Gemini TTS: model {cfg.get('model')}, giọng {cfg.get('voice_name')}."

    def _request(self, text: str) -> tuple[bytes, int]:
        import time

        import requests
        cfg = self.ctx.cfg("voice.gemini", {}) or {}
        style = (cfg.get("style_prompt") or "").strip()
        prompt = f"{style}\n\n{text}" if style else text
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": cfg.get("voice_name", "Charon")}}},
            },
        }
        url = self.ENDPOINT.format(model=cfg.get("model", "gemini-2.5-flash-preview-tts"))
        attempts = int(cfg.get("max_retries", 3)) + 1
        last = ""
        for i in range(attempts):
            try:
                resp = requests.post(url, headers={"x-goog-api-key": self._key()}, json=body,
                                     timeout=float(cfg.get("timeout_sec", 120)))
            except requests.RequestException as exc:
                last = f"Không kết nối được Gemini API: {exc.__class__.__name__}"
            else:
                if resp.status_code == 200:
                    break
                last = f"Gemini API lỗi HTTP {resp.status_code}: {_gemini_error(resp)}"
                if resp.status_code not in (429, 500, 502, 503, 504):
                    raise VoiceGenerationError(last)
            if i < attempts - 1:
                time.sleep(min(60, 10 * (i + 1)))  # hạn mức miễn phí giới hạn số lượt/phút
        else:
            raise VoiceGenerationError(last)
        try:
            part = resp.json()["candidates"][0]["content"]["parts"][0]["inlineData"]
        except (KeyError, IndexError, ValueError) as exc:
            raise VoiceGenerationError(f"Gemini không trả về âm thanh: {resp.text[:300]}") from exc
        rate = 24000
        m = re.search(r"rate=(\d+)", part.get("mimeType", ""))
        if m:
            rate = int(m.group(1))
        return base64.b64decode(part["data"]), rate

    def synthesize(self, text, out_dir):
        ok, msg = self.is_configured()
        if not ok:
            raise VoiceNotConfigured(msg)
        import wave

        from .common import ffmpeg_bin, run_cmd, word_count
        cfg = self.ctx.cfg("voice.gemini", {}) or {}
        pcm, rate = self._request(text)
        out = out_dir / "voice.wav"
        with wave.open(str(out), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(rate)
            wf.writeframes(pcm)
        tempo = float(cfg.get("tempo", 1.0))
        if abs(tempo - 1.0) > 0.01 and ffmpeg_bin():  # chỉnh tốc độ, giữ nguyên cao độ
            tmp = out_dir / "voice_tempo.wav"
            res = run_cmd([ffmpeg_bin(), "-y", "-loglevel", "error", "-i", str(out),
                           "-af", f"atempo={tempo}", str(tmp)], timeout=120)
            if res.returncode == 0:
                tmp.replace(out)
        dur = media_duration(out) or len(pcm) / (2 * rate)
        if dur < 1.0:
            out.unlink(missing_ok=True)
            raise VoiceGenerationError("Gemini trả về âm thanh quá ngắn")
        # Phát hiện bất thường: đọc cả lời hướng dẫn phong cách, hoặc bỏ sót nội dung.
        expected = word_count(text) / 2.6
        if dur > expected * 2.2 or dur < expected * 0.4:
            out.unlink(missing_ok=True)
            raise VoiceGenerationError(
                f"Độ dài giọng đọc bất thường ({dur:.1f}s, dự kiến ~{expected:.0f}s) – có thể đã đọc cả lời "
                f"hướng dẫn hoặc bỏ sót câu. Hãy thử lại hoặc chỉnh voice.gemini.style_prompt.")
        return VoiceResult(out, dur, self.name)


class EspeakProvider(VoiceProvider):
    """eSpeak-NG – chạy offline, miễn phí, giữ đúng 6 thanh điệu nhưng giọng máy (robot).

    Chỉ nên dùng để thử quy trình (căn phụ đề, trộn nhạc). Không khuyến nghị đăng công khai.
    """
    name = "espeak"

    @staticmethod
    def _bin() -> str | None:
        import shutil
        return shutil.which("espeak-ng") or shutil.which("espeak")

    def is_configured(self):
        if not self._bin():
            return False, "Chưa cài espeak-ng (Ubuntu: sudo apt install espeak-ng; Windows/macOS: xem espeak-ng trên GitHub)"
        return True, "eSpeak-NG offline – giọng máy, CHỈ để thử nghiệm quy trình."

    def synthesize(self, text, out_dir):
        ok, msg = self.is_configured()
        if not ok:
            raise VoiceNotConfigured(msg)
        from .common import ffmpeg_bin, run_cmd
        cfg = self.ctx.cfg("voice.espeak", {}) or {}
        raw = out_dir / "voice_raw.wav"
        res = run_cmd([self._bin(), "-v", str(cfg.get("voice", "vi")), "-s", str(cfg.get("speed", 125)),
                       "-p", str(cfg.get("pitch", 30)), "-g", str(cfg.get("word_gap", 2)),
                       "-w", str(raw), text], timeout=120)
        if res.returncode != 0 or not raw.exists():
            raise VoiceGenerationError(f"espeak-ng lỗi: {res.stderr.strip()[:200]}")
        out = out_dir / "voice.wav"
        post = cfg.get("post_filter")
        if post and ffmpeg_bin():
            res = run_cmd([ffmpeg_bin(), "-y", "-loglevel", "error", "-i", str(raw), "-af", post,
                           "-ar", "48000", str(out)], timeout=120)
            if res.returncode != 0:
                raise VoiceGenerationError(f"Hậu xử lý âm thanh lỗi: {res.stderr.strip()[:200]}")
            raw.unlink(missing_ok=True)
        else:
            raw.replace(out)
        dur = media_duration(out)
        if not dur or dur < 1.0:
            raise VoiceGenerationError("espeak-ng trả về âm thanh rỗng")
        return VoiceResult(out, dur, self.name)


PROVIDERS = {p.name: p for p in (NoVoiceProvider, ManualVoiceProvider, EdgeTTSProvider, GoogleCloudTTSProvider,
                                 GeminiTTSProvider, EspeakProvider)}


def get_provider(ctx: Context, name: str | None = None) -> VoiceProvider:
    name = name or ctx.cfg("voice.provider", "none") or "none"
    if name not in PROVIDERS:
        raise ValueError(f"voice.provider không hợp lệ: {name}. Chọn một trong: {', '.join(PROVIDERS)}")
    return PROVIDERS[name](ctx)


def detect_silences(path: Path, noise_db: float = -35.0, min_dur: float = 0.2) -> list[tuple[float, float]]:
    """Trả về các khoảng lặng (bắt đầu, kết thúc) trong tệp âm thanh, dùng FFmpeg silencedetect."""
    from .common import ffmpeg_bin, run_cmd
    if not ffmpeg_bin():
        return []
    res = run_cmd([ffmpeg_bin(), "-hide_banner", "-i", str(path), "-af",
                   f"silencedetect=n={noise_db}dB:d={min_dur}", "-f", "null", "-"], timeout=120)
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", res.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", res.stderr)]
    out = []
    for i, st in enumerate(starts):
        out.append((max(0.0, st), ends[i] if i < len(ends) else media_duration(path) or st))
    return out


def align_sentences_by_silence(path: Path, text: str, duration: float) -> list[dict]:
    """Ước lượng mốc thời gian từng câu từ khoảng lặng thật trong giọng đọc.

    Trả về [] nếu không đủ khoảng lặng (khi đó phụ đề chia theo tỉ lệ ký tự).
    """
    from .subtitle_generator import split_sentences
    sentences = split_sentences(text)
    n = len(sentences)
    if n == 0:
        return []
    sil = detect_silences(path)
    speech_start, speech_end = 0.0, duration
    if sil and sil[0][0] <= 0.05:
        speech_start = sil[0][1]
        sil = sil[1:]
    if sil and sil[-1][1] >= duration - 0.05:
        speech_end = sil[-1][0]
        sil = sil[:-1]
    if n == 1:
        return [{"start": speech_start, "end": speech_end, "text": sentences[0]}]
    if len(sil) < n - 1:
        return []
    total_chars = sum(len(s) for s in sentences)
    span = speech_end - speech_start
    chosen: list[tuple[float, float]] = []
    cum, idx = 0, 0
    for k in range(n - 1):
        cum += len(sentences[k])
        expected = speech_start + span * cum / total_chars
        remaining_needed = (n - 1) - k - 1
        candidates = sil[idx: len(sil) - remaining_needed]
        if not candidates:
            return []
        best = min(range(len(candidates)),
                   key=lambda j: abs((candidates[j][0] + candidates[j][1]) / 2 - expected)
                   - 0.5 * (candidates[j][1] - candidates[j][0]))
        chosen.append(candidates[best])
        idx += best + 1
    timings, start = [], speech_start
    for i, s in enumerate(sentences):
        end = chosen[i][0] if i < n - 1 else speech_end
        timings.append({"start": round(start, 3), "end": round(max(end, start + 0.3), 3), "text": s})
        if i < n - 1:
            start = chosen[i][1]
    return timings


def existing_voice(out_dir: Path) -> Path | None:
    for n in MANUAL_NAMES:
        if (out_dir / n).exists():
            return out_dir / n
    return None


def generate_voice(ctx: Context, script: str, out_dir: Path, provider_name: str | None = None,
                   force: bool = False) -> VoiceResult | None:
    """Sinh giọng đọc. Trả về None nếu chưa cấu hình (không phải lỗi)."""
    provider = get_provider(ctx, provider_name)
    out_dir.mkdir(parents=True, exist_ok=True)
    if not force and provider.name != "none":
        prev = existing_voice(out_dir)
        if prev and (out_dir / "voice_meta.json").exists():
            from .common import read_json
            meta = read_json(out_dir / "voice_meta.json", {})
            return VoiceResult(prev, meta.get("duration") or media_duration(prev) or 0.0,
                               meta.get("provider", provider.name), meta.get("sentence_timings", []))
    try:
        result = provider.synthesize(script, out_dir)
    except VoiceNotConfigured:
        return None
    timing_source = "tts" if result.sentence_timings else None
    if not result.sentence_timings:
        result.sentence_timings = align_sentences_by_silence(result.path, script, result.duration)
        timing_source = "silence_detect" if result.sentence_timings else "proportional"
    write_json(out_dir / "voice_meta.json", {"timing_source": timing_source,
        "provider": result.provider, "duration": round(result.duration, 3),
        "file": result.path.name, "sentence_timings": result.sentence_timings,
    })
    return result
