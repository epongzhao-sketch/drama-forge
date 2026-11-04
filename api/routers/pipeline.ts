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
  genre: z.string().describe("题材/赛道——这只是元素外皮，如 黑手党 / 狼人 / 吸血鬼 / 霸总 / 王室 / 体育"),
  keptExpectation: z
    .string()
    .describe("锁定不变的核心期待：必须与拆解报告的核心期待同义等价，只允许用新题材的语境重新表述，禁止改方向"),
  protagonist: z.string(),
  setting: z.string(),
  twist: z
    .string()
    .describe("这层新元素外皮为什么让同一个核心期待更炸——是外皮差异化卖点，不是新核心期待"),
  swappedElements: z
    .array(z.string())
    .describe("本方案换掉的元素外皮清单，格式「原元素 → 新元素」，如「都市豪门 → 黑手党家族」"),
  keepElements: z.array(z.string()).describe("原样沿用的爆款元素/桥段"),
});


const scriptSceneSchema = z.object({
  sceneNo: z.number().int(),
  location: z.string().describe("英文地点，如 INT. MANSION"),
  locationZh: z.string().describe("中文地点，如 豪宅内"),
  time: z.string().describe("英文时间，如 NIGHT"),
  timeZh: z.string().describe("中文时间，如 夜"),
  beats: z.array(
    z.object({
      type: z.enum(["action", "dialogue"]),
      character: z.string().optional(),
      en: z.string().describe("拍摄稿：地道美式英文台词/动作"),
      zh: z.string().describe("审阅稿：对应的中文翻译"),
    }),
  ),
});

const episodeScriptSchema = z.object({
  epNo: z.number().int(),
  title: z.string().describe("英文标题"),
  titleZh: z.string().describe("中文标题"),
  scenes: z.array(scriptSceneSchema),
  cliffhanger: z.string().describe("本集结尾悬念（英文，下集钩子）"),
  cliffhangerZh: z.string().describe("结尾悬念中文"),
});

const promoClipSchema = z.object({
  id: z.string(),
  epNo: z.number().int().describe("该素材实际落在全剧的第几集（如 9、21），与连贯集的 1~5 不连续"),
  positionHint: z.string().describe("落点说明，如 '付费卡点前一集' / '大结局前的高潮'"),
  premise: z.string().describe("情境前提，让没看过前情的观众秒懂这段戏"),
  episode: episodeScriptSchema.describe("完整的一集剧本（多场景 + 结尾悬念，中英双语）"),
  hookLine: z.string().describe("可直接上大字幕的金句（英文）"),
  hookLineZh: z.string().describe("金句中文"),
});

