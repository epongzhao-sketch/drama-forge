import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { pipelineRouter } from "./routers/pipeline";
import { packJobsRouter } from "./routers/packJobs";
import { stageJobsRouter } from "./routers/stageJobs";
import { seriesJobsRouter } from "./routers/seriesJobs";
import { aiRouter } from "./routers/ai";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  pipeline: pipelineRouter,
  packJobs: packJobsRouter,
  stageJobs: stageJobsRouter,
  seriesJobs: seriesJobsRouter,
  ai: aiRouter,
});

export type AppRouter = typeof appRouter;

// 部署标记: v39-multi-provider-1240（多服务商 + 全集续写；替代丢失的 f346392/1223）
