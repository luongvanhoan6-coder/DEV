#!/usr/bin/env bash
# Bấm chạy file này (macOS / Linux) để tự cài + mở ZL-CRM tại http://localhost:3080
set -euo pipefail
cd "$(dirname "$0")"

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@zlcrm.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@123456}"
ADMIN_PHONE="${ADMIN_PHONE:-0900000000}"
ADMIN_NAME="${ADMIN_NAME:-Quan Tri Vien}"
ORG_NAME="${ORG_NAME:-ZL CRM}"
URL="http://localhost:3080"

command -v docker >/dev/null || { echo "Chưa có Docker. Cài Docker Desktop: https://www.docker.com/products/docker-desktop/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker chưa chạy. Mở Docker Desktop rồi chạy lại."; exit 1; }

if [ ! -d ZL-CRM ]; then
  git clone --depth 1 https://github.com/nguyentatkiem/ZL-CRM.git
fi
cp -f docker-compose.override.yml ZL-CRM/
cd ZL-CRM

if [ ! -f .env ]; then
  rnd() { head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-"$1"; }
  DBP=$(rnd 24); MINP=$(rnd 24)
  sed -e "s|^APP_URL=.*|APP_URL=$URL|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=$(rnd 64)|" \
      -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(rnd 64)|" \
      -e "s|^DB_PASSWORD=.*|DB_PASSWORD=$DBP|" \
      -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://crmuser:$DBP@db:5432/zalocrm|" \
      -e "s|^REDIS_URL=.*|# REDIS_URL=redis://redis:6379|" \
      -e "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=zlcrmadmin|" \
      -e "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$MINP|" \
      -e "s|^MINIO_ROOT_USER=.*|MINIO_ROOT_USER=zlcrmadmin|" \
      -e "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=$MINP|" \
      -e "s|^BOOTSTRAP_ADMIN_PHONE=.*|BOOTSTRAP_ADMIN_PHONE=$ADMIN_PHONE|" \
      -e "s|^BOOTSTRAP_ADMIN_PASSWORD=.*|BOOTSTRAP_ADMIN_PASSWORD=$ADMIN_PASSWORD|" \
      -e "s|^BOOTSTRAP_ADMIN_NAME=.*|BOOTSTRAP_ADMIN_NAME=$ADMIN_NAME|" \
      -e "s|^BOOTSTRAP_ADMIN_EMAIL=.*|BOOTSTRAP_ADMIN_EMAIL=$ADMIN_EMAIL|" \
      -e "s|^BOOTSTRAP_ORG_NAME=.*|BOOTSTRAP_ORG_NAME=$ORG_NAME|" \
      .env.example > .env
fi

echo "Đang khởi động ZL-CRM (lần đầu mất 5-10 phút để build)..."
docker compose up -d --build

echo "Chờ ứng dụng sẵn sàng..."
for i in $(seq 1 180); do
  curl -sf "$URL/api/v1/setup/status" >/dev/null 2>&1 && break
  sleep 2
done


echo "======================================"
echo " ZL-CRM: $URL"
echo " Email:    $ADMIN_EMAIL  (hoặc SĐT $ADMIN_PHONE)"
echo " Mật khẩu: $ADMIN_PASSWORD"
echo "======================================"
(command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || true
