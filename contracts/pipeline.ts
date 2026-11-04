// 共享流水线类型 —— 前端与后端（api/）都可 import
// DB 实体类型请用 db/schema.ts 的 $inferSelect

/** 红标素材段：原文中 [start, end) 字符区间被标注为投流效果好的素材 */
export interface RedSegment {
  id: string;
  start: number;
  end: number;
  note?: string;
}

/** 上传的原始剧本文件（仅存 docx；PDF 不入库） */
export interface StoredSourceFile {
  name: string;
  mime: string;
  size: number;
  /** base64，仅 .docx 会存，用于「下载原稿」 */
  dataB64?: string;
}

/** AI 拆解结果（V38.5：核心期待 × 元素 强制分离） */
export interface AnalysisResult {
  dramaType: string;
  coreExpectation: string;
  elements: string[];
  genre: string;
  tropeSummary: string;
  protagonist: string;
  antagonist: string;
  coreConflict: string;
  hookRhythm: string;
  hookTypes: string[];
  paywallPattern: string;
  redSegmentTraits: { quote: string; trait: string }[];
  transferableElements: string[];
  marketFit: string;
}

/** 爆款桥段移植：红标段 → 新剧目标集 的换算映射 */
export interface TransplantMapping {
  redSegmentId: string;
  sourceQuote: string;
  sourcePosition: string;
  targetEp: number;
  bridgeType: string;
  spec: string;
}

/** 判档结论 */
export type EvalVerdict = "pass" | "pass_with_fixes" | "revise_resubmit" | "fail";

export const VERDICT_LABELS: Record<EvalVerdict, string> = {
  pass: "通过",
  pass_with_fixes: "通过（附改法）",
  revise_resubmit: "修改后重提",
  fail: "不通过",
};

/** 判档质检报告（包级：对一个入选方案的整套剧本产出做评估） */
export interface EvalReport {
  scope: "pack" | "outline" | "script";
  epNo?: number;
  verdict: EvalVerdict;
  grade?: string;
  coreExpectationCheck: string;
  blockers: { issue: string; fix: string; level: string }[];
  optimizations: { issue: string; fix: string }[];
  volumeTrack: string;
  summary: string;
}

/** 换皮设定（用户输入） */
export interface RemapSettings {
  newGenre: string;
  protagonist: string;
  setting: string;
  audience: string;
  totalEpisodes: number;
  episodeSeconds: number;
  keepElements: string[];
  extraNotes?: string;
}

/** 总纲（Series Bible） */
export interface BibleResult {
  titleZh: string;
  titleEn: string;
  loglineZh: string;
  loglineEn: string;
  worldview: string;
  characters: { name: string; role: string; bio: string }[];
  mainConflict: string;
  toneAndStyle: string;
  episodeFormula: string;
}

/** 单集大纲 */
export interface OutlineEpisode {
  epNo: number;
  title: string;
  summary: string;
  hook: string;
  paywall: boolean;
}

/** 方向卡：入选方案的世界观设定（随剧本包产出，对标行业「方向卡」） */
export interface DirectionCard {
  expectation: string;    // 核心期待（与方案锁定期待同义，新题材语境展开）
  elements: string[];     // 元素清单（如 王室贵族/马甲掉马/萌宝/专业垂类）
  enduranceCost: string;  // 忍的代价（写死）：她不能直接亮身份的具体机制
  clock?: string;         // 时钟/倒计时（如 全剧倒计时60天），可无
  mastermind?: string;    // 真正的幕后反派及其盘算，可无
  breakingPoint: string;  // 「不得不破戒」的触发点
  powerMap: string;       // 强弱格局：女主真实/表面地位、男主、渣夫、反派相对位置
}

/** 人物小传 */
export interface CharacterBio {
  name: string;           // 英文名
  nameZh: string;         // 中文名（剧本台词标签用它）
  role: string;           // 定位：女主/男主/女主之子/反派/幕后反派…
  age?: string;
  realIdentity?: string;  // 真实身份
  coverIdentity?: string; // 表面身份
  backstory?: string;     // 前史
  personality: string;    // 性格
  desire?: string;        // 欲望
  weakness?: string;      // 弱点
  weapon?: string;        // 不暴露身份时的武器 / 筹码
  arc?: string;           // 弧光
  powerPosition?: string; // 强弱定位
  villainCheck?: string;  // 反派三查（持续动机/不蠢/量级，仅反派）
}

