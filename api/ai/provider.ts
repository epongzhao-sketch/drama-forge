// AI provider —— 网关凭证仅服务端使用，模型 id 运行时从 listModels() 读取
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { listModels } from "./client";

export const kimiGw = createOpenAICompatible({
  name: "kimi-gw",
  baseURL: process.env.KIMI_AGENTGW_BASE_URL!,
  apiKey: process.env.KIMI_AGENTGW_API_KEY!,
  includeUsage: true,
  supportsStructuredOutputs: true,
});

let cachedModelId: string | undefined;

/** 读取站点默认模型（不硬编码），进程内缓存 */
export async function getModel() {
  if (!cachedModelId) {
    const { defaultModelId } = await listModels();
    cachedModelId = defaultModelId;
  }
  return kimiGw(cachedModelId);
}
