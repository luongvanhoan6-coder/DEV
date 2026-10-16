"""Sinh tài nguyên PLACEHOLDER (tự tạo bằng mã, không tải từ Internet) để chạy thử hệ thống.

- 6 hình nền phong cảnh cách điệu (núi sương, hồ, rừng trúc, sông, mây, sen) – 1620x2880.
- 1 đoạn nhạc nền ambient tổng hợp bằng FFmpeg (sóng sin, không dùng mẫu âm thanh có bản quyền).

Tên tệp bắt đầu bằng 'placeholder_' để hệ thống nhận biết và CẢNH BÁO khi dùng.
Hãy thay bằng ảnh/video/nhạc thật có giấy phép trước khi đăng công khai.

Chạy: python scripts/generate_placeholder_assets.py [--root <thư mục dự án>]
"""
from __future__ import annotations

import argparse
import math
import random
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1620, 2880


def sky(top, bottom):
    t = np.linspace(0, 1, H)[:, None, None]
    arr = (np.array(top)[None, None, :] * (1 - t) + np.array(bottom)[None, None, :] * t)
    return Image.fromarray(np.repeat(arr, W, axis=1).astype("uint8"), "RGB")


def ridge(rng, base_y, amp, color, alpha, blur, seed_shift=0.0):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    pts = []
    phases = [rng.uniform(0, 6.28) for _ in range(4)]
    for x in range(0, W + 20, 20):
        y = base_y
        for k, ph in enumerate(phases, start=1):
            y -= amp / k * math.sin(x / W * math.pi * (k + 0.5) + ph + seed_shift)
        pts.append((x, y))
    d.polygon(pts + [(W, H), (0, H)], fill=color + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def mist(img, y, height, strength):
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    for i in range(height):
        a = int(strength * math.sin(math.pi * i / height))
        d.line([(0, y + i), (W, y + i)], fill=a)
    white = Image.new("RGBA", (W, H), (235, 240, 245, 255))
    white.putalpha(m.filter(ImageFilter.GaussianBlur(30)))
    return Image.alpha_composite(img, white)


def mountains(rng, name, top, bottom, colors):
    img = sky(top, bottom).convert("RGBA")
    for i, c in enumerate(colors):
        img = Image.alpha_composite(img, ridge(rng, H * (0.42 + i * 0.12), 260 - i * 30, c, 255, 3 + i))
        img = mist(img, int(H * (0.40 + i * 0.12)), 260, 150)
    return img


def lake(rng):
    img = mountains(rng, "lake", (190, 170, 150), (240, 214, 170), [(120, 120, 135), (80, 88, 100)])
    top = img.crop((0, 0, W, int(H * 0.62)))
    refl = top.transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(4))
    water = Image.new("RGBA", (W, H - int(H * 0.62)), (0, 0, 0, 0))
    water.paste(refl.crop((0, 0, W, H - int(H * 0.62))), (0, 0))
    d = ImageDraw.Draw(water)
    for _ in range(140):
        y = rng.randint(0, water.height)
        x = rng.randint(0, W)
        d.line([(x, y), (x + rng.randint(40, 200), y)], fill=(255, 255, 255, 40), width=2)
    img.paste(water, (0, int(H * 0.62)))
    return img


def bamboo(rng):
    img = sky((40, 70, 50), (120, 160, 110)).convert("RGBA")
    for depth in range(3):
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        shade = 30 + depth * 35
        for _ in range(9 + depth * 4):
            x = rng.randint(-50, W)
            w = rng.randint(28, 60) - depth * 6
            d.rectangle([x, 0, x + w, H], fill=(shade, 70 + depth * 30, shade, 255))
            for y in range(rng.randint(0, 300), H, rng.randint(260, 380)):
                d.rectangle([x - 3, y, x + w + 3, y + 10], fill=(shade - 15, 55 + depth * 30, shade - 15, 255))
        img = Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(8 - depth * 3)))
        img = mist(img, int(H * 0.3), 900, 70)
    return img


def clouds(rng):
    img = sky((70, 110, 170), (230, 200, 170)).convert("RGBA")
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(60):
        x, y = rng.randint(-200, W), rng.randint(0, int(H * 0.8))
        r = rng.randint(120, 320)
        d.ellipse([x - r, y - r // 2, x + r, y + r // 2], fill=(255, 255, 255, rng.randint(40, 110)))
    return Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(40)))


