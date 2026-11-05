# 爆剧复刻舱 · Drama Forge

海外 viral 短剧「换皮复刻」全流程工具：上传爆款样本 → AI 拆解（小黑DNA 六板块）→ 换皮方案（锁核心期待、换元素外皮）→ 剧本包产出（方向卡 + 人物小传 + 全剧集纲 + 连贯剧本 + 投流素材）→ 编审判档定稿。

> 接手开发请先读 **[AGENTS.md](./AGENTS.md)**——架构、数据流、环境变量、维护分工与所有已踩过的坑都在里面。

## 技术栈

React 19 + TypeScript + Vite + Tailwind + shadcn/ui ｜ Hono + tRPC 11 ｜ Drizzle ORM + MySQL 8 ｜ Kimi OAuth 2.0 ｜ 小黑DNA 内容方法论（`api/ai/dna.ts`）

## 首次灌入完整源码（一次性）

本仓库当前只有文档。完整源码（145 个文件 + 19 次提交的 git 历史）在交接包 `爆剧复刻舱-KimiCode交接包.zip` 里。解开交接包后，在其 `drama-forge/` 目录执行：

```bash
git remote add origin https://github.com/epongzhao-sketch/drama-forge.git
git fetch origin
git reset --soft origin/main   # 以远端文档提交为底
git add -A && git commit -m "chore: 灌入完整源码"
git push -u origin main
```

此后这个仓库就是代码的唯一事实来源，Kimi Code 日常 `git pull` / `git push` 即可。

## 快速开始

```bash
npm install
cp .env.example .env    # 填写 Kimi OAuth / DATABASE_URL / AI 网关凭证（详见 AGENTS.md）
npm run dev             # 开发，前后端同端口 3000
npm run check           # 类型检查
npm run build           # 构建前端 + esbuild 打包后端 dist/boot.js
npm start               # 生产运行（NODE_ENV=production）
```

Docker 自托管部署见交接包内《交接说明.md》。
