import { appRouter } from "./api/router";
import { upsertUser, findUserByUnionId } from "./api/queries/users";
import { getDb } from "./api/queries/connection";
import { users, usageLogs, creditTransactions, projects, samples, analyses } from "./db/schema";
import { eq } from "drizzle-orm";
import { getUserKeyInfo, MARKUP } from "./api/ai/wallet";
import { readFileSync } from "fs";

const UNION_ID = "verify-bot-billing-1";

async function main() {
  await upsertUser({ unionId: UNION_ID, name: "billing-bot" });
  const user = await findUserByUnionId(UNION_ID);
  if (!user) throw new Error("no user");
  const db = getDb();
  const caller = appRouter.createCaller({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user,
  } as never);

  // 1. 初始状态
  const s0 = await caller.wallet.status();
  console.log(`[1] 初始: hasKey=${s0.hasKey}, balance=${s0.balance}, markup=${s0.markup}`);

  // 2. 绑一个假 Key（格式校验通过即可——真实调用会失败，我们先测站点代购通道）
  //    先不绑，测站点通道；绑 Key 的 BYOK 通道单独说明（需要真实 Key 才能跑通模型）
  // 3. 充值
  const r = await caller.wallet.recharge({ tierCny: 10 });
  console.log(`[2] 充值 ¥10 → +${r.added} 点, balance=${r.balance}`);

  // 4. 建项目 + 录入样本，跑一次真实 AI 拆解（站点代购通道）
  const FULL = readFileSync("/tmp/ref-output/Think Again! I'm the Hidden Boss Mom.txt", "utf-8").slice(0, 6000);
  const project = await caller.pipeline.create({ title: "计费验证", sourceTitle: "BossMom" });
  const seg1Start = FULL.indexOf("托拜厄斯(嘲讽地大声喊)");
  const seg1End = FULL.indexOf("那个书呆子死定了！");
  await caller.pipeline.saveSample({
    projectId: project.id,
    content: FULL,
    redSegments: seg1Start >= 0 && seg1End > 0 ? [{ id: "r1", start: seg1Start, end: seg1End + 10, note: "素材" }] : [],
  });

  console.log("[3] 跑真实 AI 拆解（站点代购）…");
  const t = Date.now();
  await caller.pipeline.runAnalysis({ projectId: project.id });
  console.log(`    拆解完成 ${(Date.now() - t) / 1000}s`);

  // 5. 核对 usage_logs 与余额扣减
  const logs = await db.select().from(usageLogs).where(eq(usageLogs.userId, user.id));
  const txs = await db.select().from(creditTransactions).where(eq(creditTransactions.userId, user.id));
  const sAfter = await caller.wallet.status();
  console.log(`[4] usage_logs ${logs.length} 条:`);
  for (const l of logs) {
    console.log(`    ${l.action} via=${l.via} tok=${l.inputTokens}+${l.outputTokens} charged=${l.creditsCharged} (期望=ceil(${(l.inputTokens + l.outputTokens)}×${MARKUP})=${Math.ceil((l.inputTokens + l.outputTokens) * MARKUP)})`);
  }
  console.log(`[5] 流水:`);
  for (const x of txs) {
    console.log(`    ${x.kind} delta=${x.delta} after=${x.balanceAfter} note=${x.note ?? ""}`);
  }
  console.log(`[6] 最终余额=${sAfter.balance}（初始 100000 - 消费应=${100000 - sAfter.balance}）`);

  // 一致性校验
  const totalCharged = logs.reduce((a, l) => a + l.creditsCharged, 0);
  const expected = 100000 - totalCharged;
  const pass = sAfter.balance === expected && logs.length > 0 && logs.every((l) => l.via === "site");
  console.log(`\n${pass ? "PASS" : "FAIL"}: 余额一致性 (余额=${sAfter.balance}, 期望=${expected}, 消费合计=${totalCharged})`);

  // 清理
  await db.delete(usageLogs).where(eq(usageLogs.userId, user.id));
  await db.delete(creditTransactions).where(eq(creditTransactions.userId, user.id));
  await db.delete(analyses).where(eq(analyses.projectId, project.id));
  await db.delete(samples).where(eq(samples.projectId, project.id));
  await db.delete(projects).where(eq(projects.id, project.id));
  await db.delete(users).where(eq(users.id, user.id));
  console.log("cleaned");
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
