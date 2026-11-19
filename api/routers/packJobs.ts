// 剧本包异步产出任务：提交秒回 + 服务端后台逐步执行 + 前端轮询进度。
// 根治平台代理掐断长请求（Load failed）——浏览器侧不再有任何长请求；
// 任务断点不依赖内存：剧本包每步已落库（status=generating 的中间态），进程重启后按落库状态推断续跑位置（自愈）。
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { projects, remaps, scriptPacks } from "@db/schema";
import { pipelineRouter } from "./pipeline";
import type { TrpcContext } from "../context";
import type { ConceptScriptPack, RemapPool } from "@contracts/pipeline";

// 与 pipeline.ts 中的常量保持一致（首卡集数 / 每批集数）
const FIRST_CARD_EPISODES = 10;
const EPISODES_PER_CHUNK = 5;

type JobUser = NonNullable<TrpcContext["user"]>;

interface PackJob {
  key: string;
  projectId: number;
  conceptId: string;
  user: JobUser;
  status: "running" | "failed" | "done";
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
  providerId?: string;
  attempt: number;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

/** 进程内任务注册表（仅承载"正在跑/上次错误"的即时状态；断点以落库数据为准） */
const packJobs = new Map<string, PackJob>();
const packJobKey = (projectId: number, conceptId: string) => `${projectId}:${conceptId}`;

const publicJob = (j: PackJob) => ({
  status: j.status,
  stepIndex: j.stepIndex,
  totalSteps: j.totalSteps,
  stepLabel: j.stepLabel,
  attempt: j.attempt,
  error: j.error as string | undefined,
  updatedAt: j.updatedAt,
});

interface PackStepPlan {
  step: "foundation" | "episodes" | "promo";
  batch: number;
  label: string;
}

function packStepPlan(cardEpisodes: number): PackStepPlan[] {
  const batches = Math.ceil(cardEpisodes / EPISODES_PER_CHUNK);
  return [
    { step: "foundation", batch: 0, label: "方向卡 + 人物小传 + 全剧集纲" },
    ...Array.from({ length: batches }, (_, b) => ({
      step: "episodes" as const,
      batch: b,
      label: `第 ${b * EPISODES_PER_CHUNK + 1}~${Math.min((b + 1) * EPISODES_PER_CHUNK, cardEpisodes)} 集连贯剧本`,
    })),
    { step: "promo", batch: 0, label: "2 段投流素材" },
  ];
}

/** 按已落库的部分包推断续跑起点：已完成的步骤跳过（episodes 批次按集号区间幂等覆盖，重复跑安全但浪费，故跳过） */
function nextPackStepIndex(pack: ConceptScriptPack | null, plan: PackStepPlan[], cardEpisodes: number): number {
  if (pack?.status === "done") return plan.length;
  if (!pack?.directionCard || !pack.outline || !pack.characters?.length) return 0;
  const have = new Set((pack.episodes ?? []).map((e) => e.epNo));
  for (let b = 0; b < plan.length - 2; b++) {
    const start = b * EPISODES_PER_CHUNK + 1;
    const end = Math.min(start + EPISODES_PER_CHUNK - 1, cardEpisodes);
    for (let n = start; n <= end; n++) if (!have.has(n)) return 1 + b;
  }
  return plan.length - 1;
}

async function loadPack(projectId: number, conceptId: string): Promise<ConceptScriptPack | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(scriptPacks)
    .where(and(eq(scriptPacks.projectId, projectId), eq(scriptPacks.conceptId, conceptId)));
  return row ? (row.pack as ConceptScriptPack) : null;
}

async function loadRemapPool(projectId: number): Promise<RemapPool | null> {
  const db = getDb();
  const [remap] = await db.select().from(remaps).where(eq(remaps.projectId, projectId));
  return remap ? (remap.settings as RemapPool) : null;
}

async function ensureProject(userId: number, projectId: number) {
  const db = getDb();
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p || p.userId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
  }
  return p;
}

