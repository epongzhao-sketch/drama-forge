// 验证首卡全量产出：直接播种最小拆解+方案池 → 调 generateScriptPack → 检查 10 集 + 2 素材 + mirror
// 用法：npx tsx -r dotenv/config ./scripts/verify-first-card.mts
import { appRouter } from "../api/router";
import { findUserByUnionId } from "../api/queries/users";
import { getDb } from "../api/queries/connection";
import { analyses, remaps } from "../db/schema";

const unionId = process.env.OWNER_UNION_ID;
if (!unionId) throw new Error("OWNER_UNION_ID missing");
const user = await findUserByUnionId(unionId);
if (!user) throw new Error("dev user not found");

const caller = appRouter.createCaller({ req: new Request("http://localhost/"), resHeaders: new Headers(), user } as never);

// 1. 建项目
const { id: projectId } = await caller.pipeline.create({ title: "首卡验证（自动清理）" });
console.log("project:", projectId);

// 2. 播种最小拆解（含 10 集节拍镜像表 + 每集体量目标：场数/台词行数）
const beatMap = Array.from({ length: 10 }, (_, i) => ({
  epNo: i + 1,
  paywall: i + 1 === 5,
  scenes: 2 + (i % 2),          // 交替 2/3 场，检验逐集对齐
  lines: 18 + i * 2,            // 18~36 行递增，检验逐集对齐
  beats: [
    { position: "开场", type: i === 0 ? "视觉钩" : "承接悬念", summary: `第${i + 1}集开场节拍概括（功能级）`, intensity: 8 },
    { position: "中段", type: "受辱反击", summary: `第${i + 1}集冲突回合概括`, intensity: 7 },
    { position: "集尾", type: "新威胁登场", summary: `第${i + 1}集集尾悬念概括`, intensity: 9 },
  ],
  cliffhangerType: "新威胁登场型",
}));
await getDb().insert(analyses).values({
  projectId,
  result: {
    dramaType: "女频-隐藏身份复仇",
    coreExpectation: "等着看被赶出豪门的养女以财阀继承人身份回来打脸所有人",
    elements: ["隐藏身份", "契约婚姻", "调包"],
    genre: "豪门复仇",
    tropeSummary: "隐藏身份+契约婚姻+复仇打脸",
    protagonist: "表面是女佣、实际是失踪继承人的女主",
    antagonist: "抢走她身份的假千金与不知情的渣夫",
    coreConflict: "她不能亮身份（信托条款写死），只能暗中布局",
    hookRhythm: "每 30 秒一个小钩子，每集一个集尾大钩",
    hookTypes: ["身份反差", "羞辱", "反转"],
    redSegmentTraits: [],
    transferableElements: ["隐藏身份亮底牌", "当众打脸"],
    marketFit: "欧美豪门复仇赛道",
    beatMap,
  },
});
console.log("analysis seeded");

// 3. 播种方案池（1 个方案入选）
const concept = {
  id: "verify-concept-1",
  title: "The Trust Fund Heiress（信托基金继承人）",
  genre: "豪门霸总",
  keptExpectation: "等着看被赶出豪门的养女以财阀继承人身份回来打脸所有人",
  protagonist: "表面是律所助理、实际是失踪财阀唯一继承人的女主",
  setting: "现代北美，老牌财阀家族与家族信托",
  twist: "信托条款让「不能亮身份」从借口变成铁律，打脸每一拍都更致命",
  swappedElements: ["都市豪门 → 财阀信托"],
  keepElements: ["隐藏身份", "当众打脸"],
};
await getDb().insert(remaps).values({
  projectId,
  settings: { concepts: [concept], selectedIds: ["verify-concept-1"], totalEpisodes: 60, episodeSeconds: 75 },
});
console.log("pool seeded, running pack generation (15-40 min)…");

// 4. 分步真实生成（前端同款四步串行）
const t0 = Date.now();
await caller.pipeline.generateScriptPackStep({ projectId, conceptId: "verify-concept-1", step: "foundation" });
await caller.pipeline.generateScriptPackStep({ projectId, conceptId: "verify-concept-1", step: "episodes", batch: 0 });
await caller.pipeline.generateScriptPackStep({ projectId, conceptId: "verify-concept-1", step: "episodes", batch: 1 });
const pack = await caller.pipeline.generateScriptPackStep({ projectId, conceptId: "verify-concept-1", step: "promo" });
const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`pack done in ${mins} min (4 个独立请求)`);

// 5. 校验
const eps = pack.episodes ?? [];
const epNos = eps.map((e) => e.epNo).sort((a, b) => a - b);
console.log(`episodes: ${eps.length} 集, 集号: ${epNos.join(",")}`);
const withMirror = eps.filter((e) => e.mirror?.mapping?.length).length;
console.log(`带节拍镜像对照: ${withMirror}/${eps.length}`);
console.log(`promoClips: ${pack.promoClips?.length}, 集号: ${pack.promoClips?.map((c) => c.epNo).join(",")}`);

// 5b. 逐集体量对齐校验（目标：场数误差 ≤1，台词行数误差 ≤20%）
let volumePass = 0;
for (const e of eps) {
  const target = beatMap.find((b) => b.epNo === e.epNo);
  if (!target) continue;
  const scenes = e.scenes.length;
  const lines = e.scenes.reduce((n, s) => n + s.beats.filter((b) => b.type === "dialogue").length, 0);
  const scenesOk = Math.abs(scenes - target.scenes!) <= 1;
  const linesOk = Math.abs(lines - target.lines!) <= Math.max(4, Math.ceil(target.lines! * 0.2));
  if (scenesOk && linesOk) volumePass++;
  console.log(`  EP${e.epNo}: 场 ${scenes}/${target.scenes}${scenesOk ? "✓" : "✗"}  台词行 ${lines}/${target.lines}${linesOk ? "✓" : "✗"}`);
}
const volumeOk = volumePass === eps.length;
console.log(volumeOk ? `PASS: 体量对齐 ${volumePass}/${eps.length}` : `FAIL: 体量对齐 ${volumePass}/${eps.length}`);

const ok = eps.length === 10 && epNos[0] === 1 && epNos[9] === 10 && (pack.promoClips?.length ?? 0) === 2 && volumeOk;
console.log(ok ? "PASS: 首卡 10 集全量 + 2 素材 + 逐集体量对齐" : "FAIL: 产出不完整");

// 6. 清理
await caller.pipeline.remove({ id: projectId });
console.log("test project cleaned up");
process.exit(ok ? 0 : 1);
