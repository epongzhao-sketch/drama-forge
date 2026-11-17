# AGENTS.md —— 爆剧复刻舱 · Drama Forge

> 写给接手本项目的 AI 编程助手（Kimi Code 等）与开发者。
> 读完这份文档再动手，能避开所有已踩过的坑。

## 项目是什么

海外 viral 短剧「换皮复刻」全流程工具。用户上传一部爆款短剧样本（英文/中英），AI 拆解其爆款基因 → 锁定核心期待、只换元素外皮生成 10 个换皮方案 → 人工粗选 3~5 个 → 每个方案产出完整剧本包（方向卡 + 人物小传 + 全剧集纲 + 首卡 1~10 集全量连贯剧本 + 投流素材）→ 编审判档定稿。

本仓库已开源（Apache-2.0）。**红线：线上站点地址、任何密钥永不写入仓库**——地址只配在本地/平台侧 `.env`（`SITE_URL`），密钥只存在于部署环境。访问控制由 `ALLOWED_UNION_IDS` 白名单承担（见「环境变量」）。

内容方法论基于「小黑DNA」：65 部海外竖屏短剧（约 3420 集 / 5.5 万行英文台词）蒸馏出的写作 DNA，已物化为 `api/ai/dna.ts` 注入各环节 prompt。

## 技术栈与架构

- **前端**：React 19 + TypeScript + Vite + Tailwind + shadcn/ui（`src/`）
- **后端**：Hono + tRPC 11（`api/`），入口 `api/boot.ts`
- **数据库**：MySQL 8（线上是 TiDB），Drizzle ORM（`db/schema.ts`）
- **AI**：OpenAI 兼容网关走 `@ai-sdk/openai-compatible`（`api/ai/provider.ts`）；扫描件视觉转写走 Anthropic 兼容协议（`api/ai/vision.ts`）
- **登录**：Kimi 开放平台 OAuth 2.0 + JWT 会话（`api/kimi/`、`api/queries/users.ts`）；白名单闸门 `api/lib/access.ts`
- **共享类型**：`contracts/pipeline.ts`——前后端唯一的类型事实来源

### 目录速查

```
api/ai/          AI 接入层
  provider.ts    网关 provider、undici 长超时 fetch、generateObjectStreamed（streamObject 防代理掐断）
  client.ts      listModels() + 错误归类（平台预置，勿改契约）
  dna.ts         小黑DNA 注入常量（L1 语言/L2 结构/L3-5 认知/L6 视觉/去AI味）+ 语料索引
  dna/           DNA 蒸馏文档原文 + corpus-index.json（80 部剧元数据）
  evaluator.ts   编审判档 prompt（撒冷方法论 v1.6.5）
api/lib/access.ts         登录白名单 isLoginAllowed()（开源后防陌生人使用线上实例的闸门）
api/routers/pipeline.ts   核心业务：五阶段流水线全部 tRPC 过程与 prompt
api/routes/upload.ts      文件上传 + 视觉转写（NDJSON 流式进度）
src/components/pipeline/  五阶段 UI 组件
src/pages/Workspace.tsx   工作区主页面
```

## 五阶段流水线数据流

`projects` → `samples`（剧本原文+红标段 redSegments）→ `analyses`（六板块拆解报告）→ `remaps.settings`（RemapPool：10 方案 + selectedIds 粗选 + finalId 定稿）→ `script_packs.pack`（ConceptScriptPack）→ `evaluations`（判档报告）

所有 JSON 大件存在各表的 JSON 列里，类型见 `contracts/pipeline.ts`。

## 环境变量

`.env`（勿提交公开仓库）：`APP_ID/APP_SECRET`（OAuth 应用）、`VITE_KIMI_AUTH_URL/VITE_APP_ID/KIMI_AUTH_URL/KIMI_OPEN_URL`（Kimi 登录服务）、`DATABASE_URL`、`KIMI_AGENTGW_BASE_URL/KIMI_AGENTGW_API_KEY`（AI 网关）、`OWNER_UNION_ID`（首个登录者为 admin）、`ALLOWED_UNION_IDS`/`SITE_URL`（访问控制与体检，见下）。

**访问控制**（`api/lib/access.ts` 的 `isLoginAllowed`，OAuth 回调签发 session 时校验一次、`authenticateRequest` 每次请求再校验一次，改配置即时生效）：

1. `ALLOWED_UNION_IDS`（逗号分隔）非空 → 只放行列表内 unionId（**配置时把 owner 一并列入**，列表是唯一依据）；
2. 未配白名单但设了 `OWNER_UNION_ID` → 仅 owner 可登录（线上单租户默认）；
3. 两者都未设 → 不限（自托管默认值）。

`SITE_URL` 只用于 `npm run healthcheck` 指定体检目标，只写本地 `.env`。

分支逻辑自检（不连数据库）：`npx tsx -r dotenv/config ./scripts/verify-access-gate.mts`。

## 常用命令

```bash
npm install
npm run dev        # Vite 开发（前后端同端口 3000）
npm run check      # 全量类型检查（改完必跑）
npm run build      # 前端 vite build + esbuild 打包后端为 dist/boot.js
npm start          # 生产运行（需 NODE_ENV=production 才监听端口）
npm run healthcheck  # 线上站点一键体检（5 项检查，需本地 .env 配 SITE_URL，详见 运维手册.md）
```

