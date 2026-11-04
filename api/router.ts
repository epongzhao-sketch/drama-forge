import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { pipelineRouter } from "./routers/pipeline";
import { walletRouter } from "./routers/wallet";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  pipeline: pipelineRouter,
  wallet: walletRouter,
});

export type AppRouter = typeof appRouter;
