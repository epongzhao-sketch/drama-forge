// 共享流水线类型 —— 前端与后端（api/）都可 import
// DB 实体类型请用 db/schema.ts 的 $inferSelect

/** 红标素材段：原文中 [start, end) 字符区间被标注为投流效果好的素材 */
export interface RedSegment {
  id: string;
  start: number;
  end: number;
  note?: string;
}

/** AI 拆解结果 */
export interface AnalysisResult {
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
