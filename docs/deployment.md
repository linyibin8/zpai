# zpai 部署 Runbook

记录 zpai.evowit.com 的完整上线流程，可复现。

## 安全原则

- 不要把 LLM key、JWT secret、ASC `.p8`、DNS SecretKey、keychain 密码写进仓库/文档/对话
- iOS 只访问自己的后端，模型密钥和多模态调用都留在 server 端
- `.gitignore` 已排除 `.env`、`.ipa`、`.p8`、`.mobileprovision`、`.xcarchive`、`data/`、`uploads/`

## 项目值

| 项目 | 值 |
|---|---|
| iOS 目录 | `apps/ios/zpai` |
| App 名称 | `zpai` |
| Bundle ID | `com.linyibin8.zpai` |
| Apple Team ID | `N3G45G5H74` |
| 版本号 | `0.1.0`，build 用时间戳 |
| 后端域名 | `https://zpai.evowit.com` |
| WebSocket | `wss://zpai.evowit.com/ws` |
| 服务机 | `ydz@100.64.0.13` |
| 公网反代 VPS | `ubuntu@100.64.0.8`（`159.75.178.237`）|
| 模型 | `evowit-agent27b`（内网 `http://100.64.0.5:39000/v1`）|

## 一、DNS（首次，DNSPod API 自动创建）

```bash
export TENCENT_SECRET_ID=AKID...
export TENCENT_SECRET_KEY=...
python3 infra/dns/create_record.py
# 创建 zpai.evowit.com -> 159.75.178.237，TTL 300
```

脚本幂等：若同名记录已存在则跳过。验证：

```bash
dig zpai.evowit.com +short
# 应返回 159.75.178.237
```

## 二、后端部署（服务机 ydz@100.64.0.13）

### 1. 同步代码

```bash
# 从本机
bash infra/deploy.sh
# 脚本会：本地 build → rsync 到服务机 → npm ci → pm2 restart
```

或手动：

```bash
rsync -avz --exclude node_modules --exclude data --exclude uploads --exclude .env \
  ./ ydz@100.64.0.13:/home/ydz/apps/zpai/
```

### 2. 配置 .env（服务机，一次性）

在 `100.64.0.13:/home/ydz/apps/zpai/.env`：

```dotenv
PORT=8787
CONSOLE_ORIGIN=https://zpai.evowit.com
PUBLIC_BASE_URL=https://zpai.evowit.com
DATA_DIR=./data
UPLOAD_DIR=./uploads
JWT_SECRET=<openssl rand -hex 32 生成>
JWT_TTL_DAYS=30
LLM_BASE_URL=http://100.64.0.5:39000/v1
LLM_API_KEY=ollama
LLM_MODEL=evowit-agent27b
LLM_DISABLE_THINKING=true
MAX_IMAGE_CHARS=2500000
MAX_CONTEXT_MESSAGES=12
TASK_CONCURRENCY=2
```

### 3. 构建与启动

```bash
ssh ydz@100.64.0.13
cd /home/ydz/apps/zpai
npm ci --omit=dev
npm --workspace @zpai/shared run build
npm --workspace @zpai/server run build
npm --workspace @zpai/console run build
pm2 start infra/pm2/zpai.json
pm2 save
pm2 logs zpai
```

### 4. 内网验证

```bash
curl http://100.64.0.13:8787/api/health
# {"status":"ok","service":"zpai",...}
```

## 三、反代与 HTTPS（VPS ubuntu@100.64.0.8）

```bash
# 上传配置
scp infra/nginx/zpai.evowit.com.conf ubuntu@100.64.0.8:/tmp/
ssh ubuntu@100.64.0.8
sudo cp /tmp/zpai.evowit.com.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/zpai.evowit.com.conf /etc/nginx/sites-enabled/

# 签发证书（DNS 需已生效）
sudo certbot --nginx -d zpai.evowit.com --non-interactive --agree-tos -m 269123786@qq.com --redirect

sudo nginx -t && sudo systemctl reload nginx
```

## 四、公网验证

```bash
curl -I https://zpai.evowit.com
curl https://zpai.evowit.com/api/health
```

WebSocket 验证：iOS app 或 `wscat -c "wss://zpai.evowit.com/ws?token=<jwt>"`。

## 五、交接检查表

- [ ] DNS A 记录 `zpai.evowit.com -> 159.75.178.237` 已生效
- [ ] 服务机 `.env` 配置完整，`JWT_SECRET` 已用随机串
- [ ] PM2 `zpai` 进程 online，内网 `/api/health` 200
- [ ] VPS nginx 配置已启用，证书有效且自动续期
- [ ] 公网 `https://zpai.evowit.com/api/health` 200
- [ ] `/ws` WebSocket 可公网连接
- [ ] iOS TestFlight build `VALID`，真机能完成相机+语音+报告
