// 续跑卡住的剧本包：从指定步骤继续（幂等：episodes 批次按集号区间覆盖合并，重跑安全）
// 用法：npx tsx -r dotenv/config ./scripts/resume-pack.mts <projectId> <conceptId> [startBatch]
import { appRouter } from "../api/router";
import { findUserByUnionId } from "../api/queries/users";
import { getDb } from "../api/queries/connection";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";

const [, , projectIdStr, conceptId, batchStr] = process.argv;
const projectId = Number(projectIdStr);
const startBatch = Number(batchStr ?? 0);
if (!projectId || !conceptId) throw new Error("usage: resume-pack.mts <projectId> <conceptId> [startBatch]");

// 用项目归属用户身份调用（dev-login 用户不一定是项目 owner）
const db = getDb();
const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
if (!proj) throw new Error("project not found");
const ownerUnionId = process.env.OWNER_UNION_ID!;
let user = await findUserByUnionId(ownerUnionId);
if (!user || user.id !== proj.userId) {
  // 直接从 users 表按 id 取归属用户
  const { users } = await import("../db/schema");
  const [u] = await db.select().from(users).where(eq(users.id, proj.userId));
  if (!u) throw new Error("project owner not found in users table");
  user = u;
}
console.log("acting as user", user.id, "for project", projectId);
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
