import { z } from "zod";
import { TRPCError } from "@trpc/server";
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
import { getModel, generateObjectStreamed } from "../ai/provider";
import { DNA_ANALYSIS, DNA_CONCEPTS, DNA_FOUNDATION, DNA_SCRIPT, DNA_EVAL, DNA_DE_AI, CORPUS_STATS } from "../ai/dna";
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
  CharacterBio,
  DirectionCard,
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
  hook4: z
    .object({
      visual3s: z.string().describe("前 3 秒视觉钩：反常画面（血/跪下/床/钱/怪物真身）不给解释——写出样本第 1 集实际用的那个画面"),
      info30s: z.string().describe("前 30 秒信息钩：身份反差+利害关系+隐藏威胁三连，逐个列出"),
      golden60s: z.string().describe("前 60 秒金钩：亮出的全剧底牌（重生闪回/隐藏身份/命中注定）"),
      epEndPain: z.string().describe("第 1 集集尾痛点钩：锁定全剧核心冲突的那句内白/动作"),
    })
    .describe("第 1 集四层钩拆解，缺一不可"),
  openingSkeleton: z.string().describe("开局骨架判定：冷开场闪回式 还是 VO 自我介绍式，以及为什么适配该赛道"),
  paywallPattern: z.string().describe("付费卡点设置规律（卡点兑现的是什么、卡在第几集、由谁的主动选择构成）"),
  paywallTable: z
    .array(z.object({ ep: z.string().describe("集数位置，如 EP5"), event: z.string().describe("卡点事件"), intensity: z.number().min(1).max(10).describe("情绪强度打分 1-10") }))
    .describe("付费墙位置表：每个卡点一行；付费墙必须 ≥9/10 大情绪点"),
  beatDensity: z.string().describe("卡点密度曲线：低开高走、每 5 集一个台阶，描述样本实际分布"),
  arcs: z
    .array(
      z.object({
        character: z.string(),
        start: z.string().describe("起点状态+情绪关键词"),
        turn: z.string().describe("转折点+情绪关键词"),
        climax: z.string().describe("高潮点+情绪关键词"),
        end: z.string().describe("终点状态+情绪关键词"),
      }),
    )
    .describe("主要人物四态弧线（含反派：入局→起势→暴露→崩塌），人物不用性格定义、用四个状态定义"),
  emotionCurve5: z.string().describe("全剧情绪 5 段式落位：隐忍→蒙冤→觉醒→翻盘→收束，各段在样本中的集数区间"),
  redSegmentTraits: z
    .array(z.object({ quote: z.string(), trait: z.string() }))
    .describe("每个红标段的原文摘录(短)与它之所以能爆的原因（情绪卖点/核心期待）"),
  transferableElements: z.array(z.string()).describe("可迁移到新作的爆款元素"),
  motifs: z.array(z.string()).describe("母题库复合拆解：本剧 = 哪 2-4 个成熟母题的叠加（如 重生复仇+调包+隐藏身份）"),
  objectHooks: z.array(z.string()).describe("贯穿物件钩：样本里承担伏笔—羞辱—反转认亲链条的物件（泰迪熊/婚戒/金剑吊坠类），没有就说没有"),
  reskinGate: z
    .object({
      skeleton: z.string().describe("换皮第一关·骨架成立：核心设定的硬支撑是什么（如 主角开局主动放弃巨大既得利益）"),
      adaptMotifs: z.string().describe("换皮第二关·融梗方法：哪些物件钩可挪用、哪些人物关系可替换变体"),
      cultureFit: z.string().describe("换皮第三关·文化适配：样本的文化符号如何平移到目标市场中产认知锚点"),
    })
    .describe("换皮三关自检"),
  marketFit: z.string().describe("目标市场适配要点"),
  beatMap: z
    .array(
      z.object({
        epNo: z.number().int().describe("样本集号"),
        paywall: z.boolean().optional().describe("该集是否付费卡点集"),
        beats: z
          .array(
            z.object({
              position: z.string().describe("节拍位置：开场 / 前段 / 中段 / 后段 / 集尾"),
              type: z.string().describe("节拍功能：视觉钩 / 信息钩 / 受辱 / 隐忍 / 反转 / 打脸 / 身份危机 / 新威胁登场 等"),
              summary: z.string().describe("该节拍发生了什么——功能级概括，禁止抄录原文台词"),
              intensity: z.number().min(1).max(10).describe("情绪强度 1-10"),
            }),
          )
          .min(3)
          .max(8)
          .describe("本集节拍序列，按时间顺序 3-8 拍"),
        cliffhangerType: z.string().describe("集尾悬念类型：台词中断型 / 表情定格型 / 新威胁登场型"),
      }),
    )
    .min(1)
    .describe("逐集节拍镜像表：样本中可识别出的每一集都拆成节拍序列——这是后续节拍级复刻的骨架依据"),
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


