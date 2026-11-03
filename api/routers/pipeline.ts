import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { generateObject } from "ai";
import { eq, and, asc } from "drizzle-orm";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  projects,
  samples,
  analyses,
  remaps,
  scriptPacks,
  evaluations,
} from "@db/schema";
import { getModel } from "../ai/provider";
import { classifyAiError } from "../ai/client";
import {
  EVALUATOR_CORE,
  SCRIPT_STAGE_RULES,
  EVAL_OUTPUT_FORMAT,
} from "../ai/evaluator";
import type {
  RedSegment,
  AnalysisResult,
  RemapPool,
  ConceptScriptPack,
  EpisodeScript,
  EvalReport,
  StoredSourceFile,
} from "@contracts/pipeline";

// ---------- zod schemas（与 contracts/pipeline.ts 对齐） ----------

const redSegmentSchema = z.object({
  id: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  note: z.string().optional(),
});

const analysisSchema = z.object({
  dramaType: z.string().describe("剧型判断：复仇/逆袭/甜宠/虐恋/禁忌恋/后悔流/金手指/男色情欲等，用通用流派名"),
  coreExpectation: z.string().describe("核心期待：观众为什么爱看、为什么付费（结构性，非具体情节）。注意：处境/背景/元素噱头都不算期待"),
  elements: z.array(z.string()).describe("元素清单：把人拉进来的噱头（萌宝/马甲/契约/金手指/复仇/狼人等），不能占核心期待的位置"),
  genre: z.string().describe("题材定位，如：狼人禁忌之恋 / 亿万富翁契约婚姻"),
  tropeSummary: z.string().describe("核心套路一句话总结"),
  protagonist: z.string().describe("主角人设拆解"),
  antagonist: z.string().describe("反派/阻力设定"),
  coreConflict: z.string().describe("核心冲突"),
  hookRhythm: z.string().describe("钩子节奏规律（每多少秒/多少场一个钩子，如何升级）"),
  hookTypes: z.array(z.string()).describe("出现的钩子类型清单"),
  paywallPattern: z.string().describe("付费卡点设置规律（卡点兑现的是什么、卡在第几集、由谁的主动选择构成）"),
  redSegmentTraits: z
    .array(z.object({ quote: z.string(), trait: z.string() }))
    .describe("每个红标段的原文摘录(短)与它之所以能爆的原因（情绪卖点/核心期待）"),
  transferableElements: z.array(z.string()).describe("可迁移到新作的爆款元素"),
  marketFit: z.string().describe("目标市场适配要点"),
});

const conceptSchema = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.string(),
  protagonist: z.string(),
  setting: z.string(),
  twist: z.string().describe("本方案的核心差异化卖点——为什么这版能爆"),
  keepElements: z.array(z.string()),
});


const scriptSceneSchema = z.object({
  sceneNo: z.number().int(),
  location: z.string(),
  time: z.string(),
  beats: z.array(
    z.object({
      type: z.enum(["action", "dialogue"]),
      character: z.string().optional(),
      text: z.string(),
    }),
  ),
});

const episodeScriptSchema = z.object({
  epNo: z.number().int(),
  title: z.string(),
  scenes: z.array(scriptSceneSchema),
  cliffhanger: z.string().describe("本集结尾悬念（下集钩子）"),
});

const promoClipSchema = z.object({
  id: z.string(),
  positionHint: z.string().describe("建议落点，如 '第8集前后' / '大结局前'，不要求与连贯集衔接"),
  premise: z.string().describe("这段戏的情境前提，让观众秒懂"),
  scene: scriptSceneSchema,
  hookLine: z.string().describe("可直接上大字幕的金句"),
});

const conceptPackSchema = z.object({
  logline: z.string().describe("本方案一句话卖点"),
  episodes: z.array(episodeScriptSchema).min(3).max(5).describe("3~5 集连贯剧本，本身即可投流"),
  promoClips: z.array(promoClipSchema).length(2).describe("2 段不连贯的投流素材剧本原文"),
});

/** 判档质检报告 */
const evalReportSchema = z.object({
  verdict: z.enum(["pass", "pass_with_fixes", "revise_resubmit", "fail"]),
  grade: z.string().optional().describe("通过档内分级：B / B+"),
  coreExpectationCheck: z.string().describe("核心期待 = ___；元素 = ___，及卡点匹配核对"),
  blockers: z
    .array(
      z.object({
        issue: z.string(),
        fix: z.string().describe("具体到场面的改法"),
        level: z.string().describe("L1 执行 / L2 位置 / L3 结构 / L4 骨架"),
      }),
    )
    .describe("阻挡项：不改就不能做。判 pass 时此数组必须为空"),
  optimizations: z
    .array(z.object({ issue: z.string(), fix: z.string() }))
    .describe("优化项：改了更好，不影响判档"),
  volumeTrack: z.string().describe("体量与赛道结论：集数建议 + 超点/订阅/常规"),
  summary: z.string().describe("一句话总评"),
});

