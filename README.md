# 爆剧复刻舱 · Drama Forge

海外 viral 短剧「换皮复刻」全流程工具：上传爆款样本 → AI 拆解（小黑DNA 六板块）→ 换皮方案（锁核心期待、换元素外皮）→ 剧本包产出（方向卡 + 人物小传 + 全剧集纲 + 连贯剧本 + 投流素材）→ 编审判档定稿。

> 接手开发请先读 **[AGENTS.md](./AGENTS.md)**——架构、数据流、环境变量与所有已踩过的坑都在里面。

## 技术栈

React 19 + TypeScript + Vite + Tailwind + shadcn/ui ｜ Hono + tRPC 11 ｜ Drizzle ORM + MySQL 8 ｜ Kimi OAuth 2.0 ｜ 小黑DNA 内容方法论（`api/ai/dna.ts`）

## 完整源码

完整源码（含全部 git 历史）通过交接包分发——解开交接包后直接 `git remote add origin <本仓库> && git push -u origin main` 即可把完整历史推上来（需要你自己的 GitHub 凭证）。

## 快速开始

```bash
npm install
cp .env.example .env    # 填写 Kimi OAuth / DATABASE_URL / AI 网关凭证（详见 AGENTS.md）
npm run dev             # 开发，前后端同端口 3000
npm run check           # 类型检查
npm run build           # 构建前端 + esbuild 打包后端 dist/boot.js
npm start               # 生产运行（NODE_ENV=production）
```
