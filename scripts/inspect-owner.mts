// 排查项目归属：对比项目 userId 与 dev-login 用户 id
import { getDb } from "../api/queries/connection";
import { projects, users } from "../db/schema";
import { eq } from "drizzle-orm";

const projectId = Number(process.argv[2]);
if (!projectId) throw new Error("usage: inspect-owner.mts <projectId>");
const db = getDb();
const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
console.log("project", projectId, "userId =", proj?.userId);
const all = await db.select().from(users);
for (const u of all) console.log("user", u.id, u.unionId, u.name);
process.exit(0);
