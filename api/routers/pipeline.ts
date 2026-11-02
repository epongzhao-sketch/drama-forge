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
} from "@db/schema";
import { getModel } from "../ai/provider";
import { classifyAiError } from "../ai/client";
import type {
  RedSegment,
  AnalysisResult,
  RemapSettings,
  BibleResult,
  OutlineEpisode,
  EpisodeScript,
} from "@contracts/pipeline";

// ---------- zod schemas（与 contracts/pipeline.ts 对齐） ----------

const redSegmentSchema = z.object({
  id: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  note: z.string().optional(),
});

const analysisSchema = z.object({
  genre: z.string().describe("题材定位，如：狼人禁忌之恋 / 亿万富翁契约婚姻"),
  tropeSummary: z.string().describe("核心套路一句话总结"),
  protagonist: z.string().describe("主角人设拆解"),
  antagonist: z.string().describe("反派/阻力设定"),
  coreConflict: z.string().describe("核心冲突"),
  hookRhythm: z.string().describe("钩子节奏规律（每多少秒/多少场一个钩子，如何升级）"),
  hookTypes: z.array(z.string()).describe("出现的钩子类型清单"),
  paywallPattern: z.string().describe("付费卡点设置规律"),
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
  return { sample, analysis, remap, bible };
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
      const { remap, bible } = await loadContext(input.projectId);
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
});