/** 后台执行器：逐步调用已有的分步生成过程（每步内部已含缺集自愈），每步最多 3 次尝试（10s/30s 退避）；失败保留断点，重新提交即可续跑 */
async function runPackJob(job: PackJob) {
  const caller = pipelineRouter.createCaller({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user: job.user,
  } as never);
  const pool = await loadRemapPool(job.projectId);
  if (!pool) {
    job.status = "failed";
    job.error = "换皮方案不存在";
    job.updatedAt = Date.now();
    return;
  }
  const cardEpisodes = Math.min(FIRST_CARD_EPISODES, pool.totalEpisodes);
  const plan = packStepPlan(cardEpisodes);
  job.totalSteps = plan.length;
  const pack = await loadPack(job.projectId, job.conceptId);
  job.stepIndex = nextPackStepIndex(pack, plan, cardEpisodes);
  job.updatedAt = Date.now();
  for (; job.stepIndex < plan.length; job.stepIndex++) {
    const s = plan[job.stepIndex];
    job.stepLabel = s.label;
    job.attempt = 0;
    job.updatedAt = Date.now();
    for (;;) {
      try {
        await caller.generateScriptPackStep({
          projectId: job.projectId,
          conceptId: job.conceptId,
          step: s.step,
          batch: s.batch,
          providerId: job.providerId,
        });
        break;
      } catch (err) {
        job.attempt++;
        job.updatedAt = Date.now();
        if (job.attempt >= 3) {
          job.status = "failed";
          job.error =
            err instanceof TRPCError ? err.message : err instanceof Error ? err.message : String(err);
          job.updatedAt = Date.now();
          return;
        }
        await new Promise((r) => setTimeout(r, job.attempt === 1 ? 10000 : 30000));
      }
    }
  }
  job.status = "done";
  job.stepLabel = "完成";
  job.updatedAt = Date.now();
}

/** 幂等提交：同包已有进行中任务则直接返回；失败/完成的任务重新提交会按落库断点续跑 */
function ensurePackJob(user: JobUser, projectId: number, conceptId: string, providerId?: string): PackJob {
  const key = packJobKey(projectId, conceptId);
  const existing = packJobs.get(key);
  if (existing?.status === "running") return existing;
  const job: PackJob = {
    key,
    projectId,
    conceptId,
    providerId,
    user,
    status: "running",
    stepIndex: 0,
    totalSteps: 0,
    stepLabel: "排队中",
    attempt: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  packJobs.set(key, job);
  void runPackJob(job).catch((err) => {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.updatedAt = Date.now();
  });
  return job;
}

export const packJobsRouter = createRouter({
  /** 提交剧本包异步产出任务：秒回，服务端后台逐步执行（每步落库），前端轮询 status。重复提交幂等；force=true 清掉旧包从头再来 */
  start: authedQuery
    .input(z.object({ projectId: z.number(), conceptId: z.string(), force: z.boolean().optional(), providerId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const pool = await loadRemapPool(input.projectId);
      if (!pool) throw new TRPCError({ code: "BAD_REQUEST", message: "请先生成换皮方案" });
      if (!pool.selectedIds.includes(input.conceptId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该方案未入选，请先在换皮阶段粗选" });
      }
      if (input.force) {
        const db = getDb();
        await db
          .delete(scriptPacks)
          .where(and(eq(scriptPacks.projectId, input.projectId), eq(scriptPacks.conceptId, input.conceptId)));
        packJobs.delete(packJobKey(input.projectId, input.conceptId));
      }
      return publicJob(ensurePackJob(ctx.user, input.projectId, input.conceptId, input.providerId));
    }),

  /** 轮询剧本包产出进度（秒回）。进程重启后无内存任务但包未完成的，自动从断点续跑（自愈） */
  status: authedQuery
    .input(z.object({ projectId: z.number(), conceptId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const job = packJobs.get(packJobKey(input.projectId, input.conceptId));
      if (job) return publicJob(job);
      const pack = await loadPack(input.projectId, input.conceptId);
      if (pack?.status === "done") {
        return {
          status: "done" as const,
          stepIndex: 0,
          totalSteps: 0,
          stepLabel: "已完成",
          attempt: 0,
          error: undefined,
          updatedAt: Date.now(),
        };
      }
      if (pack?.status === "generating") {
        return publicJob(ensurePackJob(ctx.user, input.projectId, input.conceptId));
      }
      return {
        status: "idle" as const,
        stepIndex: 0,
        totalSteps: 0,
        stepLabel: "",
        attempt: 0,
        error: undefined,
        updatedAt: Date.now(),
      };
    }),
});
