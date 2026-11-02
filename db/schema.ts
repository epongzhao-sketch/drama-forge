import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  int,
  json,
  longtext,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ---------- 爆剧复刻舱：流水线数据表 ----------

export const projects = mysqlTable("projects", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  sourceTitle: varchar("sourceTitle", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** 爆款样本（1:1 项目）：原文 + 红标素材段 */
export const samples = mysqlTable("samples", {
  id: serial("id").primaryKey(),
  projectId: bigint("projectId", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  content: longtext("content").notNull(),
  redSegments: json("redSegments").notNull(),
  /** 上传的原始 .docx 文件（base64），供下载原稿；PDF 不入库 */
  sourceFile: json("sourceFile"),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** AI 拆解结果（1:1 项目） */
export const analyses = mysqlTable("analyses", {
  id: serial("id").primaryKey(),
  projectId: bigint("projectId", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  result: json("result").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** 换皮设定（1:1 项目） */
export const remaps = mysqlTable("remaps", {
  id: serial("id").primaryKey(),
  projectId: bigint("projectId", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  settings: json("settings").notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** 总纲（1:1 项目） */
export const bibles = mysqlTable("bibles", {
  id: serial("id").primaryKey(),
  projectId: bigint("projectId", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  content: json("content").notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** 分集大纲（每集一行） */
export const outlines = mysqlTable(
  "outlines",
  {
    id: serial("id").primaryKey(),
    projectId: bigint("projectId", { mode: "number", unsigned: true }).notNull(),
    epNo: int("epNo").notNull(),
    data: json("data").notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("outlines_project_ep").on(t.projectId, t.epNo)],
);

/** 单集剧本（中英双语分字段存） */
export const scripts = mysqlTable(
  "scripts",
  {
    id: serial("id").primaryKey(),
    projectId: bigint("projectId", { mode: "number", unsigned: true }).notNull(),
    epNo: int("epNo").notNull(),
    contentZh: json("contentZh"),
    contentEn: json("contentEn"),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("scripts_project_ep").on(t.projectId, t.epNo)],
);

/** 爆款桥段移植方案（1:1 项目） */
export const transplants = mysqlTable("transplants", {
  id: serial("id").primaryKey(),
  projectId: bigint("projectId", { mode: "number", unsigned: true })
    .notNull()
    .unique(),
  mappings: json("mappings").notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** 判档质检报告（大纲：epNo=0；单集剧本：epNo=集号） */
export const evaluations = mysqlTable(
  "evaluations",
  {
    id: serial("id").primaryKey(),
    projectId: bigint("projectId", { mode: "number", unsigned: true }).notNull(),
    scope: varchar("scope", { length: 16 }).notNull(),
    epNo: int("epNo").notNull().default(0),
    report: json("report").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("evaluations_project_scope_ep").on(t.projectId, t.scope, t.epNo)],
);

export type Project = typeof projects.$inferSelect;
export type Sample = typeof samples.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type Remap = typeof remaps.$inferSelect;
export type Bible = typeof bibles.$inferSelect;
export type Outline = typeof outlines.$inferSelect;
export type Script = typeof scripts.$inferSelect;
export type Transplant = typeof transplants.$inferSelect;
export type Evaluation = typeof evaluations.$inferSelect;
