// AI 服务商管理：浏览器可查看已配置的服务商列表并选择使用哪一个（密钥永不下发）
import { createRouter, authedQuery } from "../middleware";
import { publicProviderInfo } from "../ai/provider";

export const aiRouter = createRouter({
  /** 已配置的服务商清单（id/名称/默认模型，不含密钥） */
  providers: authedQuery.query(() => publicProviderInfo()),
});
