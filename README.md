# 爆剧复刻舱 · Drama Forge

海外 viral 短剧「换皮复刻」全流程工具：上传爆款样本 → AI 拆解 → 换皮方案（锁定核心期待、只换元素外皮）→ 剧本包产出（方向卡 + 人物小传 + 全剧集纲 + 首卡全量连贯剧本 + 投流素材）→ 编审判档定稿。

> 给接手开发的 AI 编程助手与开发者：动手前先读 **[AGENTS.md](./AGENTS.md)**——架构、数据流、环境变量、维护分工与所有已踩过的坑都在里面。

## 功能

- **五阶段流水线**：样本拆解（六板块报告 + 逐集节拍表 beatMap）→ 换皮方案（10 选 N，人工粗选定稿）→ 剧本包（首卡 1~10 集全量连贯剧本 + 投流素材）→ 编审判档
- **节拍级镜像复刻**：剧本逐拍对齐原作的节拍功能与情绪曲线，每集输出 mirror 对照；镜像节拍不镜像表达（事件/场景/台词全部新写）
- **小黑DNA 内建**：65 部海外竖屏短剧（约 3420 集 / 5.5 万行英文台词）蒸馏出的写作方法论，物化在 `api/ai/dna/` 注入各环节 prompt
- **长任务可靠**：AI 调用全流式 + 异步任务 + 服务端断点自愈，页面关闭不影响产出
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
| `KIMI_AGENTGW_BASE_URL` / `KIMI_AGENTGW_API_KEY` | AI 网关（OpenAI 兼容） |
| `OWNER_UNION_ID` | owner 的 unionId（首个登录者自动成为 admin） |
| `ALLOWED_UNION_IDS` | 登录白名单（逗号分隔）。**留空时仅 OWNER_UNION_ID 可登录；两者都留空则不限制**（自托管默认） |
| `SITE_URL` | `npm run healthcheck` 的体检目标，只写本地 `.env`，勿入库 |

## License

[Apache-2.0](./LICENSE)

---

# Drama Forge (English)

An end-to-end AI pipeline for re-skinning overseas viral vertical short dramas: upload a hit series sample → AI deconstructs its "viral DNA" (six-dimension report + per-episode beat map) → generates re-skinned concept variants (core promise locked, surface elements swapped) → produces full script packages (concept card + character bios + season outline + episodes 1–10 + ad creatives) → editorial review and final grading.

- **Beat-level mirrored replication**: each episode mirrors the original's beat functions and emotional curve, with a side-by-side `mirror` comparison; beat structure is mirrored, never the original expression (events, scenes, and dialogue are all rewritten)
- **Built-in writing DNA**: distilled from 65 overseas vertical dramas (~3,420 episodes / 55k lines of dialogue), materialized in `api/ai/dna/` and injected into every stage's prompts
- **Resilient long tasks**: streamed AI calls, async jobs with server-side checkpoint/resume — closing the browser doesn't kill production
- **Access allowlist**: `ALLOWED_UNION_IDS` controls who can log in

**Stack**: React 19 + TypeScript + Vite + Tailwind/shadcn/ui · Hono + tRPC 11 · Drizzle ORM + MySQL 8 · Kimi OAuth 2.0

**Quick start**: `npm install && cp .env.example .env`, fill in your credentials, then `npm run dev` (localhost gets an OAuth-free login at `/api/dev-login`). Self-host with `docker compose run --rm migrate && docker compose up -d --build`. See [AGENTS.md](./AGENTS.md) for architecture, data flow, and ops notes.

**License**: [Apache-2.0](./LICENSE)
