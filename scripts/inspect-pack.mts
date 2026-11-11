// 查看剧本包逐集明细：集号/标题/场次数/台词行数/镜像
import { getDb } from "../api/queries/connection";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";

const [, , projectIdStr, conceptId] = process.argv;
const db = getDb();
const [proj] = await db.select().from(projects).where(eq(projects.id, Number(projectIdStr)));
if (!proj) throw new Error("project not found");
const packs = (proj.scriptPacks ?? []) as any[];
const pack = packs.find((p) => p.conceptId === conceptId);
if (!pack) throw new Error("pack not found: " + conceptId);
console.log("status:", pack.status, "episodes:", pack.episodes?.length, "promo:", pack.promoClips?.length);
for (const ep of (pack.episodes ?? []).sort((a: any, b: any) => a.epNo - b.epNo)) {
  const scenes = ep.scenes?.length ?? 0;
  const lines = (ep.scenes ?? []).reduce(
    (acc: number, s: any) => acc + (s.beats ?? []).filter((b: any) => b.type === "dialogue").length,
    0,
  );
  console.log(`  EP${ep.epNo}《${ep.titleZh}》 scenes=${scenes} dialogueLines=${lines} mirror=${ep.mirror ? "y" : "n"}`);
}
process.exit(0);
