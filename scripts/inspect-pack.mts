// 查看某包实际落库的集号与每集场景数（检查缺集/空集）
import { getDb } from "../api/queries/connection";
import { scriptPacks } from "../db/schema";
import { and, eq } from "drizzle-orm";

const [projectId, conceptId] = [Number(process.argv[2]), process.argv[3]];
const db = getDb();
const [row] = await db.select().from(scriptPacks).where(and(eq(scriptPacks.projectId, projectId), eq(scriptPacks.conceptId, conceptId)));
if (!row) { console.log("no pack"); process.exit(0); }
const pk = row.pack as any;
console.log("status:", pk.status, "episodes:", pk.episodes?.length, "promo:", pk.promoClips?.length);
for (const e of pk.episodes ?? []) {
  const lines = (e.scenes ?? []).reduce((n: number, s: any) => n + (s.beats?.filter((b: any) => b.type === "dialogue").length ?? 0), 0);
  console.log(`  EP${e.epNo}《${e.titleZh}》 scenes=${e.scenes?.length} dialogueLines=${lines} mirror=${e.mirror ? "y" : "n"}`);
}
process.exit(0);
