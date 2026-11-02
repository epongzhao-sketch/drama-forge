import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { generateObject } from "ai";
import { eq, and, asc, count } from "drizzle-orm";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  projects,
  samples,
  analyses,
  remaps,
  bibles,
  outlines,
  scripts,
  transplants,
  evaluations,
} from "@db/schema";
import { getModel } from "../ai/provider";
import { classifyAiError } from "../ai/client";
import {
  EVALUATOR_CORE,
  OUTLINE_STAGE_RULES,
  SCRIPT_STAGE_RULES,
  EVAL_OUTPUT_FORMAT,
} from "../ai/evaluator";
import type {
  RedSegment,
  AnalysisResult,
  RemapSettings,
  BibleResult,
  OutlineEpisode,
  EpisodeScript,
  TransplantMapping,
  EvalReport,
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
    .describe("每个红标段的原文摘录(短)与它的爆款特征"),
  transferableElements: z.array(z.string()).describe("可迁移到新作的爆款元素"),
  marketFit: z.string().describe("目标市场适配要点"),
});

const remapSchema = z.object({
  newGenre: z.string().min(1),
  protagonist: z.string().min(1),
  setting: z.string().min(1),
  audience: z.string().min(1),
  totalEpisodes: z.number().int().min(1).max(120),
  episodeSeconds: z.number().int().min(30).max(300),
  keepElements: z.array(z.string()),
  extraNotes: z.string().optional(),
});

const bibleSchema = z.object({
  titleZh: z.string(),
  titleEn: z.string(),
  loglineZh: z.string(),
  loglineEn: z.string(),
  worldview: z.string(),
  characters: z.array(
    z.object({ name: z.string(), role: z.string(), bio: z.string() }),
  ),
  mainConflict: z.string(),
  toneAndStyle: z.string(),
  episodeFormula: z.string().describe("单集结构公式：开场钩-冲突升级-结尾悬念的节拍模板"),
});

const outlineBatchSchema = z.object({
  episodes: z.array(
    z.object({
      epNo: z.number().int(),
      title: z.string(),
      summary: z.string().describe("本集剧情梗概，100字内"),
      hook: z.string().describe("本集核心钩子/结尾悬念"),
      paywall: z.boolean().describe("本集是否为付费卡点集"),
    }),
  ),
});