const scriptBeatSchema = z.object({
  type: z
    .enum(["action", "dialogue", "caption", "note"])
    .describe("action=▲动作行；dialogue=台词；caption=【字幕】；note=【闪切/特效:黑场】等"),
  character: z.string().optional().describe("dialogue 专用：角色中文名"),
  mood: z.string().optional().describe("dialogue 专用：情绪/状态提示（2-6 字表演指令），如 压低声音，郑重"),
  isVo: z.boolean().optional().describe("dialogue 专用：是否 VO 内心独白（女频占比 10-30%，开场定人设/转场补信息/集尾点题）"),
  en: z.string().optional().describe("dialogue/caption 专用：地道美式英文原文（台词平均 5.5 词/句）"),
  zh: z.string().describe("action=动作行中文；dialogue=台词中文翻译；caption=字幕中文；note=说明文字"),
});

const scriptSceneSchema = z.object({
  sceneNo: z.number().int(),
  timeOfDay: z.string().describe("日 / 夜 / 傍晚 / 晨"),
  intExt: z.string().describe("内 / 外 / 内外"),
  location: z.string().describe("中文地点（可含英文专名），如 米德尔堡猎狐与小马俱乐部·练习场"),
  cast: z.array(z.string()).describe("出场人物（中文名）"),
  beats: z.array(scriptBeatSchema),
});

const episodeScriptSchema = z.object({
  epNo: z.number().int(),
  title: z.string().describe("英文暂名"),
  titleZh: z.string().describe("中文暂名"),
  scenes: z.array(scriptSceneSchema),
  mirror: z
    .object({
      sourceEpNo: z.number().int().describe("本集镜像的原作集号"),
      mapping: z
        .array(
          z.object({
            sourceBeat: z.string().describe("原作该节拍的功能概括（引自逐集节拍镜像表）"),
            newBeat: z.string().describe("新剧在同一节拍位置的落法——同等功能、同等情绪强度，事件与表达全新"),
          }),
        )
        .min(3)
        .describe("逐节拍对照：与原作对应集的节拍序列一一对齐"),
    })
    .optional()
    .describe("节拍镜像对照：拆解报告提供了 beatMap 时必填"),
});

const directionCardSchema = z.object({
  expectation: z.string().describe("核心期待：与方案锁定期待同义等价，用新题材语境展开成一句「观众在等的事」"),
  elements: z.array(z.string()).describe("元素清单，如 王室贵族/马甲掉马/下位者伪装/萌宝/专业垂类/霸总"),
  enduranceCost: z
    .string()
    .describe("忍的代价（写死）：她为什么不能直接亮身份——具体的规则/法律/威胁机制，要硬、要能写死"),
  clock: z.string().optional().describe("时钟/倒计时（如 全剧倒计时60天，每集角落一个数字）；天然没有就不填"),
  mastermind: z.string().optional().describe("真正的幕后反派及其盘算（如有）"),
  breakingPoint: z.string().describe("「不得不破戒」的触发点：什么事件会迫使她亮出身份"),
  powerMap: z
    .string()
    .describe("强弱格局：女主真实地位vs表面地位、男主、渣夫、反派的相对强弱——男主护短但弱于女主，最后一击永远女主亲自完成"),
  motifs: z.array(z.string()).describe("本剧 = 哪 2-4 个成熟母题的复合叠加（如 重生复仇+调包+隐藏身份+契约婚姻）"),
  objectHooks: z
    .array(z.object({ name: z.string().describe("物件名（具体、可拍）"), chain: z.string().describe("它承担的伏笔—羞辱—反转认亲链条") }))
    .describe("2-3 个贯穿物件钩——台词会忘，物件不会"),
  colorCode: z.string().describe("赛道主色情绪编码：冷色=虐/现实、暖色=回忆/甜、金光=觉醒/身份揭示、血红=背叛开局——给出本剧的一套"),
});

const characterBioSchema = z.object({
  name: z.string().describe("英文名"),
  nameZh: z.string().describe("中文名（剧本台词标签用它）"),
  role: z.string().describe("定位：女主/男主/女主之子/渣夫/反派/幕后反派/盟友…"),
  age: z.string().optional(),
  realIdentity: z.string().optional().describe("真实身份"),
  coverIdentity: z.string().optional().describe("表面身份"),
  captionCard: z
    .string()
    .optional()
    .describe("首登场【字幕】身份卡：英文大名+中文对照，关系型角色标注关系（如 EVELYN CARTIER（埃芙琳·卡蒂尔）/ DANIEL (Matthew's sidekick)（丹尼尔·马修的跟班））"),
  backstory: z.string().optional().describe("前史"),
  personality: z.string().describe("性格"),
  desire: z.string().optional().describe("欲望"),
  weakness: z.string().optional().describe("弱点"),
  weapon: z.string().optional().describe("不暴露身份时的武器 / 筹码"),
  arc: z.string().optional().describe("弧光一句话（从…到…）"),
  arc4: z
    .object({
      start: z.string().describe("起点状态+情绪关键词"),
      turn: z.string().describe("转折点+情绪关键词"),
      climax: z.string().describe("高潮点+情绪关键词"),
      end: z.string().describe("终点状态+情绪关键词"),
    })
    .optional()
    .describe("四态弧线：人物用四个状态定义、不用性格定义；反派也必须有（入局→起势→暴露→崩塌）"),
  powerPosition: z.string().optional().describe("强弱定位"),
  villainCheck: z.string().optional().describe("反派三查：持续动机 / 不蠢（程序合法）/ 量级（背后的靠山）——仅反派填"),
});

