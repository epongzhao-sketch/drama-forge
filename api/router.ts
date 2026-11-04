import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { pipelineRouter } from "./routers/pipeline";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  pipeline: pipelineRouter,
});

export type AppRouter = typeof appRouter;
