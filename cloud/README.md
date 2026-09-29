# 搭子云（cloud/）

激活码（月卡）+ 模型中转。线上地址 https://dazi.suge.me ，部署在 grok `/workspace/dazi-cloud`（见 `deploy.md`）。

- 软件里只有 `https://dazi.suge.me/v1` 和一个绑定本机的令牌，真实的模型 Key 只在服务器的环境变量里
- 软件用的模型名：`dazi-agent`（AI 创作，需要工具调用）、`dazi-fast`（起草回复等短任务）；生图、生视频不看模型名
- 每台电脑每个自然月的额度：对话 `QUOTA_CHAT` 次、生图 `QUOTA_IMAGE` 张、视频 `QUOTA_VIDEO` 条
- 管理后台 `/admin`：生成激活码、看用量、停用、解绑电脑。由 nginx 用 authentik（auth.suge.me）登录保护，应用里再核对 `ADMIN_USERS`

## 环境变量

| 变量 | 说明 |
|---|---|
| `AGENT_BASE` / `AGENT_KEY` / `AGENT_MODEL` | AI 创作用的模型（OpenAI 兼容，必须支持工具调用） |
| `FAST_BASE` / `FAST_KEY` / `FAST_MODEL` | 短任务模型 |
| `IMAGE_BASE` / `IMAGE_KEY` / `IMAGE_MODEL` | 生图（`/images/generations`） |
| `VIDEO_BASE` / `VIDEO_KEY` / `VIDEO_MODEL` | 生视频（`/videos`，异步） |
| `PLAN_DAYS` | 激活码默认天数，默认 30 |
| `QUOTA_CHAT` / `QUOTA_IMAGE` / `QUOTA_VIDEO` | 每月额度，默认 3000 / 200 / 30 |
| `ADMIN_USERS` | 允许进后台的 authentik 用户名，逗号分隔 |
| `DAZI_DB` | SQLite 路径，容器里是 `/data/cloud.db`（命名卷） |

## 接口

- `POST /v1/dazi/activate` `{code, device, deviceName}` → `{token, expiresAt}`。一个码绑一台电脑；同一台电脑上激活新码 = 续费，天数接在后面
- `GET /v1/dazi/me` → 到期时间、剩余天数、本月用量和额度
- `POST /v1/chat/completions`、`POST /v1/images/generations`、`POST /v1/videos`、`GET /v1/videos/{id}`：OpenAI 兼容转发
