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
  /** BYOK：用户自己的 Kimi 开放平台 API Key（AES-256-GCM 加密存储） */
  kimiApiKeyEnc: text("kimiApiKeyEnc"),
  /** 内部点数余额（点数 = 实际模型 token 消耗 × 1.25，含 25% 平台服务费） */
  creditBalance: bigint("creditBalance", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

/** AI 用量流水：每次模型调用记录真实 token 与点数扣减 */
export const usageLogs = mysqlTable("usage_logs", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  projectId: bigint("projectId", { mode: "number", unsigned: true }),
  /** 业务动作：analysis / concepts / pack_foundation / pack_script / evaluate / vision */
  action: varchar("action", { length: 32 }).notNull(),
  model: varchar("model", { length: 128 }),
  inputTokens: int("inputTokens").notNull().default(0),
  outputTokens: int("outputTokens").notNull().default(0),
  /** 扣减的点数（含 25% 平台服务费），余额不足未扣则为 0 */
  creditsCharged: bigint("creditsCharged", { mode: "number" }).notNull().default(0),
  /** 计费路径：byok=用户自带 Key，site=站点代购 */
  via: mysqlEnum("via", ["byok", "site"]).notNull().default("site"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** 点数钱包流水：充值 / 消费 / 调整 */
export const creditTransactions = mysqlTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  /** 正=入账（充值/调整），负=扣减 */
  delta: bigint("delta", { mode: "number" }).notNull(),
  balanceAfter: bigint("balanceAfter", { mode: "number" }).notNull(),
  kind: mysqlEnum("kind", ["recharge", "consume", "adjust"]).notNull(),
  note: varchar("note", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
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

/** 换皮方案池（1:1 项目）：10 个候选 + 粗选 + 定稿 */
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

/** 入选换皮方案的剧本产出包（每方案一行）：连贯集 + 不连贯投流素材 */
export const scriptPacks = mysqlTable(
  "script_packs",
  {
    id: serial("id").primaryKey(),
    projectId: bigint("projectId", { mode: "number", unsigned: true }).notNull(),
    conceptId: varchar("conceptId", { length: 64 }).notNull(),
    pack: json("pack").notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("script_packs_project_concept").on(t.projectId, t.conceptId)],
);

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
export type UsageLog = typeof usageLogs.$inferSelect;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type Sample = typeof samples.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type Remap = typeof remaps.$inferSelect;
export type ScriptPackRow = typeof scriptPacks.$inferSelect;
export type Bible = typeof bibles.$inferSelect;
export type Outline = typeof outlines.$inferSelect;
export type Script = typeof scripts.$inferSelect;
export type Transplant = typeof transplants.$inferSelect;
export type Evaluation = typeof evaluations.$inferSelect;
