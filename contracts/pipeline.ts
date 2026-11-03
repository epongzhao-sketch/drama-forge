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

/** 剧本节拍 */
export interface ScriptBeat {
  type: "action" | "dialogue";
  character?: string;
  text: string;
}

export interface ScriptScene {
  sceneNo: number;
  location: string;
  time: string;
  beats: ScriptBeat[];
}

/** 单集完整剧本 */
export interface EpisodeScript {
  epNo: number;
  title: string;
  scenes: ScriptScene[];
  cliffhanger: string;
  /** 移植桥段所在的场景号（成稿重点描写的素材段场景） */
  transplantScenes?: number[];
}

/** 换皮方案（AI 一次产出 10 个，人工粗选 3~5 个进入剧本产出） */
export interface RemapConcept {
  id: string;
  title: string;          // 新题材一句话（如 "狼人 Alpha 的契约新娘"）
  genre: string;          // 题材/赛道
  protagonist: string;    // 主角设定
  setting: string;        // 时代/世界观背景
  twist: string;          // 这个方案的核心差异化卖点（为什么这版能爆）
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
  epNo: number;             // 该素材实际落在全剧的第几集（如 9、21），与连贯集的 1~5 不连续
  positionHint: string;     // 落点说明（如 "付费卡点前一集" / "大结局前的高潮"）
  premise: string;          // 情境前提：让没看过前情的观众秒懂这段戏
  episode: EpisodeScript;   // 完整的一集剧本（多场景 + 结尾悬念）
  hookLine: string;         // 可直接上大字幕的金句
}

/** 一个入选换皮方案的完整产出包：3~5 集连贯剧本 + 2 集不连贯投流素材 */
export interface ConceptScriptPack {
  conceptId: string;
  logline: string;                 // 本方案一句话卖点
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