/**
 * 剧本节拍：中文短剧工作稿格式
 * action   = ▲ 动作行（zh 中文描述，可视化）
 * dialogue = 角色(mood): "en"（zh 中文翻译）
 * caption  = 【字幕: en】（zh）
 * note     = 【zh】（如 闪切 / 特效: 黑场）
 */
export interface ScriptBeat {
  type: "action" | "dialogue" | "caption" | "note";
  character?: string;  // dialogue：角色中文名
  mood?: string;       // dialogue：情绪/状态提示（压低声音，郑重）
  en?: string;         // dialogue/caption 的英文（地道美式）
  zh: string;          // action=动作行；dialogue=台词中文；caption=字幕中文；note=说明
}

/** 场景：场景头四要素 = 「集-场  日/夜  内/外  地点」+ 出场人物 */
export interface ScriptScene {
  sceneNo: number;
  timeOfDay: string;   // 日 / 夜 / 傍晚 / 晨
  intExt: string;      // 内 / 外 / 内外
  location: string;    // 中文地点（可含英文专名），如 米德尔堡猎狐与小马俱乐部·练习场
  cast: string[];      // 出场人物（中文名）
  beats: ScriptBeat[];
}

/** 单集完整剧本（中文工作稿 + 双语台词） */
export interface EpisodeScript {
  epNo: number;
  title: string;      // 英文暂名
  titleZh: string;    // 中文暂名
  scenes: ScriptScene[];
}

/** 换皮方案（AI 一次产出 10 个，人工粗选 3~5 个进入剧本产出） */
export interface RemapConcept {
  id: string;
  title: string;          // 新题材一句话（如 "狼人 Alpha 的契约新娘"）
  genre: string;          // 题材/赛道（元素外皮，如 黑手党 / 狼人 / 霸总 / 王室）
  keptExpectation: string; // 锁定不变的核心期待（与拆解报告同义等价，只换表述语境）
  protagonist: string;    // 主角设定
  setting: string;        // 时代/世界观背景
  twist: string;          // 这层新外皮为什么更炸（差异化卖点，不许改写核心期待）
  swappedElements: string[]; // 本方案更换掉的元素外皮清单（如 都市豪门 → 狼人族群）
  keepElements: string[]; // 沿用的爆款元素
}

/** 换皮方案池：10 个候选 + 人工粗选出的 3~5 个 id + 最终定稿 id */
export interface RemapPool {
  concepts: RemapConcept[];
  selectedIds: string[];            // 粗选 3~5 个
  finalId?: string;                 // 编审最终定稿 1 个
  totalEpisodes: number;            // 新剧总集数（全局设定）
  episodeSeconds: number;
  notes?: string;                   // 补充要求
}

/** 一段不连贯的投流素材：一集完整剧本，只是集号不与连贯集衔接（可发生在后面任意集） */
export interface PromoClip {
  id: string;
  promoName: string;      // 投流素材名，如「A 终极掉马·王储宣言」——字母编号+短语概括卖点
  epNo: number;             // 该素材实际落在全剧的第几集（如 9、21），与连贯集的 1~5 不连续
  positionHint: string;     // 落点说明（如 "付费卡点前一集" / "大结局前的高潮"）
  premise: string;          // 情境前提：让没看过前情的观众秒懂这段戏
  episode: EpisodeScript;   // 完整的一集剧本（多场景 + 结尾黑场悬念）
  hookLine: string;         // 可直接上大字幕的金句（英文）
  hookLineZh: string;       // 金句中文
}

/** 一个入选换皮方案的完整产出包：方向卡 + 人物小传 + 3~5 集连贯剧本 + 2 集不连贯投流素材 */
export interface ConceptScriptPack {
  conceptId: string;
  logline: string;                 // 本方案一句话卖点
  directionCard: DirectionCard;    // 方向卡
  characters: CharacterBio[];      // 人物小传
  episodes: EpisodeScript[];       // 3~5 集连贯剧本（本身即可投流）
  promoClips: PromoClip[];         // 2 集不连贯投流素材（完整单集剧本）
  status: "pending" | "generating" | "done" | "error";
}

export const PIPELINE_STAGES = [
  { key: "sample", label: "样本录入", en: "SAMPLE" },
  { key: "analysis", label: "AI 拆解", en: "DECONSTRUCT" },
  { key: "remap", label: "换皮方案", en: "REMAP" },
  { key: "pack", label: "剧本产出", en: "PRODUCE" },
  { key: "final", label: "编审定稿", en: "FINALIZE" },
] as const;

export type PipelineStageKey = (typeof PIPELINE_STAGES)[number]["key"];
