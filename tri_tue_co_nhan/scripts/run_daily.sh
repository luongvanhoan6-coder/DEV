#!/usr/bin/env bash
# Chạy quy trình hằng ngày (bước 1–8) rồi cập nhật báo cáo. Dùng với cron (Linux/macOS):
#   crontab -e
#   30 5 * * * /đường/dẫn/tri_tue_co_nhan/scripts/run_daily.sh >> /đường/dẫn/tri_tue_co_nhan/reports/logs/cron.log 2>&1
# (5:30 sáng theo giờ máy; đặt máy về múi giờ Asia/Ho_Chi_Minh hoặc thêm CRON_TZ=Asia/Ho_Chi_Minh)
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3}"
[ -x ".venv/bin/python" ] && PY=".venv/bin/python"
mkdir -p reports/logs
"$PY" main.py daily
"$PY" main.py report
