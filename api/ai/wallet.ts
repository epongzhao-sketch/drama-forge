// BYOK：用户自带 Kimi 开放平台 API Key 的加密存取 + 点数钱包记账
import crypto from "crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { users, usageLogs, creditTransactions } from "@db/schema";
import { env } from "../lib/env";

/** 平台服务费系数：点数 = 实际模型 token 消耗 × 1.25（25% 抽成，维持站点运营） */
export const MARKUP = 1.25;

/** 充值档位：人民币 → 点数。按站点模型实际成本定价（档位页有说明）。 */
export const RECHARGE_TIERS = [
  { cny: 10, credits: 100_000 },
  { cny: 30, credits: 350_000 },
  { cny: 68, credits: 900_000 },
  { cny: 128, credits: 1_900_000 },
] as const;

// ---------- Key 加解密（AES-256-GCM，密钥由 APP_SECRET 派生，不落盘） ----------

function deriveKey(): Buffer {
  return crypto.scryptSync(env.appSecret, "kimi-byok-salt-v1", 32);
}

export function encryptApiKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  let enc = cipher.update(plain, "utf8", "base64");
  enc += cipher.final("base64");
  const tag = cipher.getAuthTag().toString("base64");
  return `${iv.toString("base64")}:${tag}:${enc}`;
}

export function decryptApiKey(packed: string): string | null {
  try {
    const [iv, tag, enc] = packed.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    let dec = decipher.update(enc, "base64", "utf8");
    dec += decipher.final("utf8");
    return dec;
  } catch {
    return null;
  }
}

// ---------- 用户 Key ----------

export async function getUserApiKey(userId: number): Promise<string | null> {
  const db = getDb();
  const [u] = await db.select({ enc: users.kimiApiKeyEnc }).from(users).where(eq(users.id, userId));
  if (!u?.enc) return null;
  return decryptApiKey(u.enc);
}

export async function setUserApiKey(userId: number, plainKey: string | null): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({ kimiApiKeyEnc: plainKey ? encryptApiKey(plainKey) : null })
    .where(eq(users.id, userId));
}

export async function getUserKeyInfo(userId: number) {
  const db = getDb();
  const [u] = await db
    .select({ enc: users.kimiApiKeyEnc, balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, userId));
  const key = u?.enc ? decryptApiKey(u.enc) : null;
  return {
    hasKey: !!key,
    keyPreview: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null,
    balance: u?.balance ?? 0,
  };
}

// ---------- 点数钱包 ----------

export async function getBalance(userId: number): Promise<number> {
  const db = getDb();
  const [u] = await db.select({ b: users.creditBalance }).from(users).where(eq(users.id, userId));
  return u?.b ?? 0;
}

/** 入账（充值/调整）。返回新余额。 */
export async function addCredits(userId: number, amount: number, kind: "recharge" | "adjust", note?: string) {
  const db = getDb();
  await db.update(users).set({ creditBalance: sql`creditBalance + ${amount}` }).where(eq(users.id, userId));
  const balance = await getBalance(userId);
  await db.insert(creditTransactions).values({ userId, delta: amount, balanceAfter: balance, kind, note });
  return balance;
}

/**
 * 记录一次模型调用并扣点。
 * 点数 = ceil((input+output) × 1.25)。余额不足：扣到 0，返回 ok=false（由调用方决定是否报错）。
 */
export async function chargeUsage(args: {
  userId: number;
  projectId?: number;
  action: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  via: "byok" | "site";
}) {
  const db = getDb();
  const credits = Math.ceil((args.inputTokens + args.outputTokens) * MARKUP);
  const balance = await getBalance(args.userId);
  const ok = balance >= credits;
  const charged = ok ? credits : Math.max(0, balance);
  if (charged > 0) {
    await db
      .update(users)
      .set({ creditBalance: sql`GREATEST(0, creditBalance - ${charged})` })
      .where(eq(users.id, args.userId));
    await db.insert(creditTransactions).values({
      userId: args.userId,
      delta: -charged,
      balanceAfter: balance - charged,
      kind: "consume",
      note: `${args.action} · ${args.inputTokens}+${args.outputTokens} tok`,
    });
  }
  await db.insert(usageLogs).values({
    userId: args.userId,
    projectId: args.projectId ?? null,
    action: args.action,
    model: args.model ?? null,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    creditsCharged: charged,
    via: args.via,
  });
  return { ok, charged, balance: balance - charged, required: credits };
}

/** 预估一次调用大概要多少点，用于余额不足的前置提示 */
export function estimateCredits(approxTokens: number) {
  return Math.ceil(approxTokens * MARKUP);
}
