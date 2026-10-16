"""Giao diện nhà cung cấp giọng đọc (TTS) có thể thay thế.

Nhà cung cấp hỗ trợ (voice.provider trong config/settings.yaml):
  none         – chưa cấu hình: KHÔNG tạo âm thanh; vẫn có voice_script.txt + SRT.
  manual       – bạn tự thu âm, đặt voice.mp3 / voice.wav / voice.m4a vào thư mục nháp của video.
  edge_tts     – Microsoft Edge Read-Aloud qua gói `edge-tts` (miễn phí, KHÔNG phải API chính thức).
  google_cloud – Google Cloud Text-to-Speech REST API (chính thức; cần GOOGLE_TTS_API_KEY).

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


PROVIDERS = {p.name: p for p in (NoVoiceProvider, ManualVoiceProvider, EdgeTTSProvider, GoogleCloudTTSProvider)}


def get_provider(ctx: Context, name: str | None = None) -> VoiceProvider:
    name = name or ctx.cfg("voice.provider", "none") or "none"
    if name not in PROVIDERS:
        raise ValueError(f"voice.provider không hợp lệ: {name}. Chọn một trong: {', '.join(PROVIDERS)}")
    return PROVIDERS[name](ctx)


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
    write_json(out_dir / "voice_meta.json", {
        "provider": result.provider, "duration": round(result.duration, 3),
        "file": result.path.name, "sentence_timings": result.sentence_timings,
    })
    return result