/** 第一步：剧本包地基 = logline + 方向卡 + 人物小传 + 全剧集纲 */
const packFoundationSchema = z.object({
  logline: z.string().describe("本方案一句话卖点（中文）"),
  directionCard: directionCardSchema,
  characters: z.array(characterBioSchema).min(5).max(12),
  outline: z
    .object({
      expectation: z.string().describe("大期待：一句话锁死全剧（观众追到底在等的那件事）"),
      framework: z.string().describe("框架：分型骨架（如 女频虐恋=辜负→觉醒→离开→追妻火葬场→加冕）+ 情绪 5 段式的集数落位"),
      coreGimmick: z.string().describe("核心梗：本剧最独特、最好卖的那个装置"),
      beats: z
        .array(
          z.object({
            epNo: z.number().int(),
            hook: z.string().describe("本集钩子（开场直接承接上集悬念）"),
            plot: z.string().describe("剧情一句话"),
            cliffhanger: z.string().describe("集尾悬念：台词中断/表情定格/新威胁登场 三选一"),
            paywall: z.boolean().optional().describe("是否付费墙位置（EP5/12/24/38/45），付费墙集必须 ≥9/10 大情绪点"),
          }),
        )
        .min(10)
        .describe("逐集集纲：至少前 10 集逐集写全；之后可跳写关键节点（付费墙集、大反转集、大结局前 2 集必须写），付费墙按 EP5/12/24/38/45 布局"),
    })
    .describe("全剧集纲：大期待/框架/核心梗 + 逐集（钩子/剧情/集尾悬念）"),
});

const promoClipSchema = z.object({
  id: z.string(),
  promoName: z
    .string()
    .describe("投流素材名：字母编号+短语概括卖点，如「A 终极掉马·王储宣言」「B 当众离婚·反求婚」"),
  epNo: z.number().int().describe("该素材实际落在全剧的第几集（如 9、21），与连贯集的 1~5 不连续"),
  positionHint: z.string().describe("落点说明，如 '付费卡点前一集' / '大结局前的高潮'"),
  premise: z.string().describe("情境前提，让没看过前情的观众秒懂这段戏"),
  episode: episodeScriptSchema.describe("完整的一集剧本（多场景 + 结尾黑场悬念）"),
  hookLine: z.string().describe("可直接上大字幕的金句（英文）"),
  hookLineZh: z.string().describe("金句中文"),
});

/** 剧本产出第二步：单批连贯集（每批 ≤5 集，整卡分多批循环产出） */
const episodeChunkSchema = z.object({
  episodes: z.array(episodeScriptSchema).min(1).max(5),
});

