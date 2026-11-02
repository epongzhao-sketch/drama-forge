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

/** 判档质检报告（三栏：阻挡项 / 优化项 / 体量与赛道） */
export interface EvalReport {
  scope: "outline" | "script";
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

export const PIPELINE_STAGES = [
  { key: "sample", label: "样本录入", en: "SAMPLE" },
  { key: "analysis", label: "AI 拆解", en: "DECONSTRUCT" },
  { key: "remap", label: "换皮设定", en: "REMAP" },
  { key: "bible", label: "总纲", en: "BIBLE" },
  { key: "outline", label: "分集大纲", en: "OUTLINE" },
  { key: "script", label: "剧本工坊", en: "STUDIO" },
] as const;

export type PipelineStageKey = (typeof PIPELINE_STAGES)[number]["key"];
