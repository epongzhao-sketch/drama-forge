// 流水线长步骤异步任务（阶段 02 拆解 / 03 方案生成 / 05 判档质检）：
// 提交秒回 + 服务端后台执行 + 前端轮询，根治平台代理掐断长请求（Load failed）。
// 与 packJobs（剧本包多步产出）互补：本路由管单步长 LLM 调用。
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { projects, analyses, remaps, evaluations } from "@db/schema";
import { pipelineRouter } from "./pipeline";
import type { TrpcContext } from "../context";

type JobUser = NonNullable<TrpcContext["user"]>;
type StageKind = "analysis" | "concepts" | "evaluate";

const KIND_LABEL: Record<StageKind, string> = {
  analysis: "AI 拆解爆款样本",
  concepts: "生成 10 个换皮方案",
  evaluate: "判档质检",
};

interface StageJob {
  key: string;
  kind: StageKind;
  projectId: number;
  conceptId?: string;
  params?: { totalEpisodes?: number; episodeSeconds?: number; notes?: string };
  user: JobUser;
  status: "running" | "failed" | "done";
  attempt: number;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

/** 进程内任务注册表（即时状态；完成与否以落库数据为准） */
const stageJobs = new Map<string, StageJob>();
const stageJobKey = (kind: StageKind, projectId: number, conceptId?: string) =>
  `${kind}:${projectId}:${conceptId ?? ""}`;

const publicJob = (j: StageJob) => ({
  status: j.status,
  kind: j.kind,
  attempt: j.attempt,
  error: j.error as string | undefined,
  updatedAt: j.updatedAt,
});

async function ensureProject(userId: number, projectId: number) {
  const db = getDb();
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p || p.userId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
  }
  return p;
}

/** 完成判定的落库真值 */
async function dbDone(kind: StageKind, projectId: number, conceptId?: string): Promise<boolean> {
  const db = getDb();
  if (kind === "analysis") {
    const [r] = await db.select().from(analyses).where(eq(analyses.projectId, projectId));
    return !!r;
  }
  if (kind === "concepts") {
    const [r] = await db.select().from(remaps).where(eq(remaps.projectId, projectId));
    return !!r;
  }
  const [r] = await db
    .select()
    .from(evaluations)
    .where(and(eq(evaluations.projectId, projectId), eq(evaluations.scope, "pack"), eq(evaluations.epNo, 0)));
  return !!r;
}

/** 后台执行器：单步长 LLM 调用，最多 3 次尝试（10s/30s 退避） */
async function runStageJob(job: StageJob) {
  const caller = pipelineRouter.createCaller({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: job.user,
  } as never);
  for (;;) {
    try {
      if (job.kind === "analysis") {
        await caller.runAnalysis({ projectId: job.projectId });
      } else if (job.kind === "concepts") {
        await caller.generateConcepts({
          projectId: job.projectId,
          totalEpisodes: job.params?.totalEpisodes ?? 60,
          episodeSeconds: job.params?.episodeSeconds ?? 75,
          notes: job.params?.notes,
        });
      } else {
        await caller.evaluatePack({ projectId: job.projectId, conceptId: job.conceptId! });
      }
      job.status = "done";
      job.updatedAt = Date.now();
      return;
    } catch (err) {
      job.attempt++;
      job.updatedAt = Date.now();
      if (job.attempt >= 3) {
        job.status = "failed";
        job.error = err instanceof TRPCError ? err.message : err instanceof Error ? err.message : String(err);
        job.updatedAt = Date.now();
        return;
      }
      await new Promise((r) => setTimeout(r, job.attempt === 1 ? 10000 : 30000));
    }
  }
}

/** 幂等提交：同任务进行中则直接返回；失败/无记录则新建后台任务 */
function ensureStageJob(
  user: JobUser,
  kind: StageKind,
  projectId: number,
  conceptId?: string,
  params?: StageJob["params"],
): StageJob {
  const key = stageJobKey(kind, projectId, conceptId);
  const existing = stageJobs.get(key);
  if (existing?.status === "running") return existing;
  const job: StageJob = {
    key,
    kind,
    projectId,
    conceptId,
    params,
    user,
    status: "running",
    attempt: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  stageJobs.set(key, job);
  void runStageJob(job).catch((err) => {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.updatedAt = Date.now();
  });
  return job;
}

export const stageJobsRouter = createRouter({
  /** 提交异步任务：秒回，服务端后台执行，前端轮询 status */
  start: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        kind: z.enum(["analysis", "concepts", "evaluate"]),
        conceptId: z.string().optional(),
        totalEpisodes: z.number().int().min(1).max(120).optional(),
        episodeSeconds: z.number().int().min(30).max(300).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      if (input.kind === "evaluate" && !input.conceptId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "判档质检需要 conceptId" });
      }
      return publicJob(
        ensureStageJob(ctx.user, input.kind, input.projectId, input.conceptId, {
          totalEpisodes: input.totalEpisodes,
          episodeSeconds: input.episodeSeconds,
          notes: input.notes,
        }),
      );
    }),

  /** 轮询任务状态（秒回）。内存无任务时以落库数据判定：已完成→done，否则→idle（可重新提交） */
  status: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        kind: z.enum(["analysis", "concepts", "evaluate"]),
        conceptId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const job = stageJobs.get(stageJobKey(input.kind, input.projectId, input.conceptId));
      if (job) return publicJob(job);
      if (await dbDone(input.kind, input.projectId, input.conceptId)) {
        return { status: "done" as const, kind: input.kind, attempt: 0, error: undefined, updatedAt: Date.now() };
      }
      return { status: "idle" as const, kind: input.kind, attempt: 0, error: undefined, updatedAt: Date.now() };
    }),
});