/** 桥段移植映射 */
const transplantBatchSchema = z.object({
  mappings: z.array(
    z.object({
      redSegmentId: z.string().describe("对应红标段 id，原样回传"),
      sourceQuote: z.string().describe("红标段原文短摘录"),
      sourcePosition: z.string().describe("该段在原作中的位置描述，如'原稿第33集反求婚'"),
      targetEp: z.number().int().describe("换算到新剧的集号"),
      bridgeType: z.string().describe("桥段类型：反求婚/身份揭示/护妻宣言/当众打脸等"),
      spec: z.string().describe("移植后的写法要点：如何同构到新题材，以及重点描写要求"),
    }),
  ),
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

const scriptSchema = z.object({
  epNo: z.number().int(),
  title: z.string(),
  scenes: z.array(
    z.object({
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
    }),
  ),
  cliffhanger: z.string().describe("本集结尾悬念（下集钩子）"),
  transplantScenes: z
    .array(z.number().int())
    .optional()
    .describe("移植桥段所在的场景号（仅本集被安排了桥段移植时填写）"),
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
  const [bible] = await db.select().from(bibles).where(eq(bibles.projectId, projectId));
  const [transplant] = await db.select().from(transplants).where(eq(transplants.projectId, projectId));
  return { sample, analysis, remap, bible, transplant };
}

// ---------- router ----------

export const pipelineRouter = createRouter({
  /** 项目库列表（带流水线进度） */
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, ctx.user.id))
      .orderBy(asc(projects.createdAt));
    const result = [];
    for (const p of rows) {
      const [{ value: outlineCount }] = await db
        .select({ value: count() })
        .from(outlines)
        .where(eq(outlines.projectId, p.id));
      const [{ value: scriptCount }] = await db
        .select({ value: count() })
        .from(scripts)
        .where(eq(scripts.projectId, p.id));
      const [sample] = await db.select({ id: samples.id }).from(samples).where(eq(samples.projectId, p.id));
      const [analysis] = await db.select({ id: analyses.id }).from(analyses).where(eq(analyses.projectId, p.id));
      const [bible] = await db.select({ id: bibles.id }).from(bibles).where(eq(bibles.projectId, p.id));
      result.push({
        ...p,
        progress: {
          hasSample: !!sample,
          hasAnalysis: !!analysis,
          hasBible: !!bible,
          outlineCount,
          scriptCount,
        },
      });
    }
    return result.reverse();
  }),

  create: authedQuery
    .input(z.object({ title: z.string().min(1).max(255), sourceTitle: z.string().max(255).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [r] = await db.insert(projects).values({
        userId: ctx.user.id,
        title: input.title,
        sourceTitle: input.sourceTitle || null,
      });
      const [p] = await db.select().from(projects).where(eq(projects.id, r.insertId));
      return p;
    }),

  remove: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.id);
      const db = getDb();
      await db.delete(scripts).where(eq(scripts.projectId, input.id));
      await db.delete(outlines).where(eq(outlines.projectId, input.id));
      await db.delete(bibles).where(eq(bibles.projectId, input.id));
      await db.delete(remaps).where(eq(remaps.projectId, input.id));
      await db.delete(analyses).where(eq(analyses.projectId, input.id));
      await db.delete(samples).where(eq(samples.projectId, input.id));
      await db.delete(transplants).where(eq(transplants.projectId, input.id));
      await db.delete(evaluations).where(eq(evaluations.projectId, input.id));
      await db.delete(projects).where(eq(projects.id, input.id));
      return { ok: true };
    }),

  /** 项目全量详情 */
  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const p = await ensureProject(ctx.user.id, input.id);
      const db = getDb();
      const { sample, analysis, remap, bible } = await loadContext(input.id);
      const outlineRows = await db
        .select()
        .from(outlines)
        .where(eq(outlines.projectId, input.id))
        .orderBy(asc(outlines.epNo));
      const scriptRows = await db
        .select()
        .from(scripts)
        .where(eq(scripts.projectId, input.id))
        .orderBy(asc(scripts.epNo));
      const [transplantRow] = await db.select().from(transplants).where(eq(transplants.projectId, input.id));
      const evaluationRows = await db
        .select()
        .from(evaluations)
        .where(eq(evaluations.projectId, input.id))
        .orderBy(asc(evaluations.createdAt));
      return {
        project: p,
        sample: sample
          ? { content: sample.content, redSegments: sample.redSegments as RedSegment[] }
          : null,
        analysis: analysis ? (analysis.result as AnalysisResult) : null,
        remap: remap ? (remap.settings as RemapSettings) : null,
        bible: bible ? (bible.content as BibleResult) : null,
        outlines: outlineRows.map((r) => r.data as OutlineEpisode),
        scripts: scriptRows.map((r) => ({
          epNo: r.epNo,
          contentZh: r.contentZh as EpisodeScript | null,
          contentEn: r.contentEn as EpisodeScript | null,
        })),
        transplants: transplantRow ? (transplantRow.mappings as TransplantMapping[]) : null,
        evaluations: evaluationRows.map((r) => ({
          scope: r.scope as EvalReport["scope"],
          epNo: r.epNo,
          report: r.report as EvalReport,
          createdAt: r.createdAt,
        })),
      };
    }),

  /** 保存样本（原文 + 红标段） */
  saveSample: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        content: z.string().min(10).max(200000),
        redSegments: z.array(redSegmentSchema).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const db = getDb();
      const [existing] = await db.select().from(samples).where(eq(samples.projectId, input.projectId));
      if (existing) {
        await db
          .update(samples)
          .set({ content: input.content, redSegments: input.redSegments })
          .where(eq(samples.projectId, input.projectId));
      } else {
        await db.insert(samples).values({
          projectId: input.projectId,
          content: input.content,
          redSegments: input.redSegments,
        });
      }
      return { ok: true };
    }),

  /** AI 拆解爆款样本 */
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
            "请对样本做结构化拆解，重点分析红标段落为什么有效（情绪点、信息密度、台词节奏、反转方式）。所有字段用中文输出。",
            "",
            "【最重要的分析纪律】核心期待 ≠ 元素：",
            "- 核心期待（coreExpectation）= 观众为什么愿意一直看下去、为什么愿意付费——它是一句「观众在等的一件事」，例如「等着看被赶出家门的女主以集团董事长身份回来打脸所有人」。",
            "- 元素（elements）= 服务于核心期待的桥段、身份、道具、设定 gimmick，例如「隐藏身份」「假死」「拍卖会亮身份」。元素可以换，核心期待不能丢。",
            "- dramaType 填写品类判断（如：女频-豪门复仇、男频-战神赘婿、女频-甜宠闪婚 等），一句话点明赛道。",
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

  /** 保存换皮设定 */
  saveRemap: authedQuery
    .input(z.object({ projectId: z.number(), settings: remapSchema }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const db = getDb();
      const [existing] = await db.select().from(remaps).where(eq(remaps.projectId, input.projectId));
      if (existing) {
        await db.update(remaps).set({ settings: input.settings }).where(eq(remaps.projectId, input.projectId));
      } else {
        await db.insert(remaps).values({ projectId: input.projectId, settings: input.settings });
      }
      return { ok: true };
    }),

  /** 生成总纲 */
  generateBible: authedQuery
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const { analysis, remap } = await loadContext(input.projectId);
      if (!analysis || !remap) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先完成 AI 拆解与换皮设定" });
      }
      const a = analysis.result as AnalysisResult;
      const r = remap.settings as RemapSettings;
      try {
        const { object } = await generateObject({
          model: await getModel(),
          schema: bibleSchema,
          prompt: [
            "你是资深海外竖屏短剧总编剧。基于一份爆款短剧的拆解报告与用户的「换皮复刻」设定，创作一部全新短剧的总纲（Series Bible）。",
            "要求：保留爆款的节奏骨架与被验证有效的元素，但题材、人物、世界观全部换新，不得抄袭原作具体情节与台词。",
            "",
            "===== 爆款拆解报告 =====",
            JSON.stringify(a, null, 2),
            "",
            "===== 换皮设定 =====",
            `新题材：${r.newGenre}`,
            `主角设定：${r.protagonist}`,
            `时代/背景：${r.setting}`,
            `目标受众：${r.audience}`,
            `总集数：${r.totalEpisodes}，单集时长：${r.episodeSeconds} 秒`,
            `必须保留的爆款元素：${r.keepElements.join("；") || "（无）"}`,
            r.extraNotes ? `补充要求：${r.extraNotes}` : "",
            "",
            "剧名与 logline 需要中英双语，其余字段中文即可。",
          ].join("\n"),
        });
        const db = getDb();
        const [existing] = await db.select().from(bibles).where(eq(bibles.projectId, input.projectId));
        if (existing) {
          await db.update(bibles).set({ content: object }).where(eq(bibles.projectId, input.projectId));
        } else {
          await db.insert(bibles).values({ projectId: input.projectId, content: object });
        }
        return object as BibleResult;
      } catch (err) {
        throw classifyAiError(err);
      }
    }),

  /** 批量生成分集大纲 */
  generateOutlines: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        from: z.number().int().min(1),
        count: z.number().int().min(1).max(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const { analysis, remap, bible } = await loadContext(input.projectId);
      if (!bible || !remap) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先生成总纲" });
      }
      const b = bible.content as BibleResult;
      const r = remap.settings as RemapSettings;
      const a = analysis ? (analysis.result as AnalysisResult) : null;
      const db = getDb();
      const existing = await db
        .select()
        .from(outlines)
        .where(eq(outlines.projectId, input.projectId))
        .orderBy(asc(outlines.epNo));
      const previousEps = existing
        .map((row) => row.data as OutlineEpisode)
        .filter((e) => e.epNo < input.from)
        .slice(-3);
      const to = Math.min(input.from + input.count - 1, r.totalEpisodes);
      try {
        const { object } = await generateObject({
          model: await getModel(),
          schema: outlineBatchSchema,
          prompt: [
            "你是资深海外竖屏短剧编剧。基于总纲为短剧编写分集大纲。",
            `本次生成第 ${input.from} 集到第 ${to} 集（全剧共 ${r.totalEpisodes} 集，单集约 ${r.episodeSeconds} 秒）。`,
            "要求：每集都必须有强钩子；节奏遵循爆款拆解的钩子规律；第 6-12 集之间设置第一个付费卡点，其后每 5-8 集一个大卡点（paywall=true 仅用于关键反转/大悬念集，不要滥用）。",
            "epNo 必须与实际集号一致。",
            "",
            "【卡点工艺——每集的钩子与卡点必须满足】",
            "- 主线与核心期待之间是必然联系：观众付费是为了等到「核心期待兑现」，每一集的推进都要让这件事更近一步或更悬一步，禁止无关支线灌水。",
            "- 卡点必须由主角或反派的「主动选择」构成（她决定……/他出手……），不能用巧合、误会、天降信息来制造悬念。",
            "- 强弱格局要清晰：每一段冲突里谁在压谁、压制靠什么（钱/权/证据/舆论），压制方的筹码要具体可视。",
            "- 第一次强兑现（打脸/亮身份/真相揭开一角）必须在第一个付费卡点之前给到观众一次，让观众先尝到甜头再付费。",
            "- 关系层级要有跃迁：每 3-5 集，主角与关键人物的关系必须发生一次不可逆的层级变化（敌→同盟、假婚→动心、下属→反杀者）。",
            "- 最惨的时候给一线希望：大低谷集（主角输到底）的结尾必须同时给一个具体的翻盘点（一个物证、一个人的倒戈、一条新信息），不能纯虐。",
            "- 反转的铺垫要「可回看」：大反转之前至少埋两处观众当时不会注意、回看才懂的细节。",
            a?.coreExpectation ? `\n===== 核心期待（全剧主线服务于此） =====\n${a.coreExpectation}` : "",
            "",
            "===== 总纲 =====",
            JSON.stringify(b, null, 2),
            a ? `\n===== 爆款节奏参考 =====\n钩子节奏：${a.hookRhythm}\n付费卡点规律：${a.paywallPattern}\n钩型清单：${a.hookTypes.join("、")}` : "",
            previousEps.length
              ? `\n===== 前几集衔接 =====\n${previousEps.map((e) => `第${e.epNo}集《${e.title}》：${e.summary}（结尾钩子：${e.hook}）`).join("\n")}`
              : "",
          ].join("\n"),
        });
        for (const ep of object.episodes) {
          const [row] = await db
            .select()
            .from(outlines)
            .where(and(eq(outlines.projectId, input.projectId), eq(outlines.epNo, ep.epNo)));
          if (row) {
            await db
              .update(outlines)
              .set({ data: ep })
              .where(and(eq(outlines.projectId, input.projectId), eq(outlines.epNo, ep.epNo)));
          } else {
            await db.insert(outlines).values({ projectId: input.projectId, epNo: ep.epNo, data: ep });
          }
        }
        return object.episodes as OutlineEpisode[];
      } catch (err) {
        throw classifyAiError(err);
      }
    }),

  /** 生成单集中文剧本 */
  generateScript: authedQuery
    .input(z.object({ projectId: z.number(), epNo: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const { remap, bible, transplant } = await loadContext(input.projectId);
      if (!bible || !remap) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先生成总纲" });
      }
      const db = getDb();
      const [outlineRow] = await db
        .select()
        .from(outlines)
        .where(and(eq(outlines.projectId, input.projectId), eq(outlines.epNo, input.epNo)));
      if (!outlineRow) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `第 ${input.epNo} 集还没有大纲` });
      }
      const [prevRow] = await db
        .select()
        .from(scripts)
        .where(and(eq(scripts.projectId, input.projectId), eq(scripts.epNo, input.epNo - 1)));
      const b = bible.content as BibleResult;
      const r = remap.settings as RemapSettings;
      const outline = outlineRow.data as OutlineEpisode;
      const prev = prevRow?.contentZh as EpisodeScript | null;
      const epTransplants = ((transplant?.mappings ?? []) as TransplantMapping[]).filter(
        (m) => m.targetEp === input.epNo,
      );
      try {
        const { object } = await generateObject({
          model: await getModel(),
          schema: scriptSchema,
          prompt: [
            "你是资深海外竖屏短剧编剧，擅长高密度情绪输出与强钩子结构。",
            `请为第 ${input.epNo} 集写完整中文剧本。单集时长约 ${r.episodeSeconds} 秒（竖屏短剧，台词短促、动作可视化、情绪浓度高）。`,
            "剧本结构：2-4 个场景，每场含场景头（location/time）与节拍序列。节拍 type=dialogue 时必须填 character；type=action 是动作/镜头描述。",
            "开场 3 秒必须出钩子；结尾必须留强悬念（cliffhanger 字段）。台词要口语化、有攻击性/张力，避免书面腔。",
            "",
            "【成稿铁律——必须逐条遵守】",
            "1. 合规前置：不写违法手段被美化、不写未成年人暧昧；羞辱桥段止于人格羞辱，不出现具体性威胁。",
            "2. 忍要有写死的代价：主角的每一次隐忍都必须让观众看到具体代价（钱、名额、救命机会被夺走），不能只是「她攥紧了拳头」。",
            "3. 女主最后一击必须亲自完成：大反击由女主主动出手，不能靠男主/长辈/巧合替她完成。",
            "4. 反派坏而不蠢：反派的每一步打压都要符合其自身利益，禁止为了制造冲突让反派做明显自取灭亡的蠢事。",
            "5. 男主行动要有理由链：男主对女主的每一次帮助都要有可追溯的动机（利益、旧账、被利用→动心），禁止无理由宠溺。",
            "6. 可视化物证/进度条：关键信息用可视物呈现（验资短信、监控画面、验伤单、倒计时屏幕），少用口述解释。",
            "7. 狠话改当下动作：把「我会让你们后悔」这类狠话改写成当场发生的动作（当场泼酒、当场打电话撤资）。",
            "8. 内心独白（OS）每集至多 2 句，且必须承载信息而非情绪复读。",
            "9. 借力打力：主角的反击优先借用反派自己的势（合同漏洞、反派放的话、在场众人的手机镜头），而非凭空开大。",
            epTransplants.length
              ? `\n===== 本集安排了 ${epTransplants.length} 个爆款桥段移植（已验证投流效果，必须落地） =====\n${epTransplants
                  .map(
                    (m, i) =>
                      `【移植${i + 1}】来源桥段：「${m.sourceQuote}」（原剧位置：${m.sourcePosition}，类型：${m.bridgeType}）\n落地要求：${m.spec}\n——按本剧人物与世界观改写，保留原桥段的情绪结构与节奏，不得照抄原台词。`,
                  )
                  .join("\n")}\n请在 transplantScenes 字段中列出这些移植桥段落在哪些场景号（如 [1,3]）。`
              : "",
            "",
            "===== 总纲 =====",
            JSON.stringify(b, null, 2),
            "",
            `===== 本集大纲 =====\n第${outline.epNo}集《${outline.title}》\n梗概：${outline.summary}\n钩子：${outline.hook}\n付费卡点：${outline.paywall ? "是" : "否"}`,
            prev ? `\n===== 上一集结尾悬念（需衔接） =====\n${prev.cliffhanger}` : "",
          ].join("\n"),
        });
        const [existing] = await db
          .select()
          .from(scripts)
          .where(and(eq(scripts.projectId, input.projectId), eq(scripts.epNo, input.epNo)));
        if (existing) {
          await db
            .update(scripts)
            .set({ contentZh: object, contentEn: null })
            .where(and(eq(scripts.projectId, input.projectId), eq(scripts.epNo, input.epNo)));
        } else {
          await db.insert(scripts).values({
            projectId: input.projectId,
            epNo: input.epNo,
            contentZh: object,
            contentEn: null,
          });
        }
        return object as EpisodeScript;
      } catch (err) {
        throw classifyAiError(err);
      }
    }),

  /** 把单集剧本翻译成英文版 */
  translateScript: authedQuery
    .input(z.object({ projectId: z.number(), epNo: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const db = getDb();
      const [row] = await db
        .select()
        .from(scripts)
        .where(and(eq(scripts.projectId, input.projectId), eq(scripts.epNo, input.epNo)));
      if (!row?.contentZh) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先生成中文剧本" });
      }
      try {
        const { object } = await generateObject({
          model: await getModel(),
          schema: scriptSchema,
          prompt: [
            "You are a professional vertical short-drama script translator for overseas markets (ReelShort / DramaBox style).",
            "Translate the following Chinese episode script into natural, punchy American English suitable for vertical short drama production.",
            "Rules: keep the exact same JSON structure (epNo, scene numbers, beat order, types); character names should be natural English names (transliterate or localize consistently); dialogue must be colloquial and emotionally intense, not literary; location/time fields in English.",
            "",
            "Localization checklist （本地化四查） — verify while translating:",
            "1. 称谓对齐: kinship/honorific terms (姐/总/夫人/少爷) become natural Western address or titles (ma'am, Mr., boss, or first names) — never leave pinyin honorifics.",
            "2. 羞辱按力度对齐: insults and face-slapping lines must keep the SAME intensity level in English — upgrade or downgrade the wording, not the emotion; avoid literal translations that read flat in English.",
            "3. 制度支撑剧情: plot devices tied to Chinese systems (户口本/高考/体制内/家族祠堂) must be swapped for Western equivalents (birth records, SAT/college admission, corporate board, family estate/trust) so the stakes still make sense to US viewers.",
            "4. 金句英文落点: meme-able punchlines must land as short, quotable English lines (the kind a viewer would screenshot) — rewrite for punch, never word-for-word.",
            "",
            JSON.stringify(row.contentZh, null, 2),
          ].join("\n"),
        });
        await db
          .update(scripts)
          .set({ contentEn: object })
          .where(and(eq(scripts.projectId, input.projectId), eq(scripts.epNo, input.epNo)));
        return object as EpisodeScript;
      } catch (err) {
        throw classifyAiError(err);
      }
    }),

  /** 生成桥段移植方案：把红标爆款素材段按比例映射到新剧集 */
  generateTransplants: authedQuery
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const { sample, analysis, remap, bible } = await loadContext(input.projectId);
      if (!sample || !analysis || !remap || !bible) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先完成样本录入、AI 拆解、换皮设定与总纲" });
      }
      const segs = (sample.redSegments ?? []) as RedSegment[];
      if (segs.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "样本中没有红标段，请先在样本里标注投流素材段" });
      }
      const r = remap.settings as RemapSettings;
      const a = analysis.result as AnalysisResult;
      const b = bible.content as BibleResult;
      const content = sample.content;
      const segTexts = segs.map((s, i) => {
        const ratio = content.length > 0 ? s.start / content.length : 0;
        const pos = ratio < 0.2 ? "开头" : ratio < 0.4 ? "前段" : ratio < 0.6 ? "中段" : ratio < 0.8 ? "后段" : "结尾";
        return { id: s.id ?? `seg-${i}`, text: content.slice(s.start, s.end).slice(0, 600), pos };
      });
      try {
        const { object } = await generateObject({
          model: await getModel(),
          schema: transplantBatchSchema,
          prompt: [
            "你是资深短剧策划，负责「爆款桥段移植」：把已验证投流效果好的素材段落，移植进一部全新短剧的分集结构中。",
            `新剧共 ${r.totalEpisodes} 集。请按下述规则为每个红标段落安排一个目标集（targetEp，1-${r.totalEpisodes}）：`,
            "- 比例换算：原剧位置（开头/前段/中段/后段/结尾）按比例映射到新剧——开头→前 10% 集数、前段→10%-35%、中段→35%-65%、后段→65%-90%、结尾→最后 10%。",
            "- 关键情绪兑现类桥段尽量安排在付费卡点集或其前一集，让投流素材能直接服务转化。",
            "- 同一目标集最多安排 2 个移植桥段；多个桥段落同集时区分先后场次。",
            "- spec 必须写成可执行的拍摄级要求：开钩子方式 + 2-3 个反应镜头 + 1 个特写物件 + 1 句可直接上大字幕的金句，并说明如何与新剧人物/世界观缝合。",
            "- sourceQuote 摘录原段落最有代表性的一两句（30 字内），redSegmentId 原样回传。",
            "- bridgeType 用短语标注桥段类型（如：当众打脸/亮身份/反转救场/高代价表白/误会加深）。",
            "",
            "===== 新剧总纲 =====",
            JSON.stringify({ title: b.titleZh, logline: b.loglineZh }, null, 2),
            a.coreExpectation ? `核心期待：${a.coreExpectation}` : "",
            "",
            "===== 红标爆款素材段（投流数据验证有效） =====",
            segTexts
              .map((s) => `【${s.id}】（原剧${s.pos}）\n${s.text}`)
              .join("\n\n"),
          ].join("\n"),
        });
        const db = getDb();
        const mappings = object.mappings as TransplantMapping[];
        const [existing] = await db.select().from(transplants).where(eq(transplants.projectId, input.projectId));
        if (existing) {
          await db.update(transplants).set({ mappings }).where(eq(transplants.projectId, input.projectId));
        } else {
          await db.insert(transplants).values({ projectId: input.projectId, mappings });
        }
        return mappings;
      } catch (err) {
        throw classifyAiError(err);
      }
    }),

  /** 判档质检：分集大纲（策划阶段，建议性报告） */
  evaluateOutlines: authedQuery
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const db = getDb();
      const { analysis, bible } = await loadContext(input.projectId);
      const outlineRows = await db
        .select()
        .from(outlines)
        .where(eq(outlines.projectId, input.projectId))
        .orderBy(asc(outlines.epNo));
      if (outlineRows.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "还没有分集大纲可质检" });
      }
      const a = analysis ? (analysis.result as AnalysisResult) : null;
      const b = bible ? (bible.content as BibleResult) : null;
      const eps = outlineRows.map((r) => r.data as OutlineEpisode);
      try {
        const { object } = await generateObject({
          model: await getModel(),
          schema: evalReportSchema,
          prompt: [
            EVALUATOR_CORE,
            "",
            OUTLINE_STAGE_RULES,
            "",
            EVAL_OUTPUT_FORMAT,
            "",
            "===== 总纲 =====",
            b ? JSON.stringify({ title: b.titleZh, logline: b.loglineZh, characters: b.characters }, null, 2) : "（无）",
            a?.coreExpectation ? `\n原爆款核心期待参考：${a.coreExpectation}` : "",
            "",
            "===== 分集大纲（全量） =====",
            eps
              .map(
                (e) =>
                  `第${e.epNo}集《${e.title}》${e.paywall ? "【付费卡点】" : ""}\n梗概：${e.summary}\n钩子：${e.hook}`,
              )
              .join("\n\n"),
          ].join("\n"),
        });
        const report: EvalReport = { ...object, scope: "outline" } as EvalReport;
        const [existing] = await db
          .select()
          .from(evaluations)
          .where(and(eq(evaluations.projectId, input.projectId), eq(evaluations.scope, "outline"), eq(evaluations.epNo, 0)));
        if (existing) {
          await db
            .update(evaluations)
            .set({ report })
            .where(and(eq(evaluations.projectId, input.projectId), eq(evaluations.scope, "outline"), eq(evaluations.epNo, 0)));
        } else {
          await db.insert(evaluations).values({ projectId: input.projectId, scope: "outline", epNo: 0, report });
        }
        return report;
      } catch (err) {
        throw classifyAiError(err);
      }
    }),

  /** 判档质检：单集成稿剧本（建议性报告） */
  evaluateScript: authedQuery
    .input(z.object({ projectId: z.number(), epNo: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureProject(ctx.user.id, input.projectId);
      const db = getDb();
      const { analysis, bible } = await loadContext(input.projectId);
      const [scriptRow] = await db
        .select()
        .from(scripts)
        .where(and(eq(scripts.projectId, input.projectId), eq(scripts.epNo, input.epNo)));
      if (!scriptRow?.contentZh) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `第 ${input.epNo} 集还没有中文剧本` });
      }
      const [outlineRow] = await db
        .select()
        .from(outlines)
        .where(and(eq(outlines.projectId, input.projectId), eq(outlines.epNo, input.epNo)));
      const a = analysis ? (analysis.result as AnalysisResult) : null;
      const b = bible ? (bible.content as BibleResult) : null;
      const outline = outlineRow?.data as OutlineEpisode | undefined;
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
            "===== 总纲（节选） =====",
            b ? JSON.stringify({ title: b.titleZh, logline: b.loglineZh }, null, 2) : "（无）",
            a?.coreExpectation ? `\n核心期待参考：${a.coreExpectation}` : "",
            outline
              ? `\n===== 本集大纲 =====\n第${outline.epNo}集《${outline.title}》${outline.paywall ? "【付费卡点】" : ""}\n梗概：${outline.summary}\n钩子：${outline.hook}`
              : "",
            "",
            `===== 第 ${input.epNo} 集成稿剧本 =====`,
            JSON.stringify(scriptRow.contentZh, null, 2),
          ].join("\n"),
        });
        const report: EvalReport = { ...object, scope: "script", epNo: input.epNo } as EvalReport;
        const [existing] = await db
          .select()
          .from(evaluations)
          .where(
            and(
              eq(evaluations.projectId, input.projectId),
              eq(evaluations.scope, "script"),
              eq(evaluations.epNo, input.epNo),
            ),
          );
        if (existing) {
          await db
            .update(evaluations)
            .set({ report })
            .where(
              and(
                eq(evaluations.projectId, input.projectId),
                eq(evaluations.scope, "script"),
                eq(evaluations.epNo, input.epNo),
              ),
            );
        } else {
          await db
            .insert(evaluations)
            .values({ projectId: input.projectId, scope: "script", epNo: input.epNo, report });
        }
        return report;
      } catch (err) {
        throw classifyAiError(err);
      }
    }),
});
