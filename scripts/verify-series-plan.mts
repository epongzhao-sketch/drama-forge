// 全集续写批次计划与断点续跑逻辑自检（不连数据库）：npx tsx -r dotenv/config ./scripts/verify-series-plan.mts
import assert from "node:assert/strict";
import { seriesPlan, nextSeriesBatchIndex } from "../api/routers/seriesJobs.js";
import type { ConceptScriptPack, EpisodeScript } from "@contracts/pipeline";

const mkEp = (epNo: number) => ({ epNo, title: "", titleZh: "", scenes: [] }) as EpisodeScript;
const mkPack = (epNos: number[]): ConceptScriptPack =>
  ({
    conceptId: "c1",
    logline: "",
    directionCard: {},
    characters: [],
    episodes: epNos.map(mkEp),
    promoClips: [],
    status: "done",
  }) as unknown as ConceptScriptPack;

let failed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name} —— ${(e as Error).message}`);
  }
};

check("总集数 60 → 10 批，首批 11~15、末批 56~60", () => {
  const plan = seriesPlan(60);
  assert.equal(plan.length, 10);
  assert.deepEqual([plan[0].start, plan[0].end], [11, 15]);
  assert.deepEqual([plan[9].start, plan[9].end], [56, 60]);
});

check("总集数 62 → 末批 61~62（不足 5 集的尾批）", () => {
  const plan = seriesPlan(62);
  assert.equal(plan.length, 11);
  assert.deepEqual([plan[10].start, plan[10].end], [61, 62]);
});

check("总集数 ≤ 首卡 10 → 空计划（无需续写）", () => {
  assert.equal(seriesPlan(10).length, 0);
  assert.equal(seriesPlan(8).length, 0);
});

check("全集已齐（1~60 连续）→ 续跑起点 = plan.length（视为完成）", () => {
  const plan = seriesPlan(60);
  const pack = mkPack(Array.from({ length: 60 }, (_, i) => i + 1));
  assert.equal(nextSeriesBatchIndex(pack, plan), plan.length);
});

check("从未续写（仅首卡 1~10）→ 从第 0 批（11~15）开始", () => {
  const plan = seriesPlan(60);
  const pack = mkPack(Array.from({ length: 10 }, (_, i) => i + 1));
  assert.equal(nextSeriesBatchIndex(pack, plan), 0);
});

check("续到 20 集 → 从第 2 批（21~25）开始，完整批次跳过", () => {
  const plan = seriesPlan(60);
  const pack = mkPack(Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(nextSeriesBatchIndex(pack, plan), 2);
});

check("批内缺集（已有 1~22，缺 23~25）→ 仍回第 2 批补缺失集", () => {
  const plan = seriesPlan(60);
  const pack = mkPack(Array.from({ length: 22 }, (_, i) => i + 1));
  assert.equal(nextSeriesBatchIndex(pack, plan), 2);
});

check("部分续写但无任务（中断态判定素材：存在 epNo>10 的集）", () => {
  const pack = mkPack([...Array.from({ length: 10 }, (_, i) => i + 1), 11, 12]);
  assert.ok(pack.episodes.some((e) => e.epNo > 10));
});

assert.equal(failed, 0, `${failed} 个用例失败`);
console.log(`\n全部用例通过：全集续写批次计划与断点续跑逻辑正确。`);
