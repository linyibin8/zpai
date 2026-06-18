# zpai · 学习陪伴工具

> 面向**学生、家长、老师**的学习陪伴工具。学生用 iPhone 拍题或开启智能连拍记录一段学习过程，系统记录画面、回答学习问题、整理错题、生成报告、给出复习建议。

它**不是**单纯的"拍照搜题"，而是帮助用户看清一段学习过程：学了什么、哪里卡住、问了什么、哪些题可能错了、后面应该怎么复习。

**三大模块**：过程自动记录 · 过程实时帮助 · 结果异步生成

---

## 架构

```
iPhone（横屏）  ——  Web 控制台（家长/老师）
        \              /
         \            /
      HTTPS / WSS
            ↓
   zpai.evowit.com（广州 VPS nginx + certbot）
            ↓ （Tailscale 内网）
   服务机 100.64.0.13:8787（Fastify + SQLite + AI 编排）
            ↓
   evowit-agent27b（内网 vLLM 100.64.0.5:39000）
```

| 端 | 技术 |
|---|---|
| 后端 | Node.js + Fastify + WebSocket + node:sqlite（零原生依赖）|
| AI 编排 | evowit-agent27b（OpenAI 兼容，`enable_thinking=false`）|
| iOS | SwiftUI（**横屏锁定**）+ AVFoundation + Vision（手势）+ Speech（STT）+ AVSpeechSynthesizer（TTS）|
| Web | React + Vite + TypeScript |
| 部署 | PM2 + nginx + Let's Encrypt + DNSPod API |

## 目录结构

```
zpai/
├─ packages/shared/        三端共享 TypeScript 类型
├─ apps/
│  ├─ server/              Fastify 后端（API/WS/AI 编排/任务队列）
│  ├─ console/             家长/老师 Web 控制台
│  └─ ios/zpai/            SwiftUI 横屏 app + TestFlight 发布脚本
└─ infra/
   ├─ dns/create_record.py DNSPod API 自动创建 A 记录
   ├─ nginx/               反代配置
   ├─ pm2/zpai.json        PM2 守护
   └─ deploy.sh            一键部署
```

## 开发

```bash
npm install                 # 安装全部 workspace 依赖
npm run build               # 构建 shared + server + console
npm test                    # 后端测试（41 个）
npm --workspace @zpai/server run dev    # 启动后端（:8787）
npm --workspace @zpai/console run dev   # 启动控制台（:5173，代理后端）
```

环境变量见 `.env.example`。

## iOS

- Bundle ID：`com.linyibin8.zpai`
- **横屏锁定**：Info.plist 只声明 `LandscapeLeft/Right`，AppDelegate 代码加固
- 相机：`hd1280x720`，发送前最长边 ≤1280、JPEG 0.42
- 端侧：帧差分（变化帧判定）+ Vision（手势）+ Speech（中文 STT/TTS）
- 发布：`apps/ios/zpai/scripts/package_and_upload.sh`（在 macstar 执行）

详见 [docs/deployment.md](docs/deployment.md) 和 [docs/ios.md](docs/ios.md)。

## 安全

- 模型 key、JWT secret、ASC `.p8`、DNS SecretKey、keychain 密码**只放对应机器**，不进仓库
- iOS 只访问 `https://zpai.evowit.com`，模型密钥留 server 端
- 正式账号体系：bcrypt + JWT
