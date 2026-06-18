# zpai iOS（横屏）结构与发布

## 横屏锁定（核心要求）

zpai 全程横屏，三种加固同时生效：

1. **Info.plist**：`UISupportedInterfaceOrientations` 和 `~ipad` 数组只含 `LandscapeLeft` / `LandscapeRight`，删掉所有竖屏。
2. **AppDelegate**：`application(_:supportedInterfaceOrientationsFor:)` 返回 `.landscape`。
3. **UIREQUIRESFULLSCREEN**：`true`，避免分屏误入竖屏。

朝向只写在 Info.plist，不在 project.yml（XcodeGen 用 `INFOPLIST_FILE` 指向 plist）。

## 模块

| 文件 | 职责 |
|---|---|
| `zpaiApp.swift` | 入口 + AppDelegate 横屏加固 |
| `AppConfig.swift` | 后端地址、观察模式开关、token 存储 |
| `APIClient.swift` | REST 客户端（JWT 注入）+ 领域模型 |
| `CameraService.swift` | AVFoundation 后置摄像头预览 + 抓帧（hd1280x720，JPEG 0.42）|
| `FrameChangeDetector.swift` | 端侧帧差分 → 有价值变化帧判定 + reason |
| `GestureDetector.swift` | Vision 手部关键点 → 食指/OK/V 手势 |
| `SpeechService.swift` | Speech 中文 STT + AVSpeechSynthesizer 中文 TTS + 沉默/打断 |
| `WebSocketClient.swift` | 订阅后端实时事件（qa.done 等）|
| `ObservationViewModel.swift` | 串起相机/帧差分/手势/语音/上传/QA |
| `ObservationView.swift` | 横屏主舞台：左相机预览 + 右控制/QA |
| `ReviewTodayView.swift` | 今日复习（复习回合不抓镜头）|
| `ReportsView.swift` | 历史会话 + 报告详情 |
| `PortraitView.swift` | 长期学习画像 |
| `SettingsView.swift` | 观察模式开关、后端地址、登出 |

## 行为约定（对齐产品文档）

- **观察模式**默认开启，设置里手动关；空桌面/模糊/无材料自动忽略，不啰嗦提示
- **食指指题** → 自动开麦 + 抓拍当前帧（约 4 秒等待，失败降级）
- **OK** → 追问 / 打断朗读；**V** → 结束当前问答
- 高风险动作（结束整轮学习）不靠单帧手势
- 识别结束冻结问题文本，没听清不触发 AI；沉默自动结束
- 追问/结束/相机失败/打断时立即停止 TTS 朗读
- 看不清提示重拍，**不编造题目内容**
- 复习回合**不抓当前镜头**，避免桌面内容污染错题上下文

## TestFlight 发布

发布机：`macstar@100.64.0.6`。

### 预检（必须先跑）

```bash
ssh macstar@100.64.0.6
# 先读发布套件说明
cat /Users/macstar/testflight-auto/codex-ios-publish-kit/START_HERE_FOR_AI.md
# 预检（只报 OK/FAIL，不打印 secret）
/Users/macstar/testflight-auto/codex-ios-publish-kit/preflight_publish_access.sh \
  /Users/macstar/testflight-auto/ios-publish.env \
  /Users/macstar/Code/zpai
```

预检 READY 后用 `/Users/macstar/.codex/skills/ios-testflight-publish` 和 `chatcodex-ios-domain-setup` skill 发布。预检失败则明确报告缺哪项，不要继续。

### 一键发布

```bash
ssh macstar@100.64.0.6
cd /Users/macstar/Code/zpai/apps/ios/zpai
./scripts/package_and_upload.sh
```

脚本流程：解锁 keychain → 生成图标 → ensure ASC app record → xcodegen → 未签名 archive → 嵌入 profile + codesign → 打包 IPA → altool 上传 → configure_testflight。

### 发布后验证

```bash
python3 scripts/check_status.py
```

验收：build `VALID`、`usesNonExemptEncryption=false`、build 在 `zpai Internal` 组、真机可完成相机+语音+报告。

### 必需 env（ios-publish.env）

| 变量 | 说明 |
|---|---|
| `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY_PATH` | ASC API key（标识符 + .p8 路径）|
| `APPLE_TEAM_ID` | `N3G45G5H74` |
| `APP_BUNDLE_ID` | `com.linyibin8.zpai` |
| `SIGNING_CERTIFICATE` / `SIGNING_KEYCHAIN` / `SIGNING_KEYCHAIN_PASSWORD` | Apple Distribution 证书 |
| `TESTFLIGHT_GROUP_NAME` | `zpai Internal` |
| `TESTER_EMAILS` | 内部测试员 |
| `WHAT_TO_TEST` | 本次测试说明 |

详见 [docs/deployment.md](deployment.md)。
