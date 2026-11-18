import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { pipelineRouter } from "./routers/pipeline";
import { packJobsRouter } from "./routers/packJobs";
import { stageJobsRouter } from "./routers/stageJobs";
import { seriesJobsRouter } from "./routers/seriesJobs";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  pipeline: pipelineRouter,
  packJobs: packJobsRouter,
  stageJobs: stageJobsRouter,
  seriesJobs: seriesJobsRouter,
});

export type AppRouter = typeof appRouter;

// 部署标记: v38 全集续写（编审定稿后继续生成全剧剧本）
