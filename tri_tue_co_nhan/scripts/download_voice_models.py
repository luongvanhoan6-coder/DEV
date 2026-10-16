"""Tải mô hình giọng đọc offline (Piper/VITS) từ GitHub Releases của k2-fsa/sherpa-onnx – có kiểm tra an toàn.

Mô hình hiện hỗ trợ:
  vi_VN-vais1000-medium – giọng NỮ tiếng Việt phổ thông (miền Bắc), 22,05 kHz.
    Dữ liệu huấn luyện: VAIS-1000 (CC BY 4.0 – được dùng thương mại, PHẢI ghi nguồn).
    Lưu ý: được tinh chỉnh từ giọng tiếng Anh "lessac" – tự đánh giá thêm giấy phép trước khi kiếm tiền.

Các bước kiểm tra (vì không tải được cơ sở dữ liệu virus ClamAV ở mọi môi trường):
  1. So khớp SHA-256 với giá trị đã ghim -> tệp không bị thay đổi so với bản đã được kiểm tra.
  2. Kiểm tra danh sách trong gói: không đường dẫn tuyệt đối/../, không liên kết, không tệp thực thi.
  3. Chỉ giải nén 3 tệp cần dùng (.onnx, .onnx.json, MODEL_CARD); không dùng espeak-ng-data đi kèm.
  4. Kiểm tra đầu tệp: không phải ELF/PE/Mach-O/script.
  5. Nếu có gói `onnx`: chỉ chấp nhận toán tử chuẩn (ai.onnx) và Gelu tích hợp của ONNX Runtime,
     không dữ liệu ngoài, không hàm tùy biến.
  6. Nếu có ClamAV và cơ sở dữ liệu virus: quét thêm bằng clamscan.

Chạy: python scripts/download_voice_models.py [--model vi_VN-vais1000-medium]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = {
    "vi_VN-vais1000-medium": {
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-vi_VN-vais1000-medium.tar.bz2",
        "sha256": "fa1367710767d36ed5cf13b4a449e20c35ffd12791c2e47c2e64142bfa55551a",
        "license": "Dữ liệu VAIS-1000: CC BY 4.0 (ghi nguồn khi dùng); tinh chỉnh từ giọng lessac",
        "gender": "nữ",
    },
}
KEEP_SUFFIXES = (".onnx", ".onnx.json", "MODEL_CARD")
EXEC_MAGIC = (b"\x7fELF", b"MZ", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa", b"\xcf\xfa\xed\xfe", b"#!")
ALLOWED_MS_OPS = {"Gelu"}


def fail(msg: str) -> None:
    sys.exit(f"❌ {msg}")


def check_onnx(path: Path) -> str:
    try:
        import onnx
        from onnx.external_data_helper import uses_external_data
    except ImportError:
        return "bỏ qua kiểm tra ONNX (chưa cài gói onnx: pip install onnx)"
    m = onnx.load(str(path), load_external_data=False)
    del m.metadata_props[:]  # sherpa-onnx ghi trùng khóa metadata – vô hại
    onnx.checker.check_model(m)
    bad = {(n.domain, n.op_type) for n in m.graph.node
           if n.domain not in ("", "ai.onnx") and not (n.domain == "com.microsoft" and n.op_type in ALLOWED_MS_OPS)}
    if bad:
        fail(f"Mô hình chứa toán tử ngoài danh sách cho phép: {bad}")
    if any(uses_external_data(t) for t in m.graph.initializer) or len(m.functions):
        fail("Mô hình tham chiếu dữ liệu ngoài/hàm tùy biến")
    return f"ONNX hợp lệ, {len(m.graph.node)} node, chỉ toán tử chuẩn"


def clamscan(path: Path) -> str:
    exe = shutil.which("clamscan")
    if not exe:
        return "không có ClamAV"
    res = subprocess.run([exe, "--no-summary", "-r", str(path)], capture_output=True, text=True)
    if res.returncode == 0:
        return "ClamAV: sạch"
    if res.returncode == 1:
        fail(f"ClamAV phát hiện mã độc: {res.stdout[:300]}")
    return "ClamAV không quét được (thiếu cơ sở dữ liệu virus – chạy freshclam)"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="vi_VN-vais1000-medium", choices=list(MODELS))
    args = ap.parse_args()
    info = MODELS[args.model]
    dest = ROOT / "assets" / "voices" / args.model
    print(f"Tải {info['url']}")
    with urllib.request.urlopen(info["url"], timeout=300) as r:
        data = r.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != info["sha256"]:
        fail(f"SHA-256 không khớp ({digest}) – tệp đã thay đổi, KHÔNG dùng.")
    print(f"✅ SHA-256 khớp ({len(data) / 1e6:.1f} MB)")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:bz2") as tar:
        members = tar.getmembers()
        for m in members:
            if m.name.startswith("/") or ".." in Path(m.name).parts:
                fail(f"Đường dẫn nguy hiểm trong gói: {m.name}")
            if m.issym() or m.islnk() or m.isdev():
                fail(f"Gói chứa liên kết/thiết bị: {m.name}")
            if m.isfile() and m.mode & 0o111:
                fail(f"Gói chứa tệp thực thi: {m.name}")
        wanted = [m for m in members if m.isfile() and m.name.endswith(KEEP_SUFFIXES)]
        dest.mkdir(parents=True, exist_ok=True)
        for m in wanted:
            content = tar.extractfile(m).read()
            if content.startswith(EXEC_MAGIC):
                fail(f"{m.name} có dấu hiệu là chương trình thực thi")
            (dest / Path(m.name).name).write_bytes(content)
    print(f"✅ Kiểm tra gói: {len(members)} mục, không đường dẫn nguy hiểm/liên kết/tệp thực thi; giữ {len(wanted)} tệp")
    onnx_file = next(dest.glob("*.onnx"))
    cfg = json.loads((dest / f"{onnx_file.name}.json").read_text(encoding="utf-8"))
    tones = [d for d in "123456" if d in cfg.get("phoneme_id_map", {})]
    if len(tones) < 6:
        fail("Mô hình thiếu ký hiệu thanh điệu – sẽ đọc sai dấu tiếng Việt")
    print(f"✅ Có đủ 6 ký hiệu thanh điệu; {check_onnx(onnx_file)}")
    print(f"ℹ️  {clamscan(dest)}")
    lic = ROOT / "assets" / "LICENSES.csv"
    rows = list(csv.DictReader(lic.open(encoding="utf-8-sig"))) if lic.exists() else []
    if not any(r.get("file") == onnx_file.name for r in rows):
        rows.append({"file": onnx_file.name, "source_url": info["url"], "license": info["license"],
                     "author": "rhasspy/piper; đóng gói: k2-fsa/sherpa-onnx", "downloaded_at": str(date.today()),
                     "notes": f"Giọng {info['gender']}; SHA-256 {info['sha256'][:16]}…"})
        with lic.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["file", "source_url", "license", "author", "downloaded_at", "notes"])
            w.writeheader()
            w.writerows(rows)
    print(f"✅ Lưu tại {dest.relative_to(ROOT)} – cần thêm: pip install piper-tts")


if __name__ == "__main__":
    main()
