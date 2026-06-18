# zpai 架构

## 数据流

```
学生 iPhone（横屏）
  │ 相机每帧 → FrameChangeDetector（端侧差分）
  │   ├─ 有价值变化 → 上传帧（reason）→ POST /api/sessions/:id/frames
  │   └─ 空桌面/模糊/无材料 → 忽略（不上传、不提示）
  │
  │ 手势（Vision）→ 食指指题 → 自动开麦 + 抓拍
  │ 语音（Speech STT）→ 冻结问题 → POST /api/qa/ask
  │                                    ↓
  │                    server：建 turn → VisionQA（带当前帧+上下文）→ WS qa.done
  │                                    ↓
  │                    AVSpeechSynthesizer 中文朗读；打断立即停
  │
  │ 停止连拍 → POST /api/sessions/:id/end
  │                    ↓
  │           异步任务队列（并发的 generateReport + extractErrors）
  │                    ↓
  │           报告入库（基于实际证据，不编造）
  │           疑似错题入库（suspected，附证据帧）
  ↓
家长/老师 Web 控制台
  ├─ 报告页：看本次学习报告（异步生成）
  ├─ 错题确认页：suspected → confirmed/ignored/corrected/mastered
  │     confirmed → 进入复习队列
  ├─ 复习队列页：记录 right/wrong/later/mastered → SM-2 调度下次
  ├─ 画像页：薄弱点/错误类型/科目分布/常被追问
  └─ 远程触发页：Web 端发起 QA，结果推到 iOS
```

## 数据模型（SQLite）

11 张表，支持正式账号 + 关系数据：

- `users`：账号（student/parent/teacher），bcrypt + JWT
- `profiles`：学生档案（一个家长/老师可管多个档案）
- `profile_members`：多人对一个档案的可见权
- `sessions`：学习会话
- `frames`：观察帧（按 reason 分类，标记 key_frame）
- `qa_turns`：问答记录
- `reports`：学习报告（pending/done/failed）
- `error_items`：错题（状态机：suspected→confirmed→corrected/mastered/ignored）
- `review_queue`：复习队列（SM-2：interval/ease_factor/reps）
- `review_results`：复习结果记录
- `profiles_portrait`：长期画像缓存

## AI 编排

| 组件 | 职责 |
|---|---|
| `LlmClient` | OpenAI 兼容调用，`enable_thinking=false`，图片不截断 |
| `VisionQa` | 视觉问答（带帧+上下文），看不清提示重拍不编造 |
| `ReportGenerator` | 异步报告，强约束：只基于证据，无证据写"未拍到" |
| `ErrorExtractor` | 关键帧异步抽取疑似错题（JSON 数组）|
| `PortraitBuilder` | 聚合多 session → 薄弱点/错误类型/科目分布 |

## 端侧 vs 服务端职责

| 能力 | 位置 | 理由 |
|---|---|---|
| 帧差分判定 | iOS 端侧 | 省带宽、低延迟、离线可用 |
| 手势识别 | iOS Vision | 端侧、免费、隐私 |
| STT/TTS | iOS 端侧 | 低延迟、弱网可用、免费 |
| 视觉问答 | 服务端 | 模型密钥不进 app |
| 报告/错题/画像 | 服务端异步 | 重计算、可重试 |

## 复习调度（SM-2）

| result | 含义 | 调度 |
|---|---|---|
| right | 正确 | reps+1，间隔增长 |
| wrong | 错误 | reps=0，间隔回 1 天，EF 降 |
| later | 延后 | 间隔小幅增 |
| mastered | 掌握 | 移出队列，错题升 mastered |

今日复习：到期优先；无到期可提前一条；完全无错题降级 5 分钟复习计划。
