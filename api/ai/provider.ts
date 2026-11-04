// AI provider —— 网关凭证仅服务端使用，模型 id 运行时从 listModels() 读取
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamObject } from "ai";
import { z } from "zod";
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

/**
 * 流式生成结构化对象：替代 generateObject 的非流式 HTTP 请求。
 * 网关侧大输出动辄 5-15 分钟，非流式请求在生成完成前零字节——代理/LB 很容易按闲置连接掐断
 * （实测非流式大任务在 ~10 分钟处稳定失败，流式则一直活到 15+ 分钟并成功返回）。
 * streamObject 与 generateObject 共用同一套 schema 校验/修复/重试逻辑。
 */
export async function generateObjectStreamed<T>(opts: {
  model: Awaited<ReturnType<typeof getModel>>;
  schema: z.ZodType<T>;
  prompt: string;
  maxRetries?: number;
}): Promise<{ object: T }> {
  const t0 = Date.now();
  const stream = streamObject({
    model: opts.model as never,
    schema: opts.schema as never,
    prompt: opts.prompt,
    maxRetries: opts.maxRetries,
  } as never);
  const s = stream as unknown as {
    object: Promise<T>;
    partialObjectStream: AsyncIterable<unknown>;
  };
  // 显式消费部分对象流：只为诊断 + 保持流活跃（首块时间能区分「模型在想」还是「连接挂了」）
  let firstChunkAt = 0;
  let chunks = 0;
  const tapper = (async () => {
    try {
      for await (const _ of s.partialObjectStream) {
        chunks++;
        if (!firstChunkAt) {
          firstChunkAt = Date.now();
          console.log(`[ai] first chunk ${(firstChunkAt - t0) / 1000}s (prompt ${opts.prompt.length} chars)`);
        }
      }
    } catch {
      // object promise 会带着真正的错误 reject，这里静默
    }
  })();
  try {
    const object = await s.object;
    await tapper;
    console.log(`[ai] object done ${(Date.now() - t0) / 1000}s, chunks=${chunks}`);
    return { object };
  } catch (err) {
    await tapper.catch(() => {});
    console.error(`[ai] object FAILED after ${(Date.now() - t0) / 1000}s, chunks=${chunks}:`, (err as Error)?.message);
    throw err;
  }
}

let cachedModelId: string | undefined;

/** 读取站点默认模型（不硬编码），进程内缓存 */
export async function getModel() {
  if (!cachedModelId) {
    const { defaultModelId } = await listModels();
    cachedModelId = defaultModelId;
  }
  return kimiGw(cachedModelId);
}