// ---------- helpers ----------

async function ensureProject(userId: number, projectId: number) {
  const db = getDb();
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p || p.userId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
  }
  return p;
}

/** 把红标段以【RED】…【/RED】标记注入原文，供模型识别 */
function injectRedMarkers(content: string, segs: RedSegment[]): string {
  const sorted = [...segs]
    .filter((s) => s.end > s.start && s.start >= 0 && s.end <= content.length)
    .sort((a, b) => b.start - a.start);
  let out = content;
  for (const s of sorted) {
    out = out.slice(0, s.start) + "【RED】" + out.slice(s.start, s.end) + "【/RED】" + out.slice(s.end);
  }
  return out;
}

const MAX_SAMPLE_CHARS = 20000;

async function loadContext(projectId: number) {
  const db = getDb();
  const [sample] = await db.select().from(samples).where(eq(samples.projectId, projectId));
  const [analysis] = await db.select().from(analyses).where(eq(analyses.projectId, projectId));
  const [remap] = await db.select().from(remaps).where(eq(remaps.projectId, projectId));
  return { sample, analysis, remap };
}

async function loadRemapPool(projectId: number): Promise<RemapPool | null> {
  const db = getDb();
  const [remap] = await db.select().from(remaps).where(eq(remaps.projectId, projectId));
  return remap ? (remap.settings as RemapPool) : null;
}

async function saveRemapPool(projectId: number, pool: RemapPool) {
  const db = getDb();
  const [existing] = await db.select().from(remaps).where(eq(remaps.projectId, projectId));
  if (existing) {
    await db.update(remaps).set({ settings: pool }).where(eq(remaps.projectId, projectId));
  } else {
    await db.insert(remaps).values({ projectId, settings: pool });
  }
}

// ---------- router ----------

