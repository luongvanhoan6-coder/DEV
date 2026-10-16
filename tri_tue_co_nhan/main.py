#!/usr/bin/env python3
"""CLI hệ thống sản xuất video TRÍ TUỆ CỔ NHÂN – TƯ DUY AN LẠC.

Xem hướng dẫn đầy đủ: README.md  ·  Trợ giúp: python main.py -h
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):  # hiển thị tiếng Việt trên Windows
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src import (  # noqa: E402
    llm_client, pipeline, publishing_manager, quality_checker, quote_manager, reporting, voice_generator,
)
from src.common import (  # noqa: E402
    ANALYTICS_FIELDS, PUBLISHING_LOG_FIELDS, QUEUE_FIELDS, TOPICS, ffmpeg_bin, ffprobe_bin, find_font,
    load_context, write_csv,
)
from src.platforms import PUBLISHERS  # noqa: E402
from src.production_queue import latest_run_id, set_voice_profile, videos_for_run  # noqa: E402

OK, WARN, ERR = "✅", "⚠️ ", "❌"


def _run_id(ctx, args) -> str:
    rid = getattr(args, "run_id", None) or latest_run_id(ctx)
    if not rid:
        sys.exit(f"{ERR} Chưa có lần chạy nào. Hãy chạy: python main.py daily  (hoặc content generate)")
    return rid


# ---------------------------------------------------------------- init / doctor
def cmd_init(ctx, args):
    for d in ["config", "data", "assets/backgrounds", "assets/music", "assets/fonts", "assets/logo", "scripts",
              "templates/prompts", "templates/subtitles", "output/drafts", "output/approved", "output/videos",
              "output/subtitles", "output/publishing_packages", "reports/quality_reports", "reports/runs", "tests"]:
        ctx.path(d).mkdir(parents=True, exist_ok=True)
    if not ctx.path("data", "quotes.csv").exists():
        subprocess.run([sys.executable, str(ROOT / "scripts" / "build_seed_quotes.py")], check=True)
    for name, fields in (("content_queue.csv", QUEUE_FIELDS), ("publishing_log.csv", PUBLISHING_LOG_FIELDS),
                         ("analytics.csv", ANALYTICS_FIELDS)):
        p = ctx.path("data", name)
        if not p.exists():
            write_csv(p, [], fields)
    lic = ctx.path("assets", "LICENSES.csv")
    if not lic.exists():
        write_csv(lic, [], ["file", "source_url", "license", "author", "downloaded_at", "notes"])
    fb = ctx.path("reports", "FEEDBACK_LOOP.md")
    if not fb.exists():
        fb.write_text(reporting.FEEDBACK_HEADER, encoding="utf-8")
    env = ctx.path(".env")
    if not env.exists() and ctx.path(".env.example").exists():
        shutil.copy2(ctx.path(".env.example"), env)
        print(f"{OK} Tạo .env từ .env.example (điền API key nếu dùng dịch vụ tùy chọn)")
    if args.demo_assets:
        subprocess.run([sys.executable, str(ROOT / "scripts" / "generate_placeholder_assets.py"),
                        "--root", str(ctx.root)], check=True)
    print(f"{OK} Khởi tạo xong cấu trúc dự án tại {ctx.root}")
    cmd_doctor(ctx, args)


def cmd_doctor(ctx, args):
    print("\n=== KIỂM TRA MÔI TRƯỜNG ===")
    print(f"{OK if sys.version_info >= (3, 10) else ERR} Python {sys.version.split()[0]} (cần ≥ 3.10)")
    print(f"{OK if ffmpeg_bin() else ERR} ffmpeg: {ffmpeg_bin() or 'KHÔNG TÌM THẤY'}")
    print(f"{OK if ffprobe_bin() else ERR} ffprobe: {ffprobe_bin() or 'KHÔNG TÌM THẤY'}")
    font = find_font(ctx)
    print(f"{OK if font else ERR} Phông chữ tiếng Việt: {font or 'không có'}")
    provider = voice_generator.get_provider(ctx)
    ok, msg = provider.is_configured()
    print(f"{OK if ok else WARN} Giọng đọc ({provider.name}): {msg}")
    cprov = ctx.cfg("content.provider")
    if cprov == "anthropic":
        print(f"{OK if llm_client.is_configured() else WARN} Claude API: "
              f"{'sẵn sàng (TÍNH PHÍ)' if llm_client.is_configured() else 'chưa cấu hình – sẽ dùng mẫu có sẵn'}")
    else:
        print(f"{OK} Nội dung: dùng CSV + mẫu có sẵn (miễn phí)")
    assets = quality_checker.check_assets(ctx)
    c = assets["counts"]
    print(f"{OK if c['backgrounds'] else ERR} Hình nền: {c['backgrounds']} (placeholder: {c['backgrounds_placeholder']})")
    print(f"{OK if c['music'] else WARN} Nhạc nền: {c['music']} (placeholder: {c['music_placeholder']})")
    for e in assets["errors"]:
        print(f"{ERR} {e}")
    for w in assets["warnings"]:
        print(f"{WARN} {w}")
    for name, cls in PUBLISHERS.items():
        ok, missing = cls().is_configured()
        print(f"ℹ️  Đăng tự động {name}: CHƯA KÍCH HOẠT (đăng thủ công bằng gói nội dung)")


# ---------------------------------------------------------------- quotes
def cmd_quotes(ctx, args):
    if args.qcmd == "list":
        rows = quote_manager.load_quotes(ctx)
        rows = [r for r in rows if (not args.topic or r["topic"] == args.topic)
                and (not args.status or r["source_status"] == args.status)
                and (not args.usage or (r["usage_status"] or "AVAILABLE") == args.usage)]
        for r in rows[: args.limit]:
            text = r["translation_vi"] or r["original_quote"]
            print(f"{r['quote_id']} [{r['topic']}] [{r['source_status']}] [{r['usage_status']}] "
                  f"{text[:70]}{'…' if len(text) > 70 else ''} — {r['author']}")
        print(f"\nTổng: {len(rows)} câu (hiển thị tối đa {args.limit})")
    elif args.qcmd == "stats":
        s = quote_manager.stats(quote_manager.load_quotes(ctx))
        print(f"Tổng: {s['total']} / mục tiêu {s['target_total']}\n")
        for t, v in s["by_topic"].items():
            print(f"  {t}. {v['name']:<28} {v['have']:>4} / {v['target']}")
        print(f"\nTrạng thái nguồn: {s['by_source_status']}\nTrạng thái sử dụng: {s['by_usage']}")
    elif args.qcmd == "check":
        rows = quote_manager.load_quotes(ctx)
        dup = quote_manager.find_duplicates(rows)
        src = quote_manager.source_report(ctx, rows)
        print(f"{OK if dup.ok else ERR} Trùng lặp chính xác: {len(dup.exact)}; trùng mã: {len(dup.duplicate_ids)}")
        for a, b in dup.exact:
            print(f"   {a} == {b}")
        print(f"{OK if not dup.near else WARN} Gần giống (cần xem lại): {len(dup.near)}")
        for a, b, r in dup.near:
            print(f"   {a} ~ {b} ({r})")
        print(f"{OK if not src else WARN} Câu bị chặn khỏi sản xuất do nguồn: {len(src)}")
        for qid, probs in src.items():
            print(f"   {qid}: {'; '.join(probs)}")
    elif args.qcmd == "import":
        if args.gsheet:
            res = quote_manager.import_google_sheet(ctx, dry_run=args.dry_run)
        else:
            if not args.file:
                sys.exit("Cần đường dẫn tệp CSV hoặc --gsheet")
            res = quote_manager.import_csv_file(ctx, Path(args.file), dry_run=args.dry_run)
        print(f"{OK} Thêm: {len(res.added)} {'(chạy thử, chưa ghi)' if args.dry_run else ''}")
        print(f"{WARN} Bỏ qua do trùng: {len(res.skipped_duplicates)} {res.skipped_duplicates[:10]}")
        print(f"{WARN} Cần xác minh nguồn: {len(res.flagged_needs_verification)}")
        print(f"{ERR} Không hợp lệ: {len(res.invalid)} {res.invalid[:10]}")
    elif args.qcmd == "export":
        n = quote_manager.export_csv(ctx, Path(args.file), args.topic, args.status)
        print(f"{OK} Đã xuất {n} câu ra {args.file}")
    elif args.qcmd == "release":
        rel = quote_manager.release_run(ctx, args.run_id)
        print(f"{OK} Trả lại {len(rel)} câu về AVAILABLE: {', '.join(rel)}")


# ---------------------------------------------------------------- pipeline
def _print_run(ctx, run_id):
    vids = videos_for_run(ctx, run_id)
    print(f"\nRun: {run_id}")
    for v in vids:
        voice = "có giọng" if v.get("has_voice") == "yes" else "chưa có giọng"
        print(f"  {v['video_id']:<28} {v['status']:<10} {voice:<14} {v.get('template', ''):<10} "
              f"{(v.get('error') or '')[:90]}")


def cmd_content(ctx, args):
    manifest = pipeline.load_manifest(ctx, args.run_id or pipeline.new_run_id(ctx))
    ids = pipeline.run_content(ctx, manifest, args.count, allow_reuse=args.allow_reuse, topic=args.topic,
                               quote_ids=args.quote_ids.split(",") if args.quote_ids else None,
                               use_llm=True if args.use_llm else None)
    pipeline.summarize(ctx, manifest)
    print(f"{OK} Tạo nội dung cho {len(ids)} video – run_id: {manifest['run_id']}")
    print(f"   Thư mục nháp: output/drafts/{manifest['run_id']}/")


def cmd_voice(ctx, args):
    if args.vcmd == "profiles":
        for k, label in voice_generator.list_profiles(ctx).items():
            mark = " (mặc định)" if k == ctx.cfg("voice.default_profile") else ""
            print(f"  {k:<14} {label}{mark}")
        return
    if args.vcmd == "set":
        rid = _run_id(ctx, args)
        vids = videos_for_run(ctx, rid)
        if args.profiles:
            names = [p.strip() for p in args.profiles.split(",")]
            if len(names) != len(vids):
                sys.exit(f"{ERR} Cần {len(vids)} hồ sơ (theo thứ tự video), nhận {len(names)}")
            pairs = list(zip([v["video_id"] for v in vids], names))
        elif args.video_id and args.profile:
            pairs = [(args.video_id, args.profile)]
        else:
            sys.exit("Dùng --video-id <ID> --profile <hồ sơ>, hoặc --profiles p1,p2,...")
        for vid, prof in pairs:
            changed = set_voice_profile(ctx, vid, prof)
            print(f"{OK} {vid}: {prof}" + ("" if changed else " (giữ nguyên, không cần dựng lại)"))
        print(f"   Tạo lại giọng + dựng lại: python main.py daily --resume {rid}")
        return
    if args.vcmd == "test":
        out_dir = ctx.path("output", "voice_test")
        out_dir.mkdir(parents=True, exist_ok=True)
        for f in out_dir.glob("voice.*"):
            f.unlink()
        provider = voice_generator.get_provider(ctx, args.provider)
        ok, msg = provider.is_configured()
        print(f"{OK if ok else WARN} {provider.name}: {msg}")
        try:
            res = voice_generator.generate_voice(ctx, args.text, out_dir, provider_name=provider.name, force=True,
                                                 profile=args.profile)
        except voice_generator.VoiceGenerationError as exc:
            sys.exit(f"{ERR} {exc}")
        if not res:
            sys.exit(f"{ERR} Chưa tạo được giọng đọc. Xem docs/HUONG_DAN_GIONG_DOC.md")
        print(f"{OK} Tạo {res.path.relative_to(ctx.root)} ({res.duration:.1f}s) – hãy nghe thử trước khi sản xuất.")
        return
    rid = _run_id(ctx, args)
    manifest = pipeline.load_manifest(ctx, rid)
    pipeline.run_voice_and_subtitles(ctx, manifest, force=args.force)
    pipeline.summarize(ctx, manifest)
    _print_run(ctx, rid)


def cmd_video(ctx, args):
    rid = getattr(args, "run_id", None) or latest_run_id(ctx)
    if not rid or (args.count and not args.run_id and all(
            v["status"] not in ("DRAFT", "VOICED", "SUBTITLED", "QC_FAILED") for v in videos_for_run(ctx, rid))):
        rid = None
    if rid is None:  # chưa có lô đang dở -> tạo lô mới
        print("Không có lô đang chờ dựng – tạo nội dung mới trước.")
        manifest = pipeline.load_manifest(ctx, pipeline.new_run_id(ctx))
        pipeline.run_content(ctx, manifest, args.count or int(ctx.cfg("production.videos_per_day", 5)))
    else:
        manifest = pipeline.load_manifest(ctx, rid)
    pipeline.run_voice_and_subtitles(ctx, manifest, force=args.force)
    pipeline.run_render(ctx, manifest, force=args.force)
    pipeline.summarize(ctx, manifest)
    _print_run(ctx, manifest["run_id"])


def cmd_quality(ctx, args):
    rid = _run_id(ctx, args)
    manifest = pipeline.load_manifest(ctx, rid)
    results = pipeline.run_quality(ctx, manifest, force=args.force)
    pipeline.summarize(ctx, manifest)
    for vid, r in results.items():
        print(f"{OK if r['status'] == 'PASS' else ERR} {vid}: {r['status']}"
              + (f" – {'; '.join(r['errors'])}" if r["errors"] else "")
              + (f"\n   {WARN} {'; '.join(r['warnings'])}" if r["warnings"] else ""))
    print(f"\nBáo cáo: reports/quality_reports/{rid}.md")


def cmd_daily(ctx, args):
    if args.voice_provider:
        ctx.settings["voice"]["provider"] = args.voice_provider
    manifest = pipeline.run_daily(ctx, count=args.count, resume=args.resume, force=args.force,
                                  allow_reuse=args.allow_reuse)
    reporting.update_feedback_loop(ctx, manifest)
    s = manifest["summary"]
    _print_run(ctx, manifest["run_id"])
    icon = OK if not s["videos_failed"] else (WARN if s["videos_succeeded"] else ERR)
    print(f"\n{icon} Đã chạy bước 1–8. Thành công (qua QC): {s['videos_succeeded']}/{s['quotes_processed']}; "
          f"có giọng đọc: {s['with_voice']}.")
    print(f"   Báo cáo chất lượng: reports/quality_reports/{manifest['run_id']}.md")
    if s["videos_succeeded"]:
        print("   Bước tiếp theo: xem video trong output/videos/, rồi duyệt:")
        print(f"   python main.py approve --run-id {manifest['run_id']} --all-passed")
    if s["videos_failed"]:
        print(f"   Chạy tiếp phần lỗi: python main.py daily --resume {manifest['run_id']}")


def cmd_approve(ctx, args):
    if args.video_id:
        for vid in args.video_id:
            try:
                dest = publishing_manager.approve(ctx, vid, allow_no_voice=args.allow_no_voice, note=args.note or "")
                print(f"{OK} Đã duyệt {vid} -> {dest.relative_to(ctx.root)}")
            except publishing_manager.ApprovalError as exc:
                print(f"{ERR} {exc}")
    elif args.all_passed:
        ok, failed = publishing_manager.approve_run(ctx, _run_id(ctx, args), allow_no_voice=args.allow_no_voice)
        print(f"{OK} Đã duyệt: {len(ok)}")
        for vid, why in failed.items():
            print(f"{ERR} {vid}: {why}")
    else:
        sys.exit("Chỉ định --video-id <ID> hoặc --all-passed")


def cmd_reject(ctx, args):
    publishing_manager.reject(ctx, args.video_id, args.reason)
    print(f"{OK} Đã đánh dấu từ chối {args.video_id}. Sửa nội dung rồi chạy lại: python main.py daily --resume <run_id> --force")


def cmd_package(ctx, args):
    dirs = publishing_manager.package(ctx, run_id=args.run_id, publish_date=args.date)
    if not dirs:
        print(f"{WARN} Không có video nào ở trạng thái APPROVED cần đóng gói.")
        return
    for d in dirs:
        print(f"{OK} Gói nội dung: {d.relative_to(ctx.root)}  (lịch gợi ý: schedule.csv)")
    print("   Video CHƯA được đăng. Đăng thủ công/lên lịch theo checklist.md, sau đó ghi nhận bằng lệnh 'published'.")


def cmd_published(ctx, args):
    publishing_manager.mark_published(ctx, args.video_id, args.platform, args.url, args.note or "")
    print(f"{OK} Đã ghi nhận {args.video_id} đăng trên {args.platform}: {args.url}")


def cmd_report(ctx, args):
    rid = _run_id(ctx, args)
    manifest = reporting.run_report(ctx, rid)
    s = manifest["summary"]
    print(f"{OK} Cập nhật reports/FEEDBACK_LOOP.md và reports/runs/{rid}.json")
    print(f"   Câu xử lý: {s['quotes_processed']} · Thành công: {s['videos_succeeded']} · Lỗi: {s['videos_failed']} "
          f"· Thời gian: {s['total_seconds']}s")
    if args.analytics:
        out = reporting.analytics_report(ctx)
        print(f"{OK} Báo cáo Analytics: {out.relative_to(ctx.root)}" if out
              else f"{WARN} Chưa có dữ liệu Analytics (python main.py analytics import <file.csv>)")


def cmd_status(ctx, args):
    _print_run(ctx, _run_id(ctx, args))


def cmd_cost(ctx, args):
    est = reporting.estimate_costs(ctx, args.videos_per_day)
    print(f"Ước tính cho {est['videos_per_day']} video/ngày ≈ {est['videos_per_month']} video/tháng "
          f"(~{est['avg_chars_per_video']} ký tự lời đọc/video)\n")
    for i in est["items"]:
        flag = "ĐANG BẬT" if i["enabled"] else "tắt"
        paid = "tính phí" if i["paid"] else "miễn phí"
        print(f" - {i['item']:<45} [{flag}, {paid}] ≈ {i['vnd_month']:>10,.0f} đ/tháng (${i['usd_month']})")
        print(f"     {i['note']}")
    print(f"\nCấu hình hiện tại: ≈ {est['current_config_vnd_month']:,.0f} đ/tháng · "
          f"Bật tất cả tùy chọn trả phí: ≈ {est['all_paid_options_vnd_month']:,.0f} đ/tháng · Ngân sách: 500.000 đ")
    print(f"Lưu ý: {est['disclaimer']}")


def cmd_analytics(ctx, args):
    if args.acmd == "import":
        n = reporting.import_analytics(ctx, Path(args.file))
        print(f"{OK} Nhập {n} dòng Analytics")
    else:
        out = reporting.analytics_report(ctx)
        print(f"{OK} {out.relative_to(ctx.root)}" if out else f"{WARN} Chưa có dữ liệu Analytics thật để báo cáo.")


def cmd_publishers(ctx, args):
    for name, cls in PUBLISHERS.items():
        p = cls()
        ok, missing = p.is_configured()
        print(f"\n== {name} ==  API: {p.official_api}")
        print("   Trạng thái: CHƯA KÍCH HOẠT (chưa cài đặt và chưa kiểm chứng)")
        print(f"   Biến môi trường {'đã đặt' if ok else 'còn thiếu: ' + ', '.join(missing)}")
        for s in p.setup_steps:
            print(f"   - {s}")


# ---------------------------------------------------------------- parser
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="main.py", description="Hệ thống video Trí Tuệ Cổ Nhân – Tư Duy An Lạc")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("init", help="Khởi tạo thư mục, dữ liệu mẫu, kiểm tra môi trường")
    s.add_argument("--demo-assets", action="store_true", help="Sinh hình nền/nhạc PLACEHOLDER để chạy thử")
    s.set_defaults(func=cmd_init)
    sub.add_parser("doctor", help="Kiểm tra môi trường và cấu hình").set_defaults(func=cmd_doctor)

    q = sub.add_parser("quotes", help="Quản lý kho câu nói")
    qs = q.add_subparsers(dest="qcmd", required=True)
    ql = qs.add_parser("list")
    ql.add_argument("--topic", choices=list(TOPICS))
    ql.add_argument("--status")
    ql.add_argument("--usage")
    ql.add_argument("--limit", type=int, default=100)
    qs.add_parser("stats")
    qs.add_parser("check", help="Kiểm tra trùng lặp và nguồn")
    qi = qs.add_parser("import", help="Nhập CSV (hoặc --gsheet)")
    qi.add_argument("file", nargs="?")
    qi.add_argument("--gsheet", action="store_true")
    qi.add_argument("--dry-run", action="store_true")
    qe = qs.add_parser("export")
    qe.add_argument("file")
    qe.add_argument("--topic", choices=list(TOPICS))
    qe.add_argument("--status")
    qr = qs.add_parser("release", help="Trả câu đang giữ chỗ của một run về AVAILABLE")
    qr.add_argument("--run-id", required=True)
    q.set_defaults(func=cmd_quotes)

    c = sub.add_parser("content", help="Tạo nội dung")
    cs = c.add_subparsers(dest="ccmd", required=True)
    cg = cs.add_parser("generate")
    cg.add_argument("--count", type=int, default=5)
    cg.add_argument("--topic", choices=list(TOPICS))
    cg.add_argument("--quote-ids", help="Danh sách quote_id, cách nhau bởi dấu phẩy")
    cg.add_argument("--allow-reuse", action="store_true", help="Cho phép dùng lại câu đã sản xuất")
    cg.add_argument("--use-llm", action="store_true", help="Dùng Claude API (tính phí) nếu đã cấu hình")
    cg.add_argument("--run-id")
    c.set_defaults(func=cmd_content)

    v = sub.add_parser("voice", help="Sinh giọng đọc + phụ đề")
    vs = v.add_subparsers(dest="vcmd", required=True)
    vg = vs.add_parser("generate")
    vg.add_argument("--run-id")
    vg.add_argument("--force", action="store_true")
    vt = vs.add_parser("test", help="Đọc thử một câu để kiểm tra cấu hình TTS")
    vt.add_argument("--provider", choices=list(voice_generator.PROVIDERS))
    vt.add_argument("--profile", help="Hồ sơ giọng (xem: python main.py voice profiles)")
    vs.add_parser("profiles", help="Liệt kê hồ sơ giọng")
    vset = vs.add_parser("set", help="Đổi giọng cho video của một run")
    vset.add_argument("--run-id")
    vset.add_argument("--video-id")
    vset.add_argument("--profile")
    vset.add_argument("--profiles", help="Danh sách theo thứ tự video, vd: nam_tram,nu_tram_am,nu_tram_am")
    vt.add_argument("--text", default="Người biết đủ là người giàu. Thắng người là có sức, thắng mình mới là mạnh.")
    v.set_defaults(func=cmd_voice)

    vd = sub.add_parser("video", help="Dựng video")
    vds = vd.add_subparsers(dest="vdcmd", required=True)
    vr = vds.add_parser("render")
    vr.add_argument("--run-id")
    vr.add_argument("--count", type=int)
    vr.add_argument("--force", action="store_true")
    vd.set_defaults(func=cmd_video)

    qc = sub.add_parser("quality-check", help="Kiểm tra chất lượng video của một run")
    qc.add_argument("--run-id")
    qc.add_argument("--force", action="store_true")
    qc.set_defaults(func=cmd_quality)

    d = sub.add_parser("daily", help="Chạy trọn quy trình bước 1–8 (dừng ở chờ phê duyệt)")
    d.add_argument("--count", type=int)
    d.add_argument("--resume", metavar="RUN_ID", help="Chạy tiếp một run bị lỗi, không tạo trùng")
    d.add_argument("--force", action="store_true")
    d.add_argument("--allow-reuse", action="store_true")
    d.add_argument("--voice-provider", choices=list(voice_generator.PROVIDERS),
                   help="Dùng tạm nhà cung cấp giọng đọc khác cho lần chạy này")
    d.set_defaults(func=cmd_daily)

    a = sub.add_parser("approve", help="Duyệt video đã qua QC")
    a.add_argument("--run-id")
    a.add_argument("--video-id", nargs="+")
    a.add_argument("--all-passed", action="store_true")
    a.add_argument("--allow-no-voice", action="store_true")
    a.add_argument("--note")
    a.set_defaults(func=cmd_approve)

    rj = sub.add_parser("reject", help="Từ chối video")
    rj.add_argument("--video-id", required=True)
    rj.add_argument("--reason", required=True)
    rj.set_defaults(func=cmd_reject)

    pk = sub.add_parser("package", help="Tạo gói đăng bài cho video đã duyệt")
    pk.add_argument("--run-id")
    pk.add_argument("--date", help="Ngày dự kiến đăng YYYY-MM-DD (mặc định: ngày mai)")
    pk.set_defaults(func=cmd_package)

    pb = sub.add_parser("published", help="Ghi nhận ĐÃ ĐĂNG (chỉ sau khi đăng thật)")
    pb.add_argument("--video-id", required=True)
    pb.add_argument("--platform", required=True, choices=["facebook_reels", "tiktok", "youtube_shorts"])
    pb.add_argument("--url", required=True)
    pb.add_argument("--note")
    pb.set_defaults(func=cmd_published)

    r = sub.add_parser("report", help="Cập nhật FEEDBACK_LOOP.md và manifest")
    r.add_argument("--run-id")
    r.add_argument("--analytics", action="store_true")
    r.set_defaults(func=cmd_report)

    st = sub.add_parser("status", help="Trạng thái các video của một run")
    st.add_argument("--run-id")
    st.set_defaults(func=cmd_status)

    co = sub.add_parser("cost", help="Ước tính chi phí hằng tháng")
    co.add_argument("--videos-per-day", type=int)
    co.set_defaults(func=cmd_cost)

    an = sub.add_parser("analytics", help="Nhập và báo cáo dữ liệu Analytics thật")
    ans = an.add_subparsers(dest="acmd", required=True)
    ai = ans.add_parser("import")
    ai.add_argument("file")
    ans.add_parser("report")
    an.set_defaults(func=cmd_analytics)

    sub.add_parser("publishers", help="Trạng thái tích hợp API đăng bài chính thức").set_defaults(func=cmd_publishers)
    return p


def main(argv=None) -> None:
    args = build_parser().parse_args(argv)
    ctx = load_context()
    try:
        args.func(ctx, args)
    except (ValueError, RuntimeError, FileNotFoundError) as exc:
        ctx.logger.error("%s: %s", args.cmd, exc)
        sys.exit(f"{ERR} {exc}")


if __name__ == "__main__":
    main()