const conceptPackSchema = z.object({
  logline: z.string().describe("本方案一句话卖点"),
  episodes: z.array(episodeScriptSchema).min(3).max(5).describe("3~5 集连贯剧本，本身即可投流"),
  promoClips: z.array(promoClipSchema).length(2).describe("2 集不连贯的投流素材（完整单集剧本）"),
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

/**
 * 欧美海外短剧市场本地化纪律 —— 注入所有生成/评估 prompt，全程禁止中式元素。
 * 这是硬约束：产出必须让北美/欧美观众看得懂、代入得了，不能出现中国特有的制度、
 * 称谓、生活场景或文化梗。
 */
const LOCALIZATION_RULES = [
  "【目标市场：欧美海外短剧（ReelShort / DramaBox / ShortMax 类），北美与欧美观众】",
  "所有生成内容必须彻底本地化到欧美语境，严禁中式元素：",
  "- 人物用英文名（Alex / Victoria / Damien…），不用中文名或拼音；",
  "- 称谓用 ma'am / sir / Mr. / boss / 直呼其名，禁止「少爷/夫人/总/姐/哥」这类中式称呼；",
  "- 制度与场景换成西方对应物：户口本→出生记录/信托文件，高考→SAT/大学录取，家族祠堂→家族庄园/董事会，单位/体制内→公司/集团，彩礼/嫁妆→婚前协议/信托；",
  "- 不出现中式生活细节：四合院/摆酒/红包/中医/算命/风水/宗法制家庭伦理；",
  "- 冲突与筹码用欧美观众熟悉的：股权、信托、遗嘱、董事会投票、媒体头条、法庭诉讼、竞选、医疗执照、体育联赛；",
  "- 价值观对齐欧美爽点：个人逆袭、自我证明、反抗不公，而非「光宗耀祖/给家族交代」。",
].join("\n");

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
            LOCALIZATION_RULES,
            "（拆解时若样本里出现中式元素，要在 transferableElements / marketFit 里指出它对应的欧美可迁移形式，而不是原样保留。）",
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
            "你是资深海外竖屏短剧策划。基于一份爆款短剧的拆解报告，产出 **10 个「换皮」复刻方案**。",
            "",
            "【最高纪律：换皮 = 只换元素外皮，核心期待锁死不动】",
            "- 核心期待（keptExpectation）= 观众追下去、愿意付费的那个情绪承诺与关系结构，例如「先婚后爱」「隐藏身份复仇打脸」「契约关系变真爱」。它是本剧的地基，10 个方案必须与拆解报告的核心期待**同义等价**——一个字的方向都不能改。",
            "- 元素外皮 = 题材赛道与人设包装：黑手党、狼人、吸血鬼、霸总、王室、体育明星、校园、年代、牛仔、海盗……以及职业、场景、时代、道具、视觉噱头。**只有这些允许换**。「黑手党/狼人/霸总」这类是元素；「先婚后爱/复仇/逆袭」这类核心期待不是元素，永远不换。",
            "- 举例：原剧核心期待是「先婚后爱 + 隐藏身份复仇」，那么狼人版就是「狼人 Alpha 的契约婚姻 → 先婚后爱，女主隐藏真实身份复仇」——期待原样保留，只是承载它的皮换成了狼人族群。",
            "",
            "【10 个方案的差异从何而来】",
            "10 个方案之间拼的是「元素外皮赛道」的差异（黑手党 vs 狼人 vs 霸总 vs 王室 vs 体育 vs 吸血鬼 vs 年代庄园……），绝不是核心期待的差异。每个方案的 keptExpectation 复述同一份核心期待（允许用新题材语境表述），genre/setting/protagonist/swappedElements 体现外皮差异。",
            "",
            "【每个方案必须写清】",
            "- keptExpectation：锁定的核心期待（与拆解报告同义等价）。",
            "- twist：这层新外皮为什么让**同一个期待**更炸（如「黑手党语境让'隐藏身份亮底牌'的打脸更致命」），不许写成新的期待。",
            "- swappedElements：换了哪些元素外皮（原元素 → 新元素）。",
            "- keepElements：原样沿用的爆款元素/桥段。",
            "",
            LOCALIZATION_RULES,
            "（10 个方案的主角名、背景、冲突筹码都必须落在欧美语境，禁止任何中式设定。）",
            "",
            "===== 爆款拆解报告 =====",
            `剧型赛道：${a.dramaType}`,
            `核心期待（所有方案必须锁定它，禁止改写方向）：${a.coreExpectation}`,
            `拆解出的元素清单（这些才是可换的皮）：${a.elements.join("、")}`,
            `可迁移爆款元素：${a.transferableElements.join("、")}`,
            `红标段爆款原因：${a.redSegmentTraits.map((r) => r.trait).join("；")}`,
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
            "2. promoClips：**恰好 2 集不连贯的投流素材**。它们各自是一集**完整的剧本**（2-4 个场景 + 结尾悬念），但集号不与前面连贯集衔接——因为投流素材常取自全剧最炸的段落，不一定在开头。每集要标出它实际落在全剧第几集（epNo，比如 9、21，需大于连贯集的最大集号且不超过总集数），并给一句 premise 让没看过前情的观众秒懂这段戏。",
            "3. 单集 2-4 个场景；台词短促、动作可视化、情绪浓度高；女主最后一击必须亲自完成；反派坏而不蠢；关键信息用可视物证呈现；狠话改当下动作。",
            "4. 不得抄袭原作具体情节与台词，只保留情绪结构与节奏骨架。",
            "5. 【核心期待锁死】全剧主线必须兑现方案里锁定的核心期待（keptExpectation）——只换元素外皮，关系结构与情绪承诺（如先婚后爱/复仇打脸/身份错位）一个字的方向都不能改。若发现自己在写别的期待，立刻拉回。",
            "",
            "【语言：中英双语】剧本包全程双语输出——",
            "- 英文（en/title/location/time/cliffhanger/hookLine）= 拍摄稿，用地道美式英文（场景头 'INT. MANSION — NIGHT' 格式），可直接投给欧美演员；",
            "- 中文（zh/titleZh/locationZh/timeZh/cliffhangerZh/hookLineZh）= 审阅稿，是与英文逐条对应的准确中文翻译，方便编审校对；",
            "- logline、premise、positionHint 用中文（给你看的说明文字）。",
            "- 每条 beat 的 en 与 zh 必须一一对应、意思一致，不许漏译或自由发挥。",
            "",
            LOCALIZATION_RULES,
            "（剧本里的人名、地名、机构、冲突筹码、台词梗全部用欧美语境；英文部分严禁任何中式表达。）",
            "",
            "===== 换皮方案 =====",
            `题材外皮：${concept.genre}`,
            `锁定核心期待（全剧必须兑现，禁止改写）：${concept.keptExpectation}`,
            `主角：${concept.protagonist}`,
            `背景：${concept.setting}`,
            `外皮差异化卖点：${concept.twist}`,
            `更换的元素外皮：${(concept.swappedElements ?? []).join("、") || "（无）"}`,
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
      const pool = await loadRemapPool(input.projectId);
      const concept = pool?.concepts.find((c) => c.id === input.conceptId);
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
            LOCALIZATION_RULES,
            "（质检时若发现中式人名/称谓/制度/场景，计入阻挡项，要求改成欧美对应物。）",
            "",
            a?.coreExpectation ? `原爆款核心期待参考：${a.coreExpectation}` : "",
            concept?.keptExpectation ? `方案锁定的核心期待（剧本必须兑现它）：${concept.keptExpectation}` : "",
            "【换皮质检红线】若发现剧本把核心期待改写/漂移了（而不是只换元素外皮——黑手党/狼人/霸总这类题材包装可以换，先婚后爱/复仇打脸/身份错位这类期待结构不能换），计为阻挡项，明确指出漂移点并要求改回锁定期待。",
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
