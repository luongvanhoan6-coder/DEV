"""1. Đọc/ghi CSV · 2. Phát hiện trùng · 3. Kiểm tra nguồn · chọn câu cho lô."""
from src import quote_manager as qm
from src.common import QUOTE_FIELDS, read_csv, write_csv


def test_csv_roundtrip_vietnamese(tmp_path):
    p = tmp_path / "x.csv"
    rows = [{"quote_id": "QA0001", "original_quote": "Tri túc giả phú, “biết đủ”, có dấu phẩy\nvà xuống dòng"}]
    write_csv(p, rows, QUOTE_FIELDS)
    back = read_csv(p)
    assert back[0]["original_quote"] == rows[0]["original_quote"]
    assert back[0]["topic"] == ""
    assert p.read_bytes().startswith(b"\xef\xbb\xbf")  # BOM để Excel mở đúng tiếng Việt


def test_seed_data_valid(project):
    rows = qm.load_quotes(project)
    assert len(rows) >= 30
    assert set(QUOTE_FIELDS) <= set(rows[0])
    dup = qm.find_duplicates(rows)
    assert dup.ok, dup.exact
    statuses = {r["source_status"] for r in rows}
    assert "NEEDS_VERIFICATION" in statuses  # có mẫu minh họa câu cần xác minh
    for r in rows:
        if r["source_status"] in ("SOURCE_CITED", "VERIFIED"):
            assert r["source_title"] and r["source_reference"], r["quote_id"]


def test_duplicate_detection_exact_and_near():
    rows = [
        {"quote_id": "Q1", "original_quote": "Tri túc giả phú.", "translation_vi": "Người biết đủ là người giàu."},
        {"quote_id": "Q2", "original_quote": "tri tuc gia phu", "translation_vi": ""},
        {"quote_id": "Q3", "original_quote": "Người biết đủ là người giàu có.", "translation_vi": ""},
        {"quote_id": "Q4", "original_quote": "Thượng thiện nhược thủy.", "translation_vi": ""},
    ]
    rep = qm.find_duplicates(rows)
    assert ("Q1", "Q2") in rep.exact
    assert any({a, b} == {"Q1", "Q3"} for a, b, _ in rep.near)
    assert not any("Q4" in (a, b) for a, b, _ in rep.near)


def test_import_skips_duplicates_and_downgrades_unsourced(project):
    res = qm.import_rows(project, [
        {"topic": "E", "original_quote": "Tri túc giả phú.", "author": "Lão Tử", "source_status": "SOURCE_CITED",
         "source_title": "Đạo Đức Kinh", "source_reference": "Chương 33"},  # trùng
        {"topic": "A", "original_quote": "Câu mới hoàn toàn để thử nghiệm.", "author": "Khuyết danh",
         "source_status": "SOURCE_CITED"},  # thiếu nguồn -> hạ cấp
        {"topic": "Z", "original_quote": "Chủ đề sai"},
    ])
    assert len(res.skipped_duplicates) == 1
    assert len(res.added) == 1 and len(res.invalid) == 1
    new = next(r for r in qm.load_quotes(project) if r["quote_id"] == res.added[0])
    assert new["source_status"] == "NEEDS_VERIFICATION"
    assert new["quote_id"].startswith("QA")


def test_source_check_rules():
    ok = {"quote_id": "X", "topic": "A", "original_quote": "abc", "author": "Lão Tử",
          "source_status": "SOURCE_CITED", "source_title": "Đạo Đức Kinh", "source_reference": "Chương 8"}
    assert qm.check_source(ok) == []
    assert qm.check_source({**ok, "source_status": "NEEDS_VERIFICATION"})
    assert qm.check_source({**ok, "source_status": "BIA_DAT"})
    assert qm.check_source({**ok, "source_reference": ""})
    # gán cho danh nhân mà ghi "lưu truyền" và không có nguồn -> chặn
    assert qm.check_source({**ok, "author": "Đức Phật", "source_status": "TRADITIONAL", "source_title": ""})


def test_select_quotes_rotates_topics_and_skips_blocked(project):
    chosen = qm.select_quotes(project, 5)
    assert len(chosen) == 5
    assert len({c["topic"] for c in chosen}) == 5
    assert all(c["source_status"] != "NEEDS_VERIFICATION" for c in chosen)


def test_used_quotes_not_reused_and_release(project):
    first = [q["quote_id"] for q in qm.select_quotes(project, 5)]
    qm.set_usage(project, first, "RESERVED", "RUN_TEST")
    second = [q["quote_id"] for q in qm.select_quotes(project, 5)]
    assert not set(first) & set(second)
    qm.set_usage(project, first[:2], "PRODUCED")
    assert sorted(qm.release_run(project, "RUN_TEST")) == sorted(first[2:])
    third = {q["quote_id"] for q in qm.select_quotes(project, 60)}
    assert not set(first[:2]) & third          # đã sản xuất -> không dùng lại
    with_reuse = {q["quote_id"] for q in qm.select_quotes(project, 60, allow_reuse=True)}
    assert set(first[:2]) <= with_reuse       # trừ khi người dùng cho phép


def test_select_by_id_rejects_unverified(project):
    blocked = next(r for r in qm.load_quotes(project) if r["source_status"] == "NEEDS_VERIFICATION")
    try:
        qm.select_quotes(project, 1, quote_ids=[blocked["quote_id"]])
    except ValueError as exc:
        assert blocked["quote_id"] in str(exc)
    else:
        raise AssertionError("Phải từ chối câu chưa xác minh nguồn")


def test_export(project, tmp_path):
    n = qm.export_csv(project, tmp_path / "e.csv", topic="G")
    assert n == len(read_csv(tmp_path / "e.csv")) > 0
