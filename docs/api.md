# zpai API 契约

所有 `/api/*` 走 HTTPS，鉴权用 `Authorization: Bearer <jwt>`。WS 走 `wss://zpai.evowit.com/ws?token=<jwt>`。

## 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（role/username/password/displayName）|
| POST | `/api/auth/login` | 登录，返回 `{ token, user }` |
| GET | `/api/auth/me` | 当前用户 |

## 档案

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/profiles` | 当前用户可见的档案 |
| POST | `/api/profiles` | 创建档案 |
| GET | `/api/profiles/:id` | 档案详情 |
| POST | `/api/profiles/:id/members` | 添加成员（parent/teacher）|
| GET | `/api/profiles/:id/members` | 成员列表 |

## 会话与帧

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/sessions` | 开始会话（profileId）|
| GET | `/api/profiles/:id/sessions` | 档案历史会话 |
| GET | `/api/sessions/:id` | 会话详情 |
| POST | `/api/sessions/:id/frames` | 上传变化帧（changeReason/imageDataUrl）|
| GET | `/api/sessions/:id/frames` | 会话帧列表 |
| POST | `/api/sessions/:id/end` | 结束会话（触发异步报告+错题抽取）|

## 语音 QA

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/qa/ask` | 提问（sessionId/profileId/question/frameId?/reviewQueueId?）|
| POST | `/api/qa/interrupt` | 打断（turnId/sessionId）|
| GET | `/api/sessions/:id/qa` | 会话 QA 历史 |

`ask` 建完 turn 后异步回答，结果通过 WS `qa.done` 推送。

## 报告

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sessions/:id/report` | 会话报告（status: pending/done/failed）|

## 错题

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/profiles/:id/errors?status=` | 错题列表（可按状态过滤）|
| PATCH | `/api/errors/:id` | 更新状态（status/correction?）|

状态：`suspected | confirmed | ignored | corrected | mastered`。confirmed 自动进入复习队列。

## 复习

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/profiles/:id/review/today` | 今日复习（due + fallback）|
| GET | `/api/profiles/:id/review` | 复习队列全部 |
| POST | `/api/review/:queueId/result` | 记录结果（right/wrong/later/mastered）|

## 画像

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/profiles/:id/portrait` | 长期画像 |
| POST | `/api/profiles/:id/portrait/refresh` | 重新构建画像 |

## WebSocket 事件

客户端发：`{ type: "subscribe", sessionId?, profileId? }`

服务端推：

| 事件 | 含义 |
|---|---|
| `frame.captured` | 新变化帧 |
| `qa.created` | 新问答 turn |
| `qa.delta` | 答案增量 |
| `qa.done` | 答案完成（含 turn）|
| `qa.interrupted` | 问答被打断 |
| `report.updated` | 报告已更新 |

## 健康检查

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | `{ status: "ok", service: "zpai", version, time }` |
