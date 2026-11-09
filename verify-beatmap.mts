// 验证 beatMap 新 schema 的真实 AI 链路：建项目 → 存样本 → 跑拆解 → 打印 beatMap
// 跑完清理测试项目。用法：npx tsx -r dotenv/config ./verify-beatmap.mts
import { appRouter } from "./api/router";
import { findUserByUnionId } from "./api/queries/users";

const SAMPLE = `EPISODE 1
INT. GREYSTONE MANSION - GRAND HALL - NIGHT
A crystal glass SHATTERS on marble. AVA kneels, picking up shards, her finger bleeding.
VICTORIA (cold): "Clean it up, maid."（擦干净，女佣。）
AVA (vo): "They think I'm a nobody. But what they don't know is…"（他们以为我什么都不是。但他们不知道的是……）
【字幕: AVA STONE — HEIRESS OF THE STONE FORTUNE（艾娃·斯通 —— 斯通家族继承人）】
DAMIEN enters, frozen. "Ava? What are you doing on your knees?"（艾娃？你跪在地上干什么？）
【特效: 黑场】

EPISODE 2
INT. MANSION - DINING ROOM - DAY
VICTORIA slams a contract on the table. "Sign it. Give up the shares."（签字。放弃股份。）
AVA (calm): "And if I don't?"（如果我不签呢？）
VICTORIA: "Then your son's trust fund disappears tonight."（那你儿子的信托基金今晚就消失。）
Ava's hand trembles over the pen. She SIGNS.
AVA (vo): "Every signature has a price, Victoria. You just don't know yours yet."（每个签名都有代价。你只是还不知道你的代价是什么。）
DAMIEN watches from the door, suspicious.
【字幕: 未完待续】`;

async function main() {
  const unionId = process.env.OWNER_UNION_ID;
  if (!unionId) throw new Error("OWNER_UNION_ID missing");
  const user = await findUserByUnionId(unionId);
  if (!user) throw new Error("dev user not found — hit /api/dev-login first");

  const caller = appRouter.createCaller({
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user,
  } as never);

  const { id } = await caller.pipeline.create({ title: "beatmap验证（自动清理）" });
  console.log("project id:", id);

  await caller.pipeline.saveSample({
    projectId: id,
    content: SAMPLE,
    redSegments: [{ id: "r1", start: 60, end: 120 }],
  });
  console.log("sample saved, running analysis (1-2 min)…");

  const t0 = Date.now();
  const analysis = await caller.pipeline.runAnalysis({ projectId: id });
  console.log(`analysis done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log("beatMap episodes:", analysis.beatMap?.length ?? "MISSING");
  if (analysis.beatMap) {
    for (const ep of analysis.beatMap) {
      console.log(`  EP${ep.epNo}${ep.paywall ? " [paywall]" : ""} beats=${ep.beats.length} cliff=${ep.cliffhangerType}`);
      for (const b of ep.beats.slice(0, 2)) {
        console.log(`    - [${b.position}] ${b.type} (${b.intensity}/10): ${b.summary.slice(0, 50)}`);
      }
    }
  }

  await caller.pipeline.remove({ id });
  console.log("test project cleaned up");
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
