// 全集续写异步任务（编审定稿阶段）：从首卡（1~10 集）之后逐批续写到全剧总集数。
// 与 packJobs 同构：提交秒回 + 服务端后台逐批执行 + 前端轮询进度；
// 断点以落库的 episodes 为准（幂等按集号合并覆盖），进程重启后按缺集自动续跑（自愈）。
// 只追加 pack.episodes，不改 pack.status（首卡 done 状态不被续写打断）。
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { projects, remaps, scriptPacks } from "@db/schema";
import { pipelineRouter } from "./pipeline";
import type { TrpcContext } from "../context";
import type { ConceptScriptPack, RemapPool } from "@contracts/pipeline";

// 与 pipeline.ts / packJobs.ts 中的常量保持一致（首卡集数 / 每批集数）
const FIRST_CARD_EPISODES = 10;
const EPISODES_PER_CHUNK = 5;

type JobUser = NonNullable<TrpcContext["user"]>;

interface SeriesJob {
  key: string;
  projectId: number;
  conceptId: string;
  providerId?: string;
  user: JobUser;
  status: "running" | "failed" | "done";
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
  attempt: number;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

/** 进程内任务注册表（仅承载"正在跑/上次错误"的即时状态；断点以落库集数为准） */
const seriesJobs = new Map<string, SeriesJob>();
const seriesJobKey = (projectId: number, conceptId: string) => `${projectId}:${conceptId}`;

interface SeriesPlanStep {
  batch: number;
  start: number;
  end: number;
  label: string;
}

/** 续写批次计划：首卡之后每 5 集一批，直到全剧总集数 */
export function seriesPlan(totalEpisodes: number): SeriesPlanStep[] {
  const steps: SeriesPlanStep[] = [];
  for (let start = FIRST_CARD_EPISODES + 1; start <= totalEpisodes; start += EPISODES_PER_CHUNK) {
    const end = Math.min(start + EPISODES_PER_CHUNK - 1, totalEpisodes);
    steps.push({
      batch: steps.length,
      start,
      end,
      label: `第 ${start}~${end} 集连贯剧本（全集 ${totalEpisodes} 集之续写）`,
    });
  }
  return steps;
}

/** 按已落库集数推断续跑起点：批次内全部集都在库则跳过（幂等），返回第一个缺集的批次 */
export function nextSeriesBatchIndex(pack: ConceptScriptPack | null, plan: SeriesPlanStep[]): number {
  const have = new Set((pack?.episodes ?? []).map((e) => e.epNo));
  for (const s of plan) {
    for (let n = s.start; n <= s.end; n++) {
      if (!have.has(n)) return s.batch;
    }
  }
  return plan.length;
}

function episodesDone(pack: ConceptScriptPack | null, totalEpisodes: number): number {
  return Math.min((pack?.episodes ?? []).filter((e) => e.epNo <= totalEpisodes).length, totalEpisodes);
}

const publicJob = (j: SeriesJob, pack: ConceptScriptPack | null, totalEpisodes: number) => ({
  status: j.status,
  stepIndex: j.stepIndex,
  totalSteps: j.totalSteps,
  stepLabel: j.stepLabel,
  attempt: j.attempt,
  error: j.error as string | undefined,
  episodesDone: episodesDone(pack, totalEpisodes),
  targetEpisodes: totalEpisodes,
  updatedAt: j.updatedAt,
});

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

/** 后台执行器：逐批调用 pipeline 的 series 步（批内已含缺集自愈），每批最多 3 次尝试（10s/30s 退避）；失败保留断点，重新提交即可续跑 */
async function runSeriesJob(job: SeriesJob) {
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
  const plan = seriesPlan(pool.totalEpisodes);
  job.totalSteps = plan.length;
  const pack = await loadPack(job.projectId, job.conceptId);
  job.stepIndex = nextSeriesBatchIndex(pack, plan);
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
          step: "series",
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

/** 幂等提交：同方案已有进行中任务则直接返回；失败/部分完成的任务重新提交会按落库断点续跑 */
function ensureSeriesJob(user: JobUser, projectId: number, conceptId: string, providerId?: string): SeriesJob {
  const key = seriesJobKey(projectId, conceptId);
  const existing = seriesJobs.get(key);
  if (existing?.status === "running") return existing;
  const job: SeriesJob = {
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
  seriesJobs.set(key, job);
  void runSeriesJob(job).catch((err) => {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.updatedAt = Date.now();
  });
  return job;
}

export const seriesJobsRouter = createRouter({
  /** 提交全集续写任务：秒回，服务端后台逐批执行（每批落库），前端轮询 status。重复提交幂等 */
  start: authedQuery
    .input(z.object({ projectId: z.number(), conceptId: z.string(), providerId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const pool = await loadRemapPool(input.projectId);
      if (!pool) throw new TRPCError({ code: "BAD_REQUEST", message: "请先生成换皮方案" });
      if (!pool.selectedIds.includes(input.conceptId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该方案未入选，请先在换皮阶段粗选" });
      }
      if (pool.totalEpisodes <= FIRST_CARD_EPISODES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `总集数 ${pool.totalEpisodes} ≤ 首卡 ${FIRST_CARD_EPISODES} 集，首卡即全集，无需续写`,
        });
      }
      const pack = await loadPack(input.projectId, input.conceptId);
      if (!pack) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该方案还没有剧本包，请先到「剧本产出」生成首卡" });
      }
      if (!pack.directionCard || !pack.outline || !pack.characters?.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该剧本包为旧版格式，请先「重新产出（新版格式）」再续写全集" });
      }
      if (pack.status !== "done") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "首卡尚未产出完成，请先完成剧本包产出再续写全集" });
      }
      const job = ensureSeriesJob(ctx.user, input.projectId, input.conceptId, input.providerId);
      return publicJob(job, pack, pool.totalEpisodes);
    }),

