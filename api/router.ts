import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { pipelineRouter } from "./routers/pipeline";
import { packJobsRouter } from "./routers/packJobs";
import { stageJobsRouter } from "./routers/stageJobs";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  pipeline: pipelineRouter,
  packJobs: packJobsRouter,
  stageJobs: stageJobsRouter,
});

export type AppRouter = typeof appRouter;

// 部署标记: v24 首卡全量产出同步
