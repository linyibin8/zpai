#!/usr/bin/env bash
#
# zpai 后端一键部署脚本（从本机执行）。
#
# 流程：
#   1. 本地构建 server + console
#   2. rsync/scp 到服务机 ydz@100.64.0.13:/home/ydz/apps/zpai
#   3. 远端 npm ci --production + 启动/重启 PM2
#   4. （可选）配置 VPS nginx + certbot
#
# 注意：.env 由人工在服务机配置，不在脚本里传递。
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
SERVICE_HOST="${SERVICE_HOST:-ydz@100.64.0.13}"
SERVICE_DIR="${SERVICE_DIR:-/home/ydz/apps/zpai}"
VPS_HOST="${VPS_HOST:-ubuntu@100.64.0.8}"

echo "=== [1/4] build (server + console) ==="
npm --workspace @zpai/shared run build
npm --workspace @zpai/server run build
npm --workspace @zpai/console run build

echo "=== [2/4] sync to service host ==="
rsync -avz --delete \
  --exclude node_modules \
  --exclude data \
  --exclude uploads \
  --exclude .env \
  --exclude .git \
  ./ "${SERVICE_HOST}:${SERVICE_DIR}/"

echo "=== [3/4] install deps + restart pm2 on service host ==="
ssh "${SERVICE_HOST}" bash <<REMOTE
set -e
cd ${SERVICE_DIR}
npm ci --omit=dev 2>/dev/null || npm install --omit=dev
# console 产物供 server 静态托管
cp -r apps/console/dist apps/console/dist 2>/dev/null || true
cd apps/server
if pm2 describe zpai >/dev/null 2>&1; then
  pm2 restart zpai
else
  pm2 start ../../infra/pm2/zpai.json
  pm2 save
fi
pm2 logs zpai --lines 5 --nostream
REMOTE

echo "=== [4/4] verify health ==="
sleep 2
curl -fsS http://100.64.0.13:8787/api/health && echo "" || echo "WARN: 内网 health 检查失败"

echo ""
echo "若首次部署，请在 VPS 上配置 nginx + 证书："
echo "  ssh ${VPS_HOST}"
echo "  sudo cp /tmp/zpai.conf /etc/nginx/sites-available/zpai.evowit.com.conf"
echo "  sudo ln -sf /etc/nginx/sites-available/zpai.evowit.com.conf /etc/nginx/sites-enabled/"
echo "  sudo certbot --nginx -d zpai.evowit.com --non-interactive --agree-tos -m 269123786@qq.com --redirect"
echo "  sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "DNS（首次）：TENCENT_SECRET_ID=.. TENCENT_SECRET_KEY=.. python3 infra/dns/create_record.py"
