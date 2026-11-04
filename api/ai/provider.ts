// AI provider —— 网关凭证仅服务端使用，模型 id 运行时从 listModels() 读取
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent, fetch as undiciFetch } from "undici";
import { listModels } from "./client";

// 结构化大输出（方向卡+人物小传/整套剧本）非流式返回，网关在生成完成前不发响应头。
// Node 默认 headersTimeout 300s，大任务会被误判超时（Headers Timeout Error），这里放宽到 15 分钟。
const longRunningAgent = new Agent({
  headersTimeout: 15 * 60_000,
  bodyTimeout: 15 * 60_000,
  connectTimeout: 30_000,
});

export const kimiGw = createOpenAICompatible({
  name: "kimi-gw",
  baseURL: process.env.KIMI_AGENTGW_BASE_URL!,
  apiKey: process.env.KIMI_AGENTGW_API_KEY!,
  includeUsage: true,
  supportsStructuredOutputs: true,
  fetch: ((url: string, init?: RequestInit) =>
    undiciFetch(url, { ...init, dispatcher: longRunningAgent } as never)) as unknown as typeof fetch,
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