  /** 轮询续写进度（秒回）。进程重启后无内存任务但集数不全的，自动从缺集批次续跑（自愈）；全集已齐→done；从未开始→idle */
  status: authedQuery
    .input(z.object({ projectId: z.number(), conceptId: z.string() }))
    .query(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const pool = await loadRemapPool(input.projectId);
      const totalEpisodes = pool?.totalEpisodes ?? FIRST_CARD_EPISODES;
      const pack = await loadPack(input.projectId, input.conceptId);
      const job = seriesJobs.get(seriesJobKey(input.projectId, input.conceptId));
      if (job) return publicJob(job, pack, totalEpisodes);
      if (nextSeriesBatchIndex(pack, seriesPlan(totalEpisodes)) >= seriesPlan(totalEpisodes).length) {
        // 全集已齐（含 totalEpisodes ≤ 首卡的自然完成态）
        return {
          status: "done" as const,
          stepIndex: 0,
          totalSteps: 0,
          stepLabel: "全集已完成",
          attempt: 0,
          error: undefined,
          episodesDone: episodesDone(pack, totalEpisodes),
          targetEpisodes: totalEpisodes,
          updatedAt: Date.now(),
        };
      }
      if ((pack?.episodes ?? []).some((e) => e.epNo > FIRST_CARD_EPISODES)) {
        // 有部分续写但无进行中任务 = 中断态，自动拉起续跑
        const resumed = ensureSeriesJob(ctx.user, input.projectId, input.conceptId);
        return publicJob(resumed, pack, totalEpisodes);
      }
      return {
        status: "idle" as const,
        stepIndex: 0,
        totalSteps: 0,
        stepLabel: "",
        attempt: 0,
        error: undefined,
        episodesDone: episodesDone(pack, totalEpisodes),
        targetEpisodes: totalEpisodes,
        updatedAt: Date.now(),
      };
    }),
});
