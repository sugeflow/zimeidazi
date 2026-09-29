# 自媒搭子 · 桌面版方案（v0.3）

> 基于开源项目 [ZJU-REAL/Easel](https://github.com/ZJU-REAL/Easel)（Apache-2.0），做成**面向小白、按月付费**的桌面软件「自媒搭子」：
> 用户下载安装，输入激活码就能用；不需要懂 API Key、模型、镜像这些概念。
>
> 基线：Easel `de08f20`（2026-09-28，v0.2.1）· 历史版本见 git log

## 0. 已确定的决策

| 项 | 决定 |
|---|---|
| 名称 | **自媒搭子**（英文标识 `ZimeiDazi`，应用 ID `com.zimeidazi.app`）；图标另行设计，关于页注明"基于开源项目 Easel" |
| 仓库 | GitHub 公开仓库，Actions 云端构建 |
| 用户 | 主要在国内 |
| 平台 | Windows x64 为主；测试阶段 macOS 只做 Apple Silicon（arm64） |
| 桌面壳 | **Tauri 2** |
| 安装包 | 轻量安装包 + 首次启动下载运行时 |
| 模型 | 由我们统一配好，用户不可见、不可改；对话模型暂定 **DeepSeek V4.1 Pro** |
| 收费 | **包月**：激活码即月卡，到期续费 |
| 功能 | **全部保留**，不做技能裁剪；只隐藏模型配置入口（见第 6 节）。语音转写 / 本地模型下载初期不处理 |

---

## 1. 整体架构

```
┌─────────── 用户电脑 ───────────┐              ┌────────── 我们的服务器 ──────────┐
│ 自媒搭子（Tauri 壳）             │              │ 搭子云（授权 + 模型中转）          │
│  ├─ 激活页 / 首次安装进度页        │── 激活码 ──▶ │  ├─ 激活码 → 设备绑定 → 访问令牌     │
│  ├─ 进程管家（Rust）              │              │  ├─ 用量计量 / 额度 / 到期           │
│  │   ├─ OpenClaw gateway :18789  │── 令牌 ────▶ │  └─ 透传代理：替换成真实 Key 后转发   │
│  │   └─ Easel 后端 :7860         │   (所有模型   │       ├─ 对话 LLM                   │
│  └─ 主窗口 WebView → :7860       │    请求)      │       ├─ 生图 / 配音 / 转写           │
└─────────────────────────────────┘              │       └─ 视频 / 音乐                 │
         ▲ 首次启动下载运行时包                    └──────────────────────────────────┘
         └──────── 国内对象存储（OSS/COS）：运行时包 + 自动更新包
```

## 2. 模型怎么"写死"：云端中转 + 激活码（最关键的一处改动）

**不能把真实的模型 API Key 打包进软件。** 仓库是公开的，而且安装包就算不公开，里面的 Key 也能被轻易提取出来，被拿去随便调用，费用全由你承担。

正确做法：

1. 软件里只写死**我们自己中转服务的地址**。Easel 所有模型通道都支持自定义 `*_BASE_URL`（已逐一核对），全部指向中转服务。
2. 用户首次打开时输入**激活码**。软件用激活码换取一个绑定本机的访问令牌，写进 `.env` 的各个 `*_API_KEY` 位置。
3. 中转服务收到请求后先校验令牌、扣额度，再换成真实 Key 转发给模型厂商。
4. 好处：
   - 可以随时更换模型或厂商，**不需要给用户发新版本**
   - 可以按用户限额、设置到期、封禁单个激活码
   - 可以统计用量和成本
   - 付费售卖的授权也一并解决了：仓库公开也没关系，没有激活码就用不了

Easel 的 6 个模型通道和建议默认值（一家为主，减少对接工作）：

| 通道 | Easel 配置项 | 建议默认 |
|---|---|---|
| 对话与脚本（Agent 大脑） | OpenClaw provider（OpenAI 兼容） | **DeepSeek V4.1 Pro**（DeepSeek 官方 API；具体 model 名 M3 时按官方文档核对） |
| 生图 | `IMG_BASE_URL` / `IMG_MODEL`（OpenAI 兼容） | 通义万相 / 豆包 Seedream |
| 配音 | `VOICE_PROVIDER=dashscope`（CosyVoice） | 阿里百炼 |
| 语音转写 | 上游是本地 faster-whisper + hf-mirror 下载模型 | **初期不处理**，保持上游原样（见第 6 节） |
| 视频 | `VIDEO_PROVIDER=dashscope`（万相 Wan） | 阿里百炼 |
| 音乐 | `MUSIC_PROVIDER=dashscope` | 阿里百炼 |

→ 对话走 **DeepSeek**，生图 / 配音 / 视频 / 音乐走**阿里云百炼**，中转服务里只需要两家的真实 Key。

> DeepSeek 风险提示：Easel 的技能提示词是按 Claude 调教的，Agent 要频繁调用工具、执行多步任务。M3 阶段要拿同一批典型任务（建画像、写小红书、出卡片、一键出片、发布）实测 V4.1 Pro 的工具调用稳定性；不理想时在中转服务里切换模型即可，不用发版。

### 包月怎么落地

- **激活码 = 月卡**：一个码对应 30 天有效期（也可以做季卡、年卡），在后台批量生成。前期你可以通过微信、小红书、发卡平台卖码，不用先接支付
- **续费**：到期前 3 天，软件内提醒；输入新码后有效期顺延
- **每月额度上限**（防止亏本）：包月不代表无限用，按成本设置月度上限，例如对话 N 百万 token、生图 N 张、视频 N 条。超出后提示"本月额度已用完"，或购买加油包。**AI 视频单条几元到几十元，必须单独限量**
- **设备限制**：一个码最多绑定 2 台设备，可以在后台解绑
- 后期再接微信 / 支付宝支付，实现软件内直接续费

**中转服务**（新子项目 `cloud/`）：Python FastAPI，一个进程加一个数据库。包含：
- 激活码（月卡）生成（后台页面）、有效期、设备绑定、月度额度
- 按厂商路径透传代理（`/p/dashscope/*`、`/p/siliconflow/*`），替换请求头里的 Key，支持流式响应（SSE）
- 按请求记录 token 数和次数，超出额度返回明确的中文错误

部署在一台国内云服务器上（需要备案域名 + HTTPS）。

## 3. 桌面壳：Tauri 2

可行，而且比 Electron 更适合这个场景：

- **体积**：壳本身约 10MB，Electron 约 90MB
- **进程清理更可靠**：Windows 上用 **Job Object**（设置关闭时结束所有子进程），即使壳本身崩溃，gateway 和后端也会被系统一起回收，不会残留；macOS 用进程组
- **自动更新**：`tauri-plugin-updater`。更新包需要签名，签名密钥免费生成，放在 GitHub Secrets；更新清单和安装包放在国内 OSS
- **安装包**：Windows 用 NSIS，安装到当前用户目录（不需要管理员权限），内嵌 WebView2 引导程序（Win10 老系统没装 WebView2 时会自动补装）；macOS 出 `.dmg`

需要实测的风险点：
- 主窗口加载 `http://127.0.0.1:7860`。WebView2 / WKWebView 与 Chrome 有差异，重点测：
  - 公众号排版的"复制富文本"
  - 文件拖入上传
  - 视频播放
  - 下载产物
  - `window.open` 新开窗口（统一拦截，改用系统浏览器打开或在应用内打开）
- 平台登录（小红书、抖音等）用的是 Playwright 自带的 Chromium，会弹出独立窗口。这是上游的行为，不受 WebView 影响

## 4. 轻量安装包 + 运行时包

v0.1 设想的是"在用户电脑上 pip/npm 安装依赖"。国内环境下这种方式不稳定：会遇到镜像抽风、缺编译器、依赖解析失败等问题。改成**在 CI 里预先把运行时整包构建好**，用户电脑上只做"下载 → 校验 → 解压"：

| 内容 | 在哪 | 大小（估） |
|---|---|---|
| Tauri 壳 + 激活页 / 安装页 + Easel 源码（裁剪后）+ 前端 dist | 安装包 | **约 40MB** |
| **运行时包**：Python 3.12（python-build-standalone）+ 已装好的全部依赖 + Node 24 + OpenClaw（锁定版本）+ FFmpeg / ffprobe（**LGPL 版**，售卖更安全） | OSS，首次启动下载 | 约 400–500MB（压缩后） |
| **浏览器包**：Playwright Chromium | OSS，首次启动下载 | 约 150MB |
| 抠图模型（rembg） | 浏览器包里一起带上，或第一次用时从 OSS 下载 | 约 5MB 或 170MB |

- 运行时包按平台分别构建（`win-x64`、`mac-arm64`），带 sha256 校验，支持断点续传
- **运行时包和 App 版本解耦**：只改了壳或 Easel 代码时，只需要更新 40MB 的安装包；依赖变了才需要换运行时包。`runtime-manifest.json` 记录当前应该使用的运行时版本
- 首次启动全程只访问我们自己的 OSS，不依赖 GitHub、PyPI、npm、HuggingFace
- GitHub Releases 同时保留一份，作为备份和开源发布渠道

### M1 实测结果（2026-09-28）

| 包 | mac-arm64 解压 / 压缩 | win-x64 解压 / 压缩 |
|---|---|---|
| 运行时包（Python + 依赖、Node + OpenClaw、FFmpeg） | 2.0GB / **542MB** | 2.2GB / **614MB** |
| 浏览器包（Chromium + headless shell） | 583MB / **236MB** | 740MB / **284MB** |

- 冒烟测试在两个平台的 CI 上全部通过：依赖、FFmpeg、Node、OpenClaw、Chromium、gateway，以及后端加载 114 个技能。Windows 从零开始跑完约 87 秒
- 比预估大，Windows 首次下载合计约 **900MB**。M5 之前可以做的优化：
  - 剪掉 OpenClaw node_modules 里的 `.d.ts`、sourcemap 和用不到的 provider SDK
  - `opencv-python` 和 `opencv-python-headless` 重复安装了，去掉一个
  - 确认 headless shell 是否会用到，用不到就去掉
- 冷启动约 195 秒：macOS 首次运行新解压的程序文件时要做安全扫描，Python 也要首次编译字节码。第二次启动只要 **14 秒**，其中 gateway 本身约 5 秒。M2 的首次准备页要把这段时间算进去，并且在解压后先预热一次
- M2 要处理的 OpenClaw 默认行为：
  - 会用 **bonjour 在局域网广播自己**：出于隐私考虑必须关掉
  - 默认模型是 `openai/…`：改成我们的配置
  - 收到 SIGTERM 后最多等 315 秒才退出：壳在短暂等待后强制结束进程
  - 日志写在 `/tmp/openclaw/`：改到我们自己的 logs 目录

## 5. 目录布局

**安装目录（只读，每个版本整体替换）**：Tauri 壳 + `resources/easel/`（打过补丁的源码快照）

**用户数据目录**（Windows `%LOCALAPPDATA%\ZimeiDazi\`，macOS `~/Library/Application Support/ZimeiDazi/`）

```
app/          ← 从 resources/easel 同步过来，作为 Easel 的 PROJECT_ROOT
  profiles/ outputs/ .env     ← 用户数据，同步时永不覆盖（.env 只由壳改写）
runtime/<版本>/   python/ node/ bin/(ffmpeg)   ← 运行时包解压位置
browsers/     Playwright Chromium
logs/         gateway.log · web.log · setup.log
state.json    激活状态、已完成步骤、运行时版本
```

`~/.openclaw-easel/`、`~/.easel-browser-profiles/`（平台登录状态）保持上游默认位置。

## 6. 功能范围

**全部保留，不做技能裁剪**，114 个技能都保留。只做两类必要的改动：

### 必须隐藏（模型由我们统一配置，否则用户会看到空的 Key 输入框）
- 「设置 → 模型配置」面板（对话 / 转写 / 配音 / 生图 / 视频 / 音乐 六个通道的 Key、Base URL、模型选择），换成「我的会员」页：到期日、本月用量、续费入口
- 技能库里的"填写 API Key"入口（SkillDrawer / EnvBoard）
- 首次引导里的模型配置步骤，换成我们的激活页
- 实现方式：打补丁只隐藏入口，不删上游代码，方便以后同步上游更新

### 初期不处理（后续版本再做）
- **语音转写 + 本地模型下载（HuggingFace / Whisper）**：保持上游原样，不专门适配，也不预置模型。影响自动字幕、视频转图文、长视频切片、高光切片这几个技能；在它们第一次使用时，会从 hf-mirror 自动下载模型（慢，而且可能失败）。后续计划改成云端转写
- 公众号自动发布（需要用户自己申请 AppID、配置 IP 白名单）、声音克隆：保留原样，暂不做小白化引导

### 壳层面托管掉的
- CLI（`easel chat` 等）、`doctor`、gateway 手动启停，全部由壳托管
- Web 里"重启 gateway"一类的运维按钮，改成请求壳的接口

## 7. 仓库结构

```
easel-desktop/
  upstream/Easel/        git submodule（锁定 commit）
  patches/               对上游的补丁：隐藏入口、云端 ASR、Windows 兼容等
  desktop/               Tauri 2 应用
    src-tauri/           Rust：进程管家、Job Object、下载解压、激活、更新
    ui/                  激活页、安装进度页、错误/日志页（纯 HTML + TS，不引入框架）
  runtime/               构建运行时包的脚本 + 依赖锁（requirements.lock、openclaw 版本）
  cloud/                 授权 + 模型中转服务（FastAPI）+ 部署脚本
  scripts/stage-easel.*  裁剪上游（去掉 435MB README / 官网素材、tests、docs）+ 打补丁 + 构建前端
  .github/workflows/
    runtime.yml          依赖变化时，构建 win-x64 / mac-arm64 运行时包 → 上传 OSS
    app.yml              每次 push 构建安装包；打 tag 后发布到 OSS + GitHub Releases
```

## 8. 首次启动流程（用户视角）

1. 双击安装（约 40MB，不需要管理员权限）→ 打开
2. **激活页**：输入激活码 → 成功后显示会员到期日和本月剩余额度
3. **准备环境页**：显示"正在准备创作环境（约 600MB，首次需要几分钟）"和进度条，失败可重试；中途关掉，下次打开会接着下载
4. 自动完成 OpenClaw 配置、技能同步，并做一次自测对话
5. 进入工作台，从上游的"建立账号画像"引导开始

之后每次打开：检查更新 → 启动服务（约 5–10 秒）→ 进入工作台。关闭窗口时，最小化到托盘还是直接退出，由用户设置。

## 9. 里程碑

| 阶段 | 内容 | 完成标准 |
|---|---|---|
| **M0 骨架** | Tauri 壳 + 双平台 CI（win-x64 / mac-arm64），出安装包，显示占位页 | 从 Actions 下载的安装包能装、能打开 |
| **M1 运行时包** | runtime.yml 构建运行时包；stage-easel 裁剪 + 构建前端 | CI 里用运行时包能把 Easel 跑起来，冒烟测试通过 |
| **M2 进程管家** | 下载 / 校验 / 解压，启动两个服务，Job Object，日志，单实例，端口检查 | 本地填好 `.env` 后能完整使用工作台，关闭后不残留进程 |
| **M3 中转服务**（代码完成，服务已在 grok 运行；公网入口待开通） | `cloud/`：激活码、令牌、透传代理、计量、管理后台；部署上线 | 激活码能用，六个通道都能通过中转调用成功 |
| **M4 适配补丁** | 第 6 节隐藏模型配置 + 「我的会员」页；Windows 兼容补丁（`/tmp` 等） | 在一台全新的 Windows 机器上完整走一遍五大工作流 |
| **M5 更新与发布** | 自动更新（OSS）、版本号展示、发布流程 | v0.1.0 → v0.1.1 能自动升级，用户数据不丢 |
| M6 商用准备 | Windows 代码签名、macOS 公证、用户协议 / 隐私政策 | — |

### 进度

| 阶段 | 状态 | 说明 |
|---|---|---|
| M0 | ✅ 2026-09-28 | Tauri 壳 + 双平台 CI |
| M1 | ✅ 2026-09-28 | 运行时包 + 冒烟测试，两个平台通过 |
| M2 | ✅ 2026-09-28 | 进程管家；CI 自检在两个平台通过（Windows 从零开始 176 秒，Mac 95 秒） |

M2 实现要点与变化：
- 安装包实测只有 **13MB（Windows）/ 16MB（Mac）**，因为 Easel 代码压缩后很小
- 子进程使用独立主目录 `<数据目录>/home`（Mac 设置 `HOME`，Windows 设置 `USERPROFILE`）。原因：Easel 后端有 5 处写死了 `~/.openclaw-easel`；这样隔离后，OpenClaw 配置、平台登录状态都不会和用户自己装的 Easel 互相干扰
- `zimeidazi --selftest <资源目录>`：不开窗口跑完整流程。`ZMDZ_DATA_DIR` 可以指定数据目录，`ZMDZ_DIST_BASE` 可以指定下载源（URL 或本机目录）
- 运行时包暂时托管在 GitHub Release `runtime-r1`，国内下载会慢，M5 换成 OSS
- 推迟到后续阶段：托盘菜单（M5）；WebView 兼容性实测，包括下载文件、`window.open`、复制富文本（M4）

## 10. 待你确认 / 提供

1. **需要准备的资源**（M3 之前到位即可，M0–M2 不需要）：
   - 国内云服务器 + 备案域名（中转服务用，需要 HTTPS）
   - 对象存储 OSS/COS（安装包和运行时包，每月流量费另算）
   - DeepSeek 开放平台账号、阿里云百炼账号（充值后获得真实 Key，只放在服务器上）
2. **月卡定价和额度**：建议 M3 实测后按真实成本倒推（单个用户每月大概用多少 token、生图、视频）
3. **商用合规**：
   - 名字已改为「自媒搭子」，避开了 Easel 商标问题。关于页和 LICENSE 里保留 Easel 的 Apache-2.0 署名即可
   - 不使用 Easel 的图标，以及 README 里的学校 / 实验室 logo
   - `gzh-design` 是 AGPL-3.0：仓库公开，满足要求
   - FFmpeg 使用 LGPL 版本
   - 上线前还需要：用户协议、隐私政策；AI 生成内容标识（按《人工智能生成合成内容标识办法》）
   - 建议去商标网查一下「自媒搭子」，有条件的话尽早申请注册（第 9 类软件、第 42 类 SaaS）

## M3 进度（2026-09-29）

- 搭子云代码在 `cloud/`（FastAPI + SQLite），说明见 `cloud/README.md`
- 已部署到 grok：`/workspace/dazi-cloud`，容器 `dazi-cloud`（镜像 `dazi-cloud:local`，数据卷 `dazi_cloud_data`），只监听 `127.0.0.1:5430`；真实模型 Key 在 `.runtime/secrets.env`（600）
- 模型：AI 创作 kimi-k3（claudex），短任务 muse-spark，生图 muse-image，生视频 muse-video；全部在服务器环境变量里，换模型不用发版
- 软件端：设置 → 会员 输入激活码 → 本机后台向搭子云换令牌，写进 `.env`（所有通道指向 `https://dazi.suge.me/v1`）；导航会员卡显示剩余天数和本月额度；激活后重启软件，AI 创作才用上会员模型
- 本机全链路已测：生成码 → 激活 → 设备绑定 → 续费叠加 → 额度拦截；经中转的流式对话、工具调用、生图、生视频（Easel 自带脚本）都通过
- **待开通公网入口**（涉及共用设施，需要确认后再做）：
  1. grok `/workspace/suge/deploy/Caddyfile` 加 `dazi.suge.me` → `127.0.0.1:5430`，重建并重启 `suge-edge`（所有 *.suge.me 会中断几秒）
  2. suge nginx 新站点 `dazi.suge.me`（`/admin` 走 authentik，`/v1` 直通）+ Let's Encrypt 证书
  3. Cloudflare DNS：`dazi` A 记录
  4. authentik：新建 Proxy Provider + Application「搭子云」（照 `/workspace/authentik/data/easel-provider.py`）
