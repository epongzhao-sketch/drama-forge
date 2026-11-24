# 爆剧复刻舱 · Drama Forge

海外 viral 短剧「换皮复刻」全流程工具：上传爆款样本 → AI 拆解 → 换皮方案（锁定核心期待、只换元素外皮）→ 剧本包产出（方向卡 + 人物小传 + 全剧集纲 + 首卡全量连贯剧本 + 投流素材）→ 编审判档定稿 → 定稿后续写至全剧大结局。

> 给接手开发的 AI 编程助手与开发者：动手前先读 **[AGENTS.md](./AGENTS.md)**——架构、数据流、环境变量、维护分工与所有已踩过的坑都在里面。

## 面向短剧工作室 / 制片方

这不是一个"写作玩具"，而是一条能交付**全剧成品**的产线：输入一部已被市场验证的爆款样本，输出可直接进制作环节的完整剧本包——方向卡、人物小传、全剧集纲、逐集全量剧本、投流素材，一路到定稿后的全剧续写。

底层方法论来自 65 部海外竖屏短剧（约 3420 集 / 5.5 万行英文台词）的语料蒸馏，并经真实投放数据复盘校正。

需要定制剧本包、方法论内训或投放向诊断，欢迎在 **Issues** 里联系（中文/English 均可）。

## 功能

- **五阶段流水线**：样本拆解（六板块报告 + 逐集节拍表 beatMap）→ 换皮方案（10 选 N，人工粗选定稿）→ 剧本包（首卡 1~10 集全量连贯剧本 + 投流素材）→ 编审判档 → **定稿后一键续写全集**（第 11 集至大结局，逐批后台产出、断点续跑）
- **节拍级镜像复刻**：剧本逐拍对齐原作的节拍功能与情绪曲线，每集输出 mirror 对照；镜像节拍不镜像表达（事件/场景/台词全部新写）
- **小黑DNA 内建**：65 部海外竖屏短剧（约 3420 集 / 5.5 万行英文台词）蒸馏出的写作方法论，物化在 `api/ai/dna/` 注入各环节 prompt
- **长任务可靠**：AI 调用全流式 + 异步任务 + 服务端断点自愈，页面关闭不影响产出
- **多 AI 服务商**：`AI_PROVIDERS` 配置多家 OpenAI 兼容网关，页面顶栏一键切换（密钥仅服务端）
- **访问白名单**：`ALLOWED_UNION_IDS` 控制谁可登录（语义见下文环境变量）

## 技术栈

React 19 + TypeScript + Vite + Tailwind + shadcn/ui ｜ Hono + tRPC 11 ｜ Drizzle ORM + MySQL 8 ｜ Kimi OAuth 2.0 登录

## 快速开始（本地开发）

```bash
npm install
cp .env.example .env   # 填 Kimi OAuth / DATABASE_URL / AI 网关凭证（见 AGENTS.md「环境变量」）
npm run dev            # 前后端同端口 3000；localhost 免 OAuth 登录入口 /api/dev-login
```

常用命令：`npm run check`（全量类型检查）、`npm run build` + `npm start`（生产）、`npm run healthcheck`（站点体检，需先在本地 .env 配 `SITE_URL`）。

## 自托管部署（Docker）

```bash
docker compose run --rm migrate && docker compose up -d --build
```

详见 [交接说明.md](./交接说明.md) 与 AGENTS.md。

## 环境变量

模板见 [.env.example](./.env.example)，完整说明见 AGENTS.md。关键几项：

| 变量 | 作用 |
|---|---|
| `APP_ID` / `APP_SECRET` | Kimi OAuth 应用凭证 |
| `DATABASE_URL` | MySQL 连接串 |
| `KIMI_AGENTGW_BASE_URL` / `KIMI_AGENTGW_API_KEY` | 默认 AI 服务商（OpenAI 兼容） |
| `AI_PROVIDERS` | 多服务商 JSON 数组（配置后页面顶栏出现切换器，密钥仅服务端） |
| `OWNER_UNION_ID` | owner 的 unionId（首个登录者自动成为 admin） |
| `ALLOWED_UNION_IDS` | 登录白名单（逗号分隔）。**留空时仅 OWNER_UNION_ID 可登录；两者都留空则不限制**（自托管默认） |
| `SITE_URL` | `npm run healthcheck` 的体检目标，只写本地 `.env`，勿入库 |

## License

[Apache-2.0](./LICENSE)

---

# Drama Forge (English)

**Turn one proven viral short drama into a complete, production-ready re-skin — full season script package included.**

Drama Forge is an AI pipeline built for the overseas vertical short-drama industry (ReelShort / DramaBox / ShortMax style). Upload a hit series sample, and it:

1. **Deconstructs** the sample into a six-dimension report plus a per-episode beat map — what each beat does, its emotional intensity, where the paywall sits
2. **Re-skins** it into 10 concept variants that keep the core promise locked and swap only the surface genre (mafia / werewolf / billionaire / royal / sports…)
3. **Produces** a full script package per selected concept: direction card, character bios, season outline, a fully coherent opening block of episodes, and 2 ad-creative episodes — then, after final review, **continues to the season finale** in resumable background batches
4. **Grades** every package with an editor-in-chief review pass before anything ships

### Why it's different

- **Beat-level mirroring, not copying**: every episode mirrors the original's beat functions and emotional curve — the structure that made the original convert is preserved, while every event, scene, and line of dialogue is rewritten from scratch, with a per-episode `mirror` audit trail
- **Battle-tested writing DNA**: the methodology was distilled from 65 overseas vertical dramas (~3,420 episodes / 55k lines of dialogue), then corrected against live ad-delivery data. The repo ships the corpus-distilled base; the ad-validated rule pack is maintained privately
- **Built for real production runs**: streamed structured output, async jobs with server-side checkpoint/resume, self-healing when the model drops an episode — a 60-episode package is a background job you can close the browser on, not a prayer

### For studios & producers

Custom script packages, methodology training, or ad-creative diagnosis for your slate — open an **Issue** (English or Chinese, both fine).

### For developers

**Stack**: React 19 + TypeScript + Vite + Tailwind/shadcn/ui · Hono + tRPC 11 · Drizzle ORM + MySQL 8 · Kimi OAuth 2.0

**Quick start**: `npm install && cp .env.example .env`, fill in your credentials, then `npm run dev` (localhost gets an OAuth-free login at `/api/dev-login`). Self-host with `docker compose run --rm migrate && docker compose up -d --build`. See [AGENTS.md](./AGENTS.md) for architecture, data flow, and ops notes.

**License**: [Apache-2.0](./LICENSE)
