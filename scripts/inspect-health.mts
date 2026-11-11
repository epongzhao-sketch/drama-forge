// 只读检查线上库：最近项目的方案池与剧本包状态（排查 Load failed 现场）
import { getDb } from "../api/queries/connection";
import { projects, remaps, scriptPacks, analyses } from "../db/schema";
import { desc, eq } from "drizzle-orm";

const db = getDb();
const ps = await db.select().from(projects).orderBy(desc(projects.id)).limit(8);
for (const p of ps) {
  const [r] = await db.select().from(remaps).where(eq(remaps.projectId, p.id));
  const packs = await db.select().from(scriptPacks).where(eq(scriptPacks.projectId, p.id));
  const [a] = await db.select().from(analyses).where(eq(analyses.projectId, p.id));
  const pool = r?.settings as any;
  const packInfo = packs
    .map((k) => {
      const pk = k.pack as any;
      return `${k.conceptId}:${pk.status ?? "legacy"}/eps${pk.episodes?.length ?? "-"}/promo${pk.promoClips?.length ?? "-"}`;
    })
    .join("  ") || "-";
  console.log(
    `#${p.id}「${p.title}」 pool:${pool ? `${pool.concepts?.length}个方案 sel[${(pool.selectedIds ?? []).join(",")}]` : "无"} | packs: ${packInfo} | analysis:${a ? "有" : "无"}`,
  );
}
process.exit(0);