def lotus(rng):
    img = sky((25, 45, 55), (60, 95, 90)).convert("RGBA")
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(18):  # lá sen
        x, y = rng.randint(0, W), rng.randint(int(H * 0.55), H)
        r = rng.randint(120, 260)
        d.ellipse([x - r, y - r // 3, x + r, y + r // 3], fill=(40, 110, 70, 230))
    cx, cy = W // 2, int(H * 0.62)
    for k in range(10):  # cánh hoa
        ang = math.pi * (0.15 + 0.7 * k / 9)
        px, py = cx + 170 * math.cos(ang) * -1, cy - 220 * math.sin(ang)
        d.ellipse([px - 70, py - 140, px + 70, py + 40], fill=(240, 170, 190, 235))
    d.ellipse([cx - 60, cy - 90, cx + 60, cy + 10], fill=(250, 220, 140, 255))
    img = Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(3)))
    return mist(img, int(H * 0.45), 500, 60)


def river(rng):
    img = mountains(rng, "river", (240, 190, 140), (250, 225, 190), [(150, 120, 110), (95, 80, 80)])
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    pts_l, pts_r = [], []
    for i in range(0, 101):
        t = i / 100
        y = H * (0.6 + 0.4 * t)
        cx = W / 2 + 260 * math.sin(t * 3.2)
        half = 30 + 600 * t
        pts_l.append((cx - half, y))
        pts_r.append((cx + half, y))
    d.polygon(pts_l + pts_r[::-1], fill=(250, 215, 170, 220))
    return Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(6)))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    args = ap.parse_args()
    root = Path(args.root)
    bg_dir, music_dir = root / "assets" / "backgrounds", root / "assets" / "music"
    bg_dir.mkdir(parents=True, exist_ok=True)
    music_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(2026)
    makers = {
        "placeholder_mountain_mist.jpg": lambda: mountains(rng, "m", (150, 170, 190), (225, 230, 235),
                                                           [(110, 125, 140), (75, 90, 105), (45, 58, 70)]),
        "placeholder_lake_water_reflection.jpg": lambda: lake(rng),
        "placeholder_bamboo_forest_zen.jpg": lambda: bamboo(rng),
        "placeholder_cloud_sky.jpg": lambda: clouds(rng),
        "placeholder_lotus_pond.jpg": lambda: lotus(rng),
        "placeholder_river_sunrise_village.jpg": lambda: river(rng),
    }
    for name, fn in makers.items():
        p = bg_dir / name
        if not p.exists():
            fn().convert("RGB").save(p, quality=90)
            print("Tạo", p)
    ffmpeg = shutil.which("ffmpeg")
    track = music_dir / "placeholder_ambient_pad.m4a"
    if ffmpeg and not track.exists():
        # hợp âm Am9 chậm, có tremolo nhẹ – tổng hợp hoàn toàn bằng sóng sin
        expr = ("0.10*sin(2*PI*110*t)+0.07*sin(2*PI*164.81*t)+0.06*sin(2*PI*220*t)"
                "+0.05*sin(2*PI*261.63*t)*(0.6+0.4*sin(2*PI*0.1*t))+0.04*sin(2*PI*329.63*t)*(0.5+0.5*sin(2*PI*0.07*t))"
                "+0.03*sin(2*PI*493.88*t)*(0.5+0.5*sin(2*PI*0.05*t))")
        cmd = [ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"aevalsrc={expr}:s=48000:d=40",
               "-af", "aecho=0.8:0.7:400|900:0.25|0.18,lowpass=f=2500,afade=t=in:d=3,afade=t=out:st=36:d=4,"
                      "aformat=channel_layouts=stereo,volume=1.6",
               "-c:a", "aac", "-b:a", "128k", str(track)]
        res = subprocess.run(cmd, capture_output=True, text=True)
        print("Tạo", track if res.returncode == 0 else f"LỖI nhạc nền: {res.stderr[-300:]}")
    elif not ffmpeg:
        print("Không có ffmpeg – bỏ qua nhạc nền placeholder.", file=sys.stderr)


if __name__ == "__main__":
    main()
