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

/** 原作逐集节拍镜像表（AI 拆解产出）：每集的节拍序列 = 位置 + 功能 + 内容概括 + 情绪强度
 * 纪律：summary 是功能级概括，不是原文台词抄录——镜像的是节奏与情绪曲线，不是具体表达 */
export interface BeatMapEpisode {
  epNo: number;
  paywall?: boolean; // 该集是否付费卡点
  scenes?: number;   // 该集场数（新剧按此对齐体量）
  lines?: number;    // 该集英文台词行数（新剧按此对齐体量）
  beats: {
    position: string; // 节拍位置：开场 / 前段 / 中段 / 后段 / 集尾
    type: string;     // 节拍功能：视觉钩 / 受辱 / 隐忍 / 反转 / 打脸 / 身份危机 / 信息钩…
    summary: string;  // 该节拍发生了什么（功能概括，不抄原文）
    intensity: number; // 情绪强度 1-10
  }[];
  cliffhangerType: string; // 集尾悬念类型：台词中断 / 表情定格 / 新威胁登场
}

/** 新剧单集与原作节拍的镜像对照（随剧本包产出） */
export interface BeatMirror {
  sourceEpNo: number; // 镜像的原作集号
  mapping: { sourceBeat: string; newBeat: string }[]; // 原作节拍功能 → 新剧该节拍的落法（全新表达）
}

/** AI 拆解结果（小黑DNA 六板块模板：基础信息→四层钩→付费墙→人物四态→换皮方法论→集纲） */
export interface AnalysisResult {
  // —— 板块 1：基础信息 ——
  dramaType: string;
  coreExpectation: string;
  elements: string[];
  genre: string;
  tropeSummary: string;
  protagonist: string;
  antagonist: string;
  coreConflict: string;
  // —— 板块 2：四层钩拆解（DNA：第 1 集四层钩缺一不可） ——
  hookRhythm: string;
  hookTypes: string[];
  hook4?: { visual3s: string; info30s: string; golden60s: string; epEndPain: string };
  openingSkeleton?: string; // 冷开场闪回式 / VO 自我介绍式（含为何适配该赛道）
  // —— 板块 3：付费墙 ——
  paywallPattern: string;
  paywallTable?: { ep: string; event: string; intensity: number }[];
  beatDensity?: string; // 卡点密度曲线（低开高走，每 5 集一个台阶）
  // —— 板块 4：人物四态弧线（起点→转折→高潮→终点，各绑情绪关键词） ——
  arcs?: { character: string; start: string; turn: string; climax: string; end: string }[];
  emotionCurve5?: string; // 情绪 5 段式：隐忍→蒙冤→觉醒→翻盘→收束
  // —— 红标段 & 迁移 ——
  redSegmentTraits: { quote: string; trait: string }[];
  transferableElements: string[];
  // —— 板块 5：换皮方法论 ——
  motifs?: string[];         // 母题库复合拆解（如 重生复仇+调包+隐藏身份）
  objectHooks?: string[];    // 贯穿物件钩（伏笔—羞辱—反转认亲全链条）
  reskinGate?: { skeleton: string; adaptMotifs: string; cultureFit: string }; // 换皮三关
  marketFit: string;
  // —— 板块 6：逐集节拍镜像表（节拍级复刻的骨架依据） ——
  beatMap?: BeatMapEpisode[];
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
  motifs?: string[];      // DNA：本剧 = 哪 2-4 个成熟母题的复合
  objectHooks?: { name: string; chain: string }[]; // DNA：2-3 个贯穿物件钩 + 伏笔—羞辱—反转认亲链条
  colorCode?: string;     // DNA：赛道主色情绪编码（如 狼人=金+银，霸总=冷灰+品牌金）
}

/** 人物小传 */
export interface CharacterBio {
  name: string;           // 英文名
  nameZh: string;         // 中文名（剧本台词标签用它）
  role: string;           // 定位：女主/男主/女主之子/反派/幕后反派…
  age?: string;
  realIdentity?: string;  // 真实身份
  coverIdentity?: string; // 表面身份
  captionCard?: string;   // DNA：首登场【字幕】身份卡（英文+中文对照，关系型标关系）
  backstory?: string;     // 前史
  personality: string;    // 性格
  desire?: string;        // 欲望
  weakness?: string;      // 弱点
  weapon?: string;        // 不暴露身份时的武器 / 筹码
  arc?: string;           // 弧光（兼容旧格式：从…到…）
  arc4?: { start: string; turn: string; climax: string; end: string }; // DNA 四态弧线，各绑情绪关键词
  powerPosition?: string; // 强弱定位
  villainCheck?: string;  // 反派三查（持续动机/不蠢/量级，仅反派）
}

/** 剧本节拍：中文短剧工作稿格式
 * action   = ▲ 动作行（zh 中文描述，可视化）
 * dialogue = 角色(mood): "en"（zh 中文翻译）；isVo=true 时为 VO 内心独白
 * caption  = 【字幕: en】（zh）——角色首登场身份卡/金额/反转词大卡
 * note     = 【zh】（如 闪切 / 特效: 黑场）
 */
export interface ScriptBeat {
  type: "action" | "dialogue" | "caption" | "note";
  character?: string;  // dialogue：角色中文名
  mood?: string;       // dialogue：情绪/状态提示（压低声音，郑重）
  isVo?: boolean;      // dialogue：VO 内心独白标记（女频 10-30%，男频 <10%）
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
  mirror?: BeatMirror; // 与原作对应集的节拍镜像对照（新版产出才有）
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

/** 逐集集纲（DNA 拆剧模板板块 6：钩子/剧情/集尾悬念） */
export interface OutlineBeat {
  epNo: number;
  hook: string;        // 本集钩子（开场承接）
  plot: string;        // 剧情一句话
  cliffhanger: string; // 集尾悬念（台词中断/表情定格/新威胁登场）
  paywall?: boolean;   // 是否付费墙位置（EP5/12/24/38/45）
}

/** 一个入选换皮方案的完整产出包：方向卡 + 人物小传 + 全剧集纲 + 首卡 1~10 集全量连贯剧本 + 2 集不连贯投流素材 */
export interface ConceptScriptPack {
  conceptId: string;
  logline: string;                 // 本方案一句话卖点
  directionCard: DirectionCard;    // 方向卡
  characters: CharacterBio[];      // 人物小传
  outline?: {
    expectation: string;           // 大期待（一句话锁死全剧）
    framework: string;             // 框架（分型骨架 + 情绪 5 段式落位）
    coreGimmick: string;           // 核心梗
    beats: OutlineBeat[];          // 逐集集纲（至少前 10 集，尽量覆盖全剧关键节点）
  };
  episodes: EpisodeScript[];       // 首卡 1~10 集全量连贯剧本（本身即可投流）
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