/** 剧本产出第三步：投流素材（整卡产出完后单独一批） */
const promoChunkSchema = z.object({
  promoClips: z.array(promoClipSchema).length(2),
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

/** 一卡 = 首卡全量复刻：第 1~10 集逐集完整产出（超过单批上限的集数分批生成） */
const FIRST_CARD_EPISODES = 10;
const EPISODES_PER_CHUNK = 5;

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

/** 读取某方案的剧本包（分步产出时承载中间态：status=generating 的部分包） */
async function loadPack(projectId: number, conceptId: string): Promise<ConceptScriptPack | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(scriptPacks)
    .where(and(eq(scriptPacks.projectId, projectId), eq(scriptPacks.conceptId, conceptId)));
  return row ? (row.pack as ConceptScriptPack) : null;
}

async function savePack(projectId: number, pack: ConceptScriptPack) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(scriptPacks)
    .where(and(eq(scriptPacks.projectId, projectId), eq(scriptPacks.conceptId, pack.conceptId)));
  if (existing) {
    await db
      .update(scriptPacks)
      .set({ pack })
      .where(and(eq(scriptPacks.projectId, projectId), eq(scriptPacks.conceptId, pack.conceptId)));
  } else {
    await db.insert(scriptPacks).values({ projectId, conceptId: pack.conceptId, pack });
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
        redSegments: z.array(redSegmentSchema).max(1000),
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
        const { object } = await generateObjectStreamed({
          model: await getModel(),
          maxRetries: 3,
          schema: analysisSchema,
          prompt: [
            "你是资深海外竖屏短剧（ReelShort / DramaBox 类）爆款内容分析师。",
            `你的判断标准来自对 ${CORPUS_STATS.dramas} 部海外爆款短剧（${CORPUS_STATS.episodes} 集 / ${CORPUS_STATS.enDialogueLines} 行英文台词）的语料蒸馏（小黑DNA），请严格按下面的 DNA 尺子拆解：`,
            "",
            DNA_ANALYSIS,
            "",
            "下面是一部海外爆款短剧的剧本/剧情样本。其中用【RED】…【/RED】包裹的段落是投流数据特别好的素材段落（用户重点标注）。",
            "请对样本做结构化拆解，**重点分析这些红标段为什么能成为投流爆款**——每一段都要回答：它抓住的核心期待是什么、情绪卖点是什么（爽点/虐点/反转/代入感），以及它为什么能在前 3 秒抓住人。所有字段用中文输出。",
            "",
            "【最重要的分析纪律】核心期待 ≠ 元素：",
            "- 核心期待（coreExpectation）= 观众为什么愿意一直看下去、为什么愿意付费——它是一句「观众在等的一件事」，例如「等着看被赶出家门的女主以集团董事长身份回来打脸所有人」。",
            "- 元素（elements）= 服务于核心期待的桥段、身份、道具、设定 gimmick，例如「隐藏身份」「假死」「拍卖会亮身份」。元素可以换，核心期待不能丢。",
            "- dramaType 填写品类判断（如：女频-豪门复仇、男频-战神赘婿、女频-甜宠闪婚 等），一句话点明赛道。",
            "- redSegmentTraits 里每个红标段的 trait 必须聚焦「这段之所以能爆的原因」——具体说清楚它命中了哪种情绪、制造了什么期待。",
            "- paywallPattern 必须回答三件事：卡点兑现的是什么期待、卡在第几集、由谁的主动选择构成（不能是巧合/误会自然解开）。",
            "- hook4 按 DNA 四层钩逐层拆解样本第 1 集，每层都要引用样本里实际出现的画面/台词；openingSkeleton 判定开局骨架类型。",
            "- paywallTable 把样本里能识别出的卡点列成表并打情绪强度分；beatDensity 描述卡点密度曲线。",
            "- arcs 给每个主要人物（含反派）写四态弧线，每态绑一个情绪关键词；emotionCurve5 把情绪 5 段式映射到样本的集数区间。",
            "- motifs 拆解样本的母题复合构成；objectHooks 找出贯穿物件钩；reskinGate 做换皮三关自检（骨架/融梗/文化适配），这是后续换皮方案的依据。",
            "- beatMap 逐集节拍镜像表：把样本中能识别出的每一集拆成按时间顺序的节拍序列（每集 3-8 拍）。每个节拍只记三件事——位置（开场/前段/中段/后段/集尾）、功能（视觉钩/受辱/反转/打脸/身份危机…）、内容的功能级概括。summary 写「这一拍在节奏上起什么作用+发生了什么类型的事件」，**禁止抄录原文台词**；每拍打情绪强度分（1-10），付费卡点集标 paywall=true，集尾标注悬念类型。这张表是后续逐节拍镜像复刻的依据，拆得越准新剧节奏越像原作。",
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
        const { object } = await generateObjectStreamed({
          model: await getModel(),
          maxRetries: 3,
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
            "【小黑DNA 选题纪律（换皮方案必须过这三关）】",
            DNA_CONCEPTS,
            "",
            "每个方案在心里过一遍换皮三关：①骨架成立——新外皮下核心设定仍有硬支撑；②融梗——拆解报告里的物件钩/母题哪些能平移进新语境；③文化适配——新皮的文化符号贴合目标市场中产认知锚点（北美=集团+酒店+Cartier，拉美=家族农场+独立日+教堂婚礼，东南亚=家族企业+寺庙+金饰）。方案本身不用把三关写出来，但 twist 与 keepElements 必须体现你考虑过它们。",
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
            a.motifs?.length ? `母题复合构成：${a.motifs.join("、")}` : "",
            a.objectHooks?.length ? `贯穿物件钩：${a.objectHooks.join("、")}` : "",
            a.reskinGate
              ? `换皮三关（样本侧）：骨架=${a.reskinGate.skeleton}；融梗=${a.reskinGate.adaptMotifs}；文化适配=${a.reskinGate.cultureFit}`
              : "",
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

  /** 为一个入选方案分步生成完整剧本包（前端串行调用，每步一个独立请求，避免平台代理掐断超长请求）：foundation=方向卡+人物小传+集纲；episodes(batch)=本批 5 集；promo=2 段投流素材。一卡集数见 FIRST_CARD_EPISODES */
  generateScriptPackStep: authedQuery
    .input(
      z.object({
        projectId: z.number(),
        conceptId: z.string(),
        step: z.enum(["foundation", "episodes", "promo"]),
        batch: z.number().int().min(0).default(0),
      }),
    )
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
        .slice(0, 40) // 防极端多段撑爆 prompt（合并后正常剧本远少于此数）
        .map((s) => sample!.content.slice(s.start, s.end).slice(0, 500));

      const conceptBlock = [
        "===== 换皮方案 =====",
        `题材外皮：${concept.genre}`,
        `锁定核心期待（全剧必须兑现，禁止改写）：${concept.keptExpectation}`,
        `主角：${concept.protagonist}`,
        `背景：${concept.setting}`,
        `外皮差异化卖点：${concept.twist}`,
        `更换的元素外皮：${(concept.swappedElements ?? []).join("、") || "（无）"}`,
        `沿用爆款元素：${concept.keepElements.join("、") || "（无）"}`,
        `新剧总集数：${pool.totalEpisodes}，单集约 ${pool.episodeSeconds} 秒`,
      ].join("\n");
      const analysisBlock = a
        ? `===== 爆款核心期待（全剧主线服务于此） =====\n${a.coreExpectation}\n\n钩子节奏参考：${a.hookRhythm}\n付费卡点规律：${a.paywallPattern}`
        : "";
      const beatMapBlock = a?.beatMap?.length
        ? `===== 原作逐集节拍镜像表（新剧必须逐节拍对齐：拍数/顺序/功能/情绪强度一致，内容全部新写） =====\n${JSON.stringify(a.beatMap)}`
        : "";
      const redBlock = redTexts.length
        ? `===== 已验证的投流爆款素材段（供情绪结构参考，勿照抄） =====\n${redTexts.map((t, i) => `【素材${i + 1}】${t}`).join("\n\n")}`
        : "";

      const cardEpisodes = Math.min(FIRST_CARD_EPISODES, pool.totalEpisodes);

      try {
        // 第 1 步（独立请求）：方向卡 + 人物小传 + 全剧集纲；落库 status=generating，前端再逐批调 episodes/promo
        if (input.step === "foundation") {
          const foundation = await generateObjectStreamed({
          model: await getModel(),
          maxRetries: 3,
          schema: packFoundationSchema,
          prompt: [
            "你是资深海外竖屏短剧总策划。为一个换皮方案产出剧本的地基：**方向卡 + 人物小传 + 全剧集纲**。",
            "",
            "【小黑DNA 策划纪律】",
            DNA_FOUNDATION,
            "",
            "【方向卡要求】",
            "- expectation：核心期待必须与方案锁定期待同义等价——只换元素外皮，关系结构与情绪承诺一个字的方向都不能改。",
            "- enduranceCost（忍的代价）必须**写死**：一条具体的规则/法律/威胁机制，让观众明白「她为什么不能直接亮身份」。越硬越好（如继承法条款、信托条款、孩子的安全威胁）。",
            "- 若题材天然带倒计时（期限、仪式、赛季），给出 clock；没有就不填，不要硬造。",
            "- breakingPoint：后续「不得不破戒」的触发点——什么事件会逼得她宁可付代价也要亮身份。",
            "- powerMap：强弱格局必须遵守——女主真实最高、表面最低；男主中高位、护短、弱于女主（他护她，但每一次最后一击都是她自己完成）；渣夫靠她暗中扶持才有今天的地位却不知情；反派讲规矩、不亲自动手。",
            "- motifs：写出本剧的母题复合构成（2-4 个成熟母题叠加）。",
            "- objectHooks：设计 2-3 个贯穿物件钩，每个写清它如何走「伏笔—羞辱—反转认亲」全链条。",
            "- colorCode：给出本剧的色彩情绪编码（赛道主色）。",
            "",
            "【人物小传要求】5~12 人，至少含：女主、男主、女主之子（或情感软肋）、渣夫、反派、（如有）幕后反派。",
            "- 每个主要角色写清：真实身份/表面身份、前史、性格、欲望、弱点、武器/筹码、强弱定位。",
            "- captionCard：给每个主要角色设计首登场【字幕】身份卡（英文大名+中文对照，关系型角色标注关系）。",
            "- arc4：每个主要角色（含反派）写四态弧线——起点/转折/高潮/终点，各绑一个情绪关键词。反派弧线=入局→起势→暴露→崩塌，反派是观众情绪的靶向标靶。",
            "- 反派必须过「反派三查」：持续动机（她图什么）＋不蠢（每一步有表格、有投票、有程序）＋量级（背后站着谁）。",
            "- 小传要有短剧感：讽刺点、秘密、后续揭晓的反转都写进去（如「他接到的最新任务是查找女主下落」「反派之子其实是渣夫的亲生子」）。",
            "",
            "【全剧集纲要求】",
            "- expectation：大期待一句话锁死全剧。",
            "- framework：写出分型骨架落位（如 女频虐恋=辜负→觉醒→离开→追妻火葬场→加冕）+ 情绪 5 段式分别落在哪几集。",
            "- coreGimmick：本剧最独特最好卖的那个装置。",
            "- beats：前 10 集逐集写全（钩子/剧情/集尾悬念）；之后跳写关键节点——付费墙严格按 EP5/12/24/38/45 布局（如总集数不同则按 10%/25%/50%/75%/90% 位置换算取整），每个付费墙集标 paywall=true 且必须是 ≥9/10 大情绪点；大反转集、大结局前 2 集必须有；总条数控制在 16-24 条。",
            "- 若提供了原作逐集节拍镜像表：集纲的前若干集（节拍表覆盖的范围）逐集对齐原作的节拍节奏与情绪强度落点——同一集数承担同等功能与强度的节拍，但事件内容全新；超出覆盖范围的集数按同一节奏规律外推。",
            "- 集尾悬念按 DNA 三类收法：台词中断型 / 表情定格型 / 新威胁登场型。",
            "",
            LOCALIZATION_RULES,
            "（人名、地名、机构、冲突筹码全部欧美语境；小传正文用中文撰写。）",
            "",
            conceptBlock,
            "",
            analysisBlock,
            beatMapBlock ? `\n${beatMapBlock}` : "",
            redBlock ? `\n${redBlock}` : "",
          ].join("\n"),
        });
          const f = foundation.object;
          const foundationPack: ConceptScriptPack = {
            conceptId: input.conceptId,
            logline: f.logline,
            directionCard: f.directionCard as DirectionCard,
            characters: f.characters as CharacterBio[],
            outline: f.outline as ConceptScriptPack["outline"],
            episodes: [],
            promoClips: [],
            status: "generating",
          };
          await savePack(input.projectId, foundationPack);
          return foundationPack;
        }

        // 第 2/3 步：加载第 1 步落库的地基，按批次执行（前端串行调用，每步一个独立请求）
        const partial = await loadPack(input.projectId, input.conceptId);
        if (!partial?.directionCard || !partial.outline || !partial.characters?.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "请先完成第 1 步（方向卡 + 人物小传 + 集纲地基）" });
        }
        const foundationCard = {
          logline: partial.logline,
          directionCard: partial.directionCard,
          characters: partial.characters,
          outline: partial.outline,
        };
        const beatsFor = (from: number, to: number) =>
          foundationCard.outline.beats.filter((b) => b.epNo >= from && b.epNo <= to);
        const beatMapFor = (from: number, to: number) =>
          a?.beatMap?.length
            ? `===== 原作逐集节拍镜像表·本批范围（新剧必须逐节拍对齐：拍数/顺序/功能/情绪强度一致，内容全部新写） =====\n${JSON.stringify(a.beatMap.filter((b) => b.epNo >= from && b.epNo <= to))}`
            : "";
        const epDigest = (eps: EpisodeScript[]) =>
          eps
            .map((e) => {
              const first = e.scenes[0]?.beats[0]?.zh ?? "";
              const last = e.scenes.at(-1)?.beats.at(-1)?.zh ?? "";
              return `EP${e.epNo}《${e.titleZh}》开场：${first.slice(0, 60)}｜集尾：${last.slice(0, 60)}`;
            })
            .join("\n");
        const directionBlock = [
          "===== 方向卡 =====",
          `核心期待：${foundationCard.directionCard.expectation}`,
          `元素：${foundationCard.directionCard.elements.join("、")}`,
          `忍的代价（写死）：${foundationCard.directionCard.enduranceCost}`,
          foundationCard.directionCard.clock ? `时钟：${foundationCard.directionCard.clock}` : "",
          foundationCard.directionCard.mastermind ? `幕后反派：${foundationCard.directionCard.mastermind}` : "",
          `不得不破戒的触发点：${foundationCard.directionCard.breakingPoint}`,
          `强弱格局：${foundationCard.directionCard.powerMap}`,
          `母题复合：${(foundationCard.directionCard.motifs ?? []).join("、")}`,
          `物件钩：${(foundationCard.directionCard.objectHooks ?? []).map((o) => `${o.name}（${o.chain}）`).join("；")}`,
          `色彩编码：${foundationCard.directionCard.colorCode ?? ""}`,
        ].join("\n");

        const allEpisodes = partial.episodes ?? [];
        if (input.step === "episodes") {
          const start = input.batch * EPISODES_PER_CHUNK + 1;
          const end = Math.min(start + EPISODES_PER_CHUNK - 1, cardEpisodes);
          if (start > cardEpisodes) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "批次超出首卡范围" });
          }
          const isFirst = start === 1;
          const rangeBeats = beatsFor(Math.max(1, start - 1), end); // 带前一集条目供开场承接
          const prevContext =
            !isFirst && allEpisodes.length
              ? [
                  "===== 本卡已产出集数梗概（仅供续写保持一致，绝不要重复产出这些集） =====",
                  epDigest(allEpisodes),
                  "",
                ].join("\n")
              : "";
          const { object: chunk } = await generateObjectStreamed({
            model: await getModel(),
            maxRetries: 3,
            schema: episodeChunkSchema,
            prompt: [
              `你是资深海外竖屏短剧总编剧。基于方向卡、人物小传与全剧集纲，产出本卡第 ${start}~${end} 集的连贯剧本（恰好 ${end - start + 1} 集，epNo 从 ${start} 连续编号，落在集纲对应条目轨道上）。`,
              "",
              "【小黑DNA 写作标准（语料实证，必须严格遵守）】",
              DNA_SCRIPT,
              "",
              "【产出要求】",
              `1. episodes：恰好本批 ${start}~${end} 集${
                isFirst
                  ? "。第 1 集按 DNA 四层钩写：前 3 秒视觉钩 → 前 30 秒信息钩三连 → 前 60 秒金钩 → 集尾痛点钩；开局骨架按题材选冷开场闪回式或 VO 自我介绍式"
                  : `。第 ${start} 集开场 1-2 行直接承接 EP${start - 1} 的集尾悬念，人物状态/秘密进度/物件钩进度与上文梗概严格一致`
              }。这些集本身就必须是可投流的素材。`,
              "2. 单集体量按 DNA：2.2 场戏/集、约 20 行英文台词/集、只推进一个冲突单元；开场不做空镜铺垫；对白回合制攻击—反击—升级；每集必有集尾钩（台词中断/表情定格/新威胁登场三选一），每集最后一个节拍用 note 收尾（特效: 黑场）。",
              "3. 台词执行语言 DNA：平均 5.5 词/句、短句为主、长句只留给 VO 前史与身份揭晓审判句；高频功能句型按赛道复用；先把赛道术语群撒进台词；女频 VO 占台词 10-30%（isVo 标记），男频 <10%；金额/年份/年龄用具体数字进台词。",
              "4. 【核心期待锁死】全剧主线必须兑现方向卡的 expectation 与忍的代价机制——只换元素外皮，关系结构与情绪承诺一个字的方向都不能改。若发现自己在写别的期待，立刻拉回。",
              "5. 物件钩要用起来：方向卡里设计的物件钩在剧本里要完成它当前阶段的链条动作（埋伏笔/羞辱/认亲）。",
              "6. 不得抄袭原作具体情节与台词，只保留情绪结构与节奏骨架。",
              "7. 【节拍级镜像纪律】若提供了原作逐集节拍镜像表（beatMap）：本批第 n 集镜像原作第 n 集——节拍的**数量、顺序、功能、情绪强度曲线**逐拍对齐；但每一拍的具体事件、场景、台词全部用新题材新写，复刻的是节奏骨架与情绪曲线，不是文字表达。每集必须填写 mirror 字段：sourceEpNo=镜像的原作集号，mapping 逐拍写「原作这一拍的功能」→「新剧这一拍的落法」。",
              "",
              "【剧本格式：中文短剧工作稿】严格按下面的节拍类型输出——",
              "- 场景头四要素拆成字段：timeOfDay（日/夜/晨/昏）、intExt（内/外）、location（中文地点，可含英文专名，如 米德尔堡猎狐与小马俱乐部·练习场）、cast（出场人物中文名）。闪回直接写进 location（如 树林·闪回）。",
              "- action 节拍：▲ 动作行，zh 只写可视化动作描述正文（简体中文），**不要自带 ▲ 符号**；一句一个镜头，15-35 字，情绪写成可视化表情指令（瞳孔收缩、死死攥紧、冷笑）。",
              "- dialogue 节拍：character=角色中文名，mood=情绪表演指令（2-6 字，如 压低声音，郑重），isVo=是否内心独白，en=地道美式英文台词，zh=与英文对应的简体中文对照——中文对照要比英文更口语、更「剧」，可增译情绪（如 \"Say her name again, I dare you.\" →「你有种再说一遍她的名字」）。en/zh 必须一一对应，不许漏译或自由发挥。",
              "- caption 节拍：【字幕】，en=英文大字幕，zh=简体中文。三类用途：角色首登场身份卡（用人物小传里设计的 captionCard）、金额/关键信息特写、集尾【字幕：未完待续】。身份/金额/反转词要上字幕——它是唯一的强调手段。",
              "- note 节拍：【闪切】/【特效】等制作说明，zh 只写内容正文（如 特效: 黑场 / 特效: 画面定格+金粉粒子 / 闪切: 九年前的雨夜…），**不要自带【】括号**。集尾视觉三板斧：定格→黑场/闪白→未完待续字幕。",
              "- logline、premise、positionHint、promoName、场景头字段全部用简体中文（给你看的说明文字）；只有台词 en 和字幕 en 是英文。",
              "",
              "【成稿自检（去 AI 味）】",
              DNA_DE_AI,
              "",
              LOCALIZATION_RULES,
              "（剧本里的人名、地名、机构、冲突筹码、台词梗全部用欧美语境；英文台词严禁任何中式表达。）",
              "",
              conceptBlock,
              "",
              directionBlock,
              "",
              "===== 人物小传 =====",
              JSON.stringify(foundationCard.characters, null, 2),
              "",
              "===== 本批集纲条目（剧本必须落在轨道上） =====",
              `大期待：${foundationCard.outline.expectation}`,
              `框架：${foundationCard.outline.framework}`,
              `核心梗：${foundationCard.outline.coreGimmick}`,
              JSON.stringify(rangeBeats, null, 2),
              prevContext,
              analysisBlock,
              beatMapFor(start, end) ? `\n${beatMapFor(start, end)}` : "",
              redBlock ? `\n${redBlock}` : "",
            ].join("\n"),
          });
          const mergedEpisodes = [
            ...allEpisodes.filter((e) => e.epNo < start || e.epNo > end),
            ...(chunk.episodes as EpisodeScript[]),
          ].sort((x, y) => x.epNo - y.epNo);
          const episodesPack: ConceptScriptPack = { ...partial, episodes: mergedEpisodes, status: "generating" };
          await savePack(input.projectId, episodesPack);
          return episodesPack;
        }

        // 第 3 步（独立请求）：2 段不连贯投流素材（优先从首卡之后的付费墙/大反转节点挑）
        const laterBeats = beatsFor(cardEpisodes + 1, Number.MAX_SAFE_INTEGER);
        const { object: promoObj } = await generateObjectStreamed({
          model: await getModel(),
          maxRetries: 3,
          schema: promoChunkSchema,
          prompt: [
            `你是资深海外竖屏短剧总编剧。某换皮剧的**首卡（第 1~${cardEpisodes} 集）已产出完毕**，现在补 2 段不连贯的投流素材。`,
            "",
            "【产出要求】",
            `1. promoClips：恰好 2 段完整单集（2-4 个场景 + 结尾黑场悬念）。epNo 优先大于首卡最大集号（>${cardEpisodes}）且不超过总集数 ${pool.totalEpisodes}；若集纲在首卡之后没有节点，则从全剧集纲挑两个最炸的关键节点、epNo 用该节点集号。每段给一句 premise 让没看过前情的观众秒懂这段戏，按「A 礼堂掀桌·这座楼是我的钱」这种「字母+短语概括卖点」风格起 promoName。`,
            "2. 单集体量与格式同首卡剧本：2.2 场戏左右、约 20 行英文台词、回合制对白、集尾钩 + 特效: 黑场；角色首登场给【字幕】身份卡。",
            "3. 【核心期待锁死】与【节拍级镜像纪律】同首卡要求：episode 的 mirror 必填（sourceEpNo=镜像的原作集号，逐拍对照）；内容全部新写，不抄原作表达。",
            "4. 物件钩完成当前阶段链条动作；台词语言 DNA 同首卡（5.5 词/句、赛道术语群、VO 占比、具体数字）。",
            "",
            "【剧本格式：中文短剧工作稿】与首卡一致——场景头四要素（timeOfDay/intExt/location/cast）、action/dialogue（en+zh 一一对应）/caption/note 节拍，说明文字中文、台词与字幕英文。",
            "",
            "【成稿自检（去 AI 味）】",
              DNA_DE_AI,
            "",
            LOCALIZATION_RULES,
            "",
            conceptBlock,
            "",
            directionBlock,
            "",
            "===== 首卡已产出集数梗概（素材不得与这些集号重复） =====",
            epDigest(allEpisodes),
            "",
            "===== 素材挑选范围：首卡之后的集纲节点 =====",
            JSON.stringify(laterBeats.length ? laterBeats : foundationCard.outline.beats.slice(-8), null, 2),
            beatMapFor(cardEpisodes + 1, Number.MAX_SAFE_INTEGER)
              ? `\n${beatMapFor(cardEpisodes + 1, Number.MAX_SAFE_INTEGER)}`
              : "",
            analysisBlock,
            redBlock ? `\n${redBlock}` : "",
          ].join("\n"),
        });

        const finalPack: ConceptScriptPack = {
          ...partial,
          episodes: allEpisodes,
          promoClips: promoObj.promoClips,
          status: "done",
        };
        await savePack(input.projectId, finalPack);
        return finalPack;
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
        const { object } = await generateObjectStreamed({
          model: await getModel(),
          maxRetries: 3,
          schema: evalReportSchema,
          prompt: [
            EVALUATOR_CORE,
            "",
            SCRIPT_STAGE_RULES,
            "",
            EVAL_OUTPUT_FORMAT,
            "",
            "【小黑DNA 判档尺子（语料实证标准，判档时逐条对照）】",
            DNA_EVAL,
            "",
            "判档重点核查：①第 1 集四层钩是否齐全（3 秒视觉钩/30 秒信息钩/60 秒金钩/集尾痛点钩）；②每集是否有集尾钩、体量是否符合 2.2 场/集约 20 行台词；③英文台词句长是否贴近 5.5 词/句、回合制对白、赛道术语群是否撒够；④角色首登场是否有【字幕】身份卡、集尾是否走完三板斧；⑤人物是否都有四态弧线（含反派）；⑥物件钩是否在剧本里完成当前链条动作；⑦VO 占比是否符合受众（女频 10-30%，男频 <10%）。不符合的按层级计入阻挡项或优化项。⑧若提供了原作逐集节拍镜像表：逐集核对新剧节拍与原作对应集的功能/顺序/情绪强度曲线是否对齐——脱节的集计入优化项（但核心期待漂移仍属阻挡项）。",
            "",
            LOCALIZATION_RULES,
            "（质检时若发现中式人名/称谓/制度/场景，计入阻挡项，要求改成欧美对应物。）",
            "",
            a?.coreExpectation ? `原爆款核心期待参考：${a.coreExpectation}` : "",
            a?.beatMap?.length ? `===== 原作逐集节拍镜像表（核查新剧对齐度用） =====\n${JSON.stringify(a.beatMap)}` : "",
            concept?.keptExpectation ? `方案锁定的核心期待（剧本必须兑现它）：${concept.keptExpectation}` : "",
            "【换皮质检红线】若发现剧本把核心期待改写/漂移了（而不是只换元素外皮——黑手党/狼人/霸总这类题材包装可以换，先婚后爱/复仇打脸/身份错位这类期待结构不能换），计为阻挡项，明确指出漂移点并要求改回锁定期待。",
            "",
            `===== 剧本包（方向卡 + ${pack.characters?.length ?? 0} 个人物 + ${pack.outline ? `集纲 ${pack.outline.beats.length} 条 + ` : ""}${pack.episodes.length} 集连贯 + ${pack.promoClips.length} 段投流素材） =====`,
            JSON.stringify(
              {
                logline: pack.logline,
                directionCard: pack.directionCard,
                characters: pack.characters,
                outline: pack.outline,
                episodes: pack.episodes,
                promoClips: pack.promoClips,
              },
              null,
              2,
            ),
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