export const pipelineRouter = createRouter({
  /** 项目库列表（带流水线进度） */
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.select().from(projects).where(eq(projects.userId, ctx.user.id));
    const withProgress = await Promise.all(
      rows.map(async (p) => {
        const [sample] = await db.select().from(samples).where(eq(samples.projectId, p.id));
        const [remap] = await db.select().from(remaps).where(eq(remaps.projectId, p.id));
        const packRows = await db.select().from(scriptPacks).where(eq(scriptPacks.projectId, p.id));
        const pool = remap ? (remap.settings as RemapPool) : null;
        return {
          id: p.id,
          title: p.title,
          sourceTitle: p.sourceTitle,
          createdAt: p.createdAt,
          progress: {
            hasSample: !!sample,
            selectedCount: pool?.selectedIds.length ?? 0,
            packCount: packRows.length,
            finalId: pool?.finalId ?? null,
          },
        };
      }),
    );
    return withProgress.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }),

  /** 新建项目 */
  create: authedQuery
    .input(z.object({ title: z.string().min(1).max(255), sourceTitle: z.string().max(255).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db.insert(projects).values({
        userId: ctx.user.id,
        title: input.title,
        sourceTitle: input.sourceTitle ?? null,
      });
      const [p] = await db.select().from(projects).where(eq(projects.userId, ctx.user.id)).orderBy(asc(projects.id));
      const all = await db.select().from(projects).where(eq(projects.userId, ctx.user.id));
      const newest = all.sort((a, b) => b.id - a.id)[0];
      void p;
      return { id: newest.id };
    }),

  /** 删除项目（连带所有阶段数据） */
  remove: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.id);
      const db = getDb();
      for (const t of [samples, analyses, remaps, scriptPacks, evaluations] as const) {
        await db.delete(t).where(eq(t.projectId, input.id));
      }
      await db.delete(projects).where(eq(projects.id, input.id));
      return { ok: true };
    }),

  /** 拉取项目全量流水线数据 */
  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const p = await ensureProject(ctx.user.id, input.id);
      const db = getDb();
      const { sample, analysis, remap } = await loadContext(input.id);
      const packRows = await db
        .select()
        .from(scriptPacks)
        .where(eq(scriptPacks.projectId, input.id))
        .orderBy(asc(scriptPacks.conceptId));
      const evaluationRows = await db
        .select()
        .from(evaluations)
        .where(eq(evaluations.projectId, input.id))
        .orderBy(asc(evaluations.createdAt));
      return {
        project: p,
        sample: sample
          ? {
              content: sample.content,
              redSegments: sample.redSegments as RedSegment[],
              sourceFile: sample.sourceFile as StoredSourceFile | null,
            }
          : null,
        analysis: analysis ? (analysis.result as AnalysisResult) : null,
        remapPool: remap ? (remap.settings as RemapPool) : null,
        packs: packRows.map((r) => r.pack as ConceptScriptPack),
        evaluations: evaluationRows.map((r) => ({
          scope: r.scope as EvalReport["scope"],
          epNo: r.epNo,
          report: r.report as EvalReport,
          createdAt: r.createdAt,
        })),
      };
    }),

  /** 保存样本（原文 + 红标段，可选原始 docx 文件） */
  saveSample: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        content: z.string().min(10).max(200000),
        redSegments: z.array(redSegmentSchema).max(200),
        sourceFile: z
          .object({
            name: z.string().max(255),
            mime: z.string().max(100),
            size: z.number().int().max(12 * 1024 * 1024),
            dataB64: z.string().max(16 * 1024 * 1024).optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const db = getDb();
      const [existing] = await db.select().from(samples).where(eq(samples.projectId, input.projectId));
      // 未显式传入 sourceFile（普通粘贴保存）→ 保留已有文件；显式 null → 清除
      const sourceFile = input.sourceFile === undefined ? (existing?.sourceFile ?? null) : input.sourceFile;
      if (existing) {
        await db
          .update(samples)
          .set({ content: input.content, redSegments: input.redSegments, sourceFile })
          .where(eq(samples.projectId, input.projectId));
      } else {
        await db.insert(samples).values({
          projectId: input.projectId,
          content: input.content,
          redSegments: input.redSegments,
          sourceFile,
        });
      }
      return { ok: true };
    }),

  /** AI 拆解爆款样本（重点分析红标段为何能爆：核心期待 × 情绪卖点） */
  runAnalysis: authedQuery
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const { sample } = await loadContext(input.projectId);
      if (!sample) throw new TRPCError({ code: "BAD_REQUEST", message: "请先录入爆款样本" });
      const segs = (sample.redSegments ?? []) as RedSegment[];
      const marked = injectRedMarkers(sample.content.slice(0, MAX_SAMPLE_CHARS), segs);
      try {
        const { object } = await generateObject({
          model: await getModel(),
          schema: analysisSchema,
          prompt: [
            "你是资深海外竖屏短剧（ReelShort / DramaBox 类）爆款内容分析师。",
            "下面是一部海外爆款短剧的剧本/剧情样本。其中用【RED】…【/RED】包裹的段落是投流数据特别好的素材段落（用户重点标注）。",
            "请对样本做结构化拆解，**重点分析这些红标段为什么能成为投流爆款**——每一段都要回答：它抓住的核心期待是什么、情绪卖点是什么（爽点/虐点/反转/代入感），以及它为什么能在前 3 秒抓住人。所有字段用中文输出。",
            "",
            "【最重要的分析纪律】核心期待 ≠ 元素：",
            "- 核心期待（coreExpectation）= 观众为什么愿意一直看下去、为什么愿意付费——它是一句「观众在等的一件事」，例如「等着看被赶出家门的女主以集团董事长身份回来打脸所有人」。",
            "- 元素（elements）= 服务于核心期待的桥段、身份、道具、设定 gimmick，例如「隐藏身份」「假死」「拍卖会亮身份」。元素可以换，核心期待不能丢。",
            "- dramaType 填写品类判断（如：女频-豪门复仇、男频-战神赘婿、女频-甜宠闪婚 等），一句话点明赛道。",
            "- redSegmentTraits 里每个红标段的 trait 必须聚焦「这段之所以能爆的原因」——具体说清楚它命中了哪种情绪、制造了什么期待。",
            "- paywallPattern 必须回答三件事：卡点兑现的是什么期待、卡在第几集、由谁的主动选择构成（不能是巧合/误会自然解开）。",
            "",
            "===== 爆款样本 =====",
            marked,
            "===== 样本结束 =====",
          ].join("\n"),
        });
        const db = getDb();
        const [existing] = await db.select().from(analyses).where(eq(analyses.projectId, input.projectId));
        if (existing) {
          await db.update(analyses).set({ result: object }).where(eq(analyses.projectId, input.projectId));
        } else {
          await db.insert(analyses).values({ projectId: input.projectId, result: object });
        }
        return object as AnalysisResult;
      } catch (err) {
        throw classifyAiError(err);
      }
    }),

  /** 换皮：AI 一次产出 10 个换皮方案（不直接写剧本） */
  generateConcepts: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        totalEpisodes: z.number().int().min(1).max(120),
        episodeSeconds: z.number().int().min(30).max(300),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const { analysis } = await loadContext(input.projectId);
      if (!analysis) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先完成 AI 拆解" });
      }
      const a = analysis.result as AnalysisResult;
      try {
        const { object } = await generateObject({
          model: await getModel(),
          schema: z.object({ concepts: z.array(conceptSchema).length(10) }),
          prompt: [
            "你是资深海外竖屏短剧策划。基于一份爆款短剧的拆解报告，产出 **10 个完全不同的「换皮」复刻方案**。",
            "每个方案都要：保留爆款的核心期待与被验证有效的元素，但题材、人设、世界观彻底换新，且 10 个方案之间必须覆盖差异足够大的赛道（不要都是同一类）。",
            "",
            "每个方案必须写清 twist——它凭什么能爆（差异化卖点），而不是泛泛说「很爽」。",
            "",
            "===== 爆款拆解报告 =====",
            `剧型赛道：${a.dramaType}`,
            `核心期待：${a.coreExpectation}`,
            `可迁移爆款元素：${a.transferableElements.join("、")}`,
            `钩子节奏：${a.hookRhythm}`,
            `付费卡点规律：${a.paywallPattern}`,
            `目标市场适配：${a.marketFit}`,
            input.notes ? `\n用户补充要求：${input.notes}` : "",
          ].join("\n"),
        });
        const pool: RemapPool = {
          concepts: object.concepts,
          selectedIds: [],
          totalEpisodes: input.totalEpisodes,
          episodeSeconds: input.episodeSeconds,
          notes: input.notes,
        };
        await saveRemapPool(input.projectId, pool);
        return pool;
      } catch (err) {
        throw classifyAiError(err);
      }
    }),

  /** 人工粗选：从 10 个方案里勾选 3~5 个进入剧本产出 */
  selectConcepts: authedQuery
    .input(z.object({ projectId: z.number(), selectedIds: z.array(z.string()).min(1).max(5) }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const pool = await loadRemapPool(input.projectId);
      if (!pool) throw new TRPCError({ code: "BAD_REQUEST", message: "请先生成换皮方案" });
      const valid = new Set(pool.concepts.map((c) => c.id));
      for (const id of input.selectedIds) {
        if (!valid.has(id)) throw new TRPCError({ code: "BAD_REQUEST", message: `方案 ${id} 不存在` });
      }
      pool.selectedIds = input.selectedIds;
      pool.finalId = undefined; // 重选后清空定稿
      await saveRemapPool(input.projectId, pool);
      return pool;
    }),

  /** 为一个入选方案生成完整剧本包：3~5 集连贯剧本 + 2 段不连贯投流素材 */
  generateScriptPack: authedQuery
    .input(z.object({ projectId: z.number(), conceptId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const { sample, analysis } = await loadContext(input.projectId);
      const pool = await loadRemapPool(input.projectId);
      if (!pool) throw new TRPCError({ code: "BAD_REQUEST", message: "请先生成换皮方案" });
      const concept = pool.concepts.find((c) => c.id === input.conceptId);
      if (!concept) throw new TRPCError({ code: "BAD_REQUEST", message: "方案不存在" });
      if (!pool.selectedIds.includes(input.conceptId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该方案未入选，请先在换皮阶段粗选" });
      }
      const a = analysis ? (analysis.result as AnalysisResult) : null;
      const segs = sample ? ((sample.redSegments ?? []) as RedSegment[]) : [];
      const redTexts = segs
        .filter((s) => s.end > s.start && s.end <= (sample?.content.length ?? 0))
        .map((s) => sample!.content.slice(s.start, s.end).slice(0, 500));
      try {
        const { object } = await generateObject({
          model: await getModel(),
          schema: conceptPackSchema,
          prompt: [
            "你是资深海外竖屏短剧总编剧。基于一个换皮方案，产出可直接投流测试的剧本包。",
            "",
            "【产出要求】",
            "1. episodes：3~5 集**连贯**剧本（epNo 从 1 连续编号）。这前几集本身就必须是可投流的素材——开场 3 秒出钩子、每集结尾强悬念、把最炸的情绪点前置。",
            "2. promoClips：**恰好 2 段不连贯的投流素材剧本**。它们可以发生在后面任意集数（比如第 8 集、大结局前），不要求与前 3~5 集情节连续——因为投流素材本来就常常取自全剧最炸的段落，不一定都在开头。每段是一个独立高密度单场戏， premise 要让完全没看过前情的观众秒懂。",
            "3. 单集 2-4 个场景；台词短促、动作可视化、情绪浓度高；女主最后一击必须亲自完成；反派坏而不蠢；关键信息用可视物证呈现；狠话改当下动作。",
            "4. 不得抄袭原作具体情节与台词，只保留情绪结构与节奏骨架。",
            "",
            "===== 换皮方案 =====",
            `题材：${concept.genre}`,
            `主角：${concept.protagonist}`,
            `背景：${concept.setting}`,
            `差异化卖点：${concept.twist}`,
            `沿用爆款元素：${concept.keepElements.join("、") || "（无）"}`,
            `新剧总集数：${pool.totalEpisodes}，单集约 ${pool.episodeSeconds} 秒`,
            "",
            a ? `===== 爆款核心期待（全剧主线服务于此） =====\n${a.coreExpectation}\n\n钩子节奏参考：${a.hookRhythm}\n付费卡点规律：${a.paywallPattern}` : "",
            redTexts.length
              ? `\n===== 已验证的投流爆款素材段（供情绪结构参考，勿照抄） =====\n${redTexts.map((t, i) => `【素材${i + 1}】${t}`).join("\n\n")}`
              : "",
          ].join("\n"),
        });
        const pack: ConceptScriptPack = {
          conceptId: input.conceptId,
          logline: object.logline,
          episodes: object.episodes as EpisodeScript[],
          promoClips: object.promoClips,
          status: "done",
        };
        const db = getDb();
        const [existing] = await db
          .select()
          .from(scriptPacks)
          .where(and(eq(scriptPacks.projectId, input.projectId), eq(scriptPacks.conceptId, input.conceptId)));
        if (existing) {
          await db
            .update(scriptPacks)
            .set({ pack })
            .where(and(eq(scriptPacks.projectId, input.projectId), eq(scriptPacks.conceptId, input.conceptId)));
        } else {
          await db.insert(scriptPacks).values({ projectId: input.projectId, conceptId: input.conceptId, pack });
        }
        return pack;
      } catch (err) {
        throw classifyAiError(err);
      }
    }),

  /** 编审定稿：从入选方案里选出最终 1 个 */
  finalizeConcept: authedQuery
    .input(z.object({ projectId: z.number(), conceptId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const pool = await loadRemapPool(input.projectId);
      if (!pool) throw new TRPCError({ code: "BAD_REQUEST", message: "请先生成换皮方案" });
      if (!pool.selectedIds.includes(input.conceptId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只能从已入选的方案里定稿" });
      }
      pool.finalId = input.conceptId;
      await saveRemapPool(input.projectId, pool);
      return pool;
    }),

  /** 判档质检：某个方案的剧本包（建议性报告） */
  evaluatePack: authedQuery
    .input(z.object({ projectId: z.number(), conceptId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const db = getDb();
      const { analysis } = await loadContext(input.projectId);
      const [packRow] = await db
        .select()
        .from(scriptPacks)
        .where(and(eq(scriptPacks.projectId, input.projectId), eq(scriptPacks.conceptId, input.conceptId)));
      if (!packRow) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该方案还没有剧本包" });
      }
      const pack = packRow.pack as ConceptScriptPack;
      const a = analysis ? (analysis.result as AnalysisResult) : null;
      try {
        const { object } = await generateObject({
          model: await getModel(),
          schema: evalReportSchema,
          prompt: [
            EVALUATOR_CORE,
            "",
            SCRIPT_STAGE_RULES,
            "",
            EVAL_OUTPUT_FORMAT,
            "",
            a?.coreExpectation ? `原爆款核心期待参考：${a.coreExpectation}` : "",
            "",
            `===== 剧本包（${pack.episodes.length} 集连贯 + ${pack.promoClips.length} 段投流素材） =====`,
            JSON.stringify({ logline: pack.logline, episodes: pack.episodes, promoClips: pack.promoClips }, null, 2),
          ].join("\n"),
        });
        const report: EvalReport = { ...object, scope: "script" } as EvalReport;
        const epKey = 0; // 包级报告统一记 epNo=0，conceptId 放 report 外不再细分
        const [existing] = await db
          .select()
          .from(evaluations)
          .where(and(eq(evaluations.projectId, input.projectId), eq(evaluations.scope, "pack"), eq(evaluations.epNo, epKey)));
        if (existing) {
          await db
            .update(evaluations)
            .set({ report })
            .where(and(eq(evaluations.projectId, input.projectId), eq(evaluations.scope, "pack"), eq(evaluations.epNo, epKey)));
        } else {
          await db.insert(evaluations).values({ projectId: input.projectId, scope: "pack", epNo: epKey, report });
        }
        return report;
      } catch (err) {
        throw classifyAiError(err);
      }
    }),
});
