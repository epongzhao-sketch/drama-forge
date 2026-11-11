// 续跑卡住的剧本包：从指定步骤继续（幂等：episodes 批次按集号区间覆盖合并，重跑安全）
// 用法：npx tsx -r dotenv/config ./scripts/resume-pack.mts <projectId> <conceptId> [startBatch]
import { appRouter } from "../api/router";
import { findUserByUnionId } from "../api/queries/users";

const [, , projectIdStr, conceptId, batchStr] = process.argv;
const projectId = Number(projectIdStr);
const startBatch = Number(batchStr ?? 0);
if (!projectId || !conceptId) throw new Error("usage: resume-pack.mts <projectId> <conceptId> [startBatch]");
const unionId = process.env.OWNER_UNION_ID;
if (!unionId) throw new Error("OWNER_UNION_ID missing");
const user = await findUserByUnionId(unionId);
if (!user) throw new Error("dev user not found");
const caller = appRouter.createCaller({ req: new Request("http://localhost/"), resHeaders: new Headers(), user } as never);

const t0 = Date.now();
const mins = () => ((Date.now() - t0) / 60000).toFixed(1);
for (let batch = startBatch; batch <= 1; batch++) {
  console.log(`[${mins()}m] episodes batch=${batch} …`);
  await caller.pipeline.generateScriptPackStep({ projectId, conceptId, step: "episodes", batch });
  console.log(`[${mins()}m] batch=${batch} done`);
}
console.log(`[${mins()}m] promo …`);
const pack = await caller.pipeline.generateScriptPackStep({ projectId, conceptId, step: "promo" });
const eps = (pack.episodes ?? []).map((e) => e.epNo).sort((a, b) => a - b);
console.log(`[${mins()}m] DONE status=${pack.status} episodes=${eps.join(",")} promo=${pack.promoClips?.length}`);
process.exit(0);
