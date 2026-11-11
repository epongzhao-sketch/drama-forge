// 查某个项目的归属用户（排查续跑脚本的 NOT_FOUND）
import { getDb } from "../api/queries/connection";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";
import { findUserByUnionId } from "../api/queries/users";

const id = Number(process.argv[2]);
const db = getDb();
const [p] = await db.select().from(projects).where(eq(projects.id, id));
console.log("project:", p ? { id: p.id, userId: p.userId, title: p.title } : "NOT FOUND");
const unionId = process.env.OWNER_UNION_ID!;
const user = await findUserByUnionId(unionId);
console.log("dev-login user id:", user?.id, "match project?", user?.id === p?.userId);
process.exit(0);