**防回归纪律**：任何改动必须 `npm run check` 通过 + 本地实测通过后才能 push；push 后提醒用户到 Kimi Desktop 同步部署，部署后跑 `npm run healthcheck` 确认线上无恙。线上故障处置见 `运维手册.md`。

本地开发登录：OAuth 应用白名单一般只登记线上域名，localhost 回调换 token 会报 Invalid redirect_uri。开发环境直接访问 `http://localhost:3000/api/dev-login` 即可免 OAuth 登录（用 OWNER_UNION_ID 签发会话，自动 admin；仅 dev + localhost 可用，生产构建不含此路由）。

## 维护分工（重要：先读懂这条再开工）

本项目采用「Kimi Code 开发 + Kimi 发布」的双层模式：

```
Kimi Code（你）：日常开发 —— 改代码 → npm run check / build 验证 → 提交并推送到 GitHub 仓库
Kimi（站长侧）：发布 —— 用户说"同步 GitHub 最新代码"时，由 Kimi 拉取、构建、存版本，线上站点更新
```

- **你没有部署通道**：线上实例跑在 Kimi 平台的版本系统里（托管、数据库、OAuth 凭证都在平台侧；站点地址只配在本地 `.env` 的 `SITE_URL`，仓库里不出现），改完代码无法自行上线——你的工作边界是「把验证过的代码推到 GitHub 仓库」。
- **标准迭代流程**：开发 → `npm run check` 零错误 → `npm run build` 通过 → 本地冒烟（`NODE_ENV=production node dist/boot.js` + curl 首页）→ commit & push → 提醒用户「让 Kimi 同步发布」。
- **推送入口**：`git remote add origin https://github.com/epongzhao-sketch/drama-forge.git && git push`（仓库已建好并含完整历史；日常 `git pull` / `git push` 即可）。
- **数据库红线**：`.env` 里的 `DATABASE_URL` 指向**线上 TiDB 生产数据**。日常开发务必切换成本地 MySQL（交接包 docker-compose.yml 自带），绝不在生产库上跑实验性迁移。
- **若用户决定迁出 Kimi 平台自托管**：用交接包里的 Dockerfile + docker-compose.yml，那时你将获得完整部署权（服务器+数据库都归你管），本分工即失效。

## 血泪教训（勿重蹈）

1. **部署模型**：平台 zip 只带 `bootstrap + dist/ + .env + package.json`，无 node_modules——后端必须 esbuild 单文件打包成 `dist/boot.js`，绝不能换成裸 tsc。`.dockerignore` 里**不能排除 dist**（会导致部署快照不变）。
2. **长任务防掐断**：AI 调用全部走 `generateObjectStreamed`（streamObject + undici Agent 15 分钟超时）；tRPC 用 `httpBatchStreamLink` + 服务端 `jsonl: { pingMs: 4000 }` 心跳。不要回退到 generateObject 非流式——10 分钟无字节会被代理杀掉。
3. **TiDB 上 `npm run db:push` 会挂**——加列/建表用 mysql2 原生 SQL 执行。
4. **外键列**：`serial()` 主键是 bigint unsigned，FK 必须 `bigint({mode:"number",unsigned:true})`，不能 int/serial。
5. **tsx 行内 `-e` 脚本**遇到 `as never` 断言会 SyntaxError——验证脚本写成项目内 `.mts` 文件再 `npx tsx -r dotenv/config ./xxx.mts`。
6. **模型 id 不硬编码**：运行时从 `listModels()` 读 default_model_id。
7. **红标段**进 prompt 前必须 mergeAdjacent 合并 + slice(0,40) 上限（否则 zod 数组超限报错）。
8. **本地冒烟测试**必须带 `NODE_ENV=production node dist/boot.js`，否则不监听端口。

## 内容纪律（写 prompt 时遵守）

- 换皮 = 只换元素外皮（黑手党/狼人/霸总这类题材包装），核心期待（先婚后爱/复仇打脸这类）锁死不动——三道防线：concept prompt 锁定、pack prompt 规则、编审判阻挡项。
- 节拍级镜像复刻：拆解产出 `beatMap`（原作逐集节拍表：位置/功能/概括/情绪强度/付费卡点），剧本包每集带 `mirror` 对照（原作节拍 → 新剧落法）。纪律 = 镜像节拍功能与情绪曲线，**不镜像原文表达**（事件/场景/台词全部新写）。
- 全量欧美本地化（LOCALIZATION_RULES）：禁中式人名称谓制度场景。
- DNA 硬红线：不搬运语料剧情/人名/台词；英文台词必带中文对照；角色首登场必给【字幕】身份卡；每集必有集尾钩。
- 旧数据兼容：老拆解报告无 hook4、老剧本包无 outline → 前端按旧版识别并引导重产，新字段一律 optional。

## 测试模式

造测试用户：`upsertUser({unionId:"verify-bot-*"})` + `findUserByUnionId` + `appRouter.createCaller({req,resHeaders,user} as never)`，跑完删除用户与其数据。
