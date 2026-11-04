// 钱包与 BYOK 设置：绑/解绑开放平台 Key、查余额、充值、用量与流水
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { usageLogs, creditTransactions } from "@db/schema";
import {
  getUserKeyInfo,
  setUserApiKey,
  addCredits,
  RECHARGE_TIERS,
  MARKUP,
} from "../ai/wallet";

export const walletRouter = createRouter({
  /** 当前用户的钱包与 Key 状态 */
  status: authedQuery.query(async ({ ctx }) => {
    const info = await getUserKeyInfo(ctx.user.id);
    return {
      hasKey: info.hasKey,
      keyPreview: info.keyPreview,
      balance: info.balance,
      markup: MARKUP,
      serviceFeePct: Math.round((MARKUP - 1) * 100),
      rechargeTiers: RECHARGE_TIERS,
    };
  }),

  /** 绑定/更新自己的 Kimi 开放平台 API Key */
  setApiKey: authedQuery
    .input(z.object({ apiKey: z.string().trim().min(8).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const key = input.apiKey.trim();
      if (!/^sk-/i.test(key)) {
        throw new Error("Key 格式不正确——Kimi 开放平台 API Key 以 sk- 开头");
      }
      await setUserApiKey(ctx.user.id, key);
      return getUserKeyInfo(ctx.user.id);
    }),

  /** 解绑 Key（解绑后走站点代购通道，按点数计费） */
  clearApiKey: authedQuery.mutation(async ({ ctx }) => {
    await setUserApiKey(ctx.user.id, null);
    return getUserKeyInfo(ctx.user.id);
  }),

  /** 充值点数（当前为模拟入账；接真实支付后在这里落支付回调） */
  recharge: authedQuery
    .input(z.object({ tierCny: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const tier = RECHARGE_TIERS.find((t) => t.cny === input.tierCny);
      if (!tier) throw new Error("无效的充值档位");
      const balance = await addCredits(ctx.user.id, tier.credits, "recharge", `充值 ¥${tier.cny}`);
      return { balance, added: tier.credits };
    }),

  /** 最近用量记录 */
  usageLogs: authedQuery
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(usageLogs)
        .where(eq(usageLogs.userId, ctx.user.id))
        .orderBy(desc(usageLogs.id))
        .limit(input?.limit ?? 30);
      return rows;
    }),

  /** 最近钱包流水 */
  transactions: authedQuery
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(creditTransactions)
        .where(eq(creditTransactions.userId, ctx.user.id))
        .orderBy(desc(creditTransactions.id))
        .limit(input?.limit ?? 30);
      return rows;
    }),
});
