// AI provider —— 模型调用支持双通道：用户自带 Key（BYOK，直连开放平台）或站点网关（代购）
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamObject } from "ai";
import { z } from "zod";
import { Agent, fetch as undiciFetch } from "undici";
import { listModels } from "./client";
import { getUserApiKey, chargeUsage } from "./wallet";

// 结构化大输出（方向卡+人物小传/整套剧本）非流式返回，网关在生成完成前不发响应头。
// Node 默认 headersTimeout 300s，大任务会被误判超时（Headers Timeout Error），这里放宽到 15 分钟。
const longRunningAgent = new Agent({
  headersTimeout: 15 * 60_000,
  bodyTimeout: 15 * 60_000,
  connectTimeout: 30_000,
});

const longFetch = ((url: string, init?: RequestInit) =>
  undiciFetch(url, { ...init, dispatcher: longRunningAgent } as never)) as unknown as typeof fetch;

/** 站点网关（代购通道，凭证仅服务端使用） */
export const kimiGw = createOpenAICompatible({
  name: "kimi-gw",
  baseURL: process.env.KIMI_AGENTGW_BASE_URL!,
  apiKey: process.env.KIMI_AGENTGW_API_KEY!,
  includeUsage: true,
  supportsStructuredOutputs: true,
  fetch: longFetch,
});

/** 计费上下文：决定本次调用走谁的 Key、记到谁的账上 */
export interface BillingCtx {
  userId: number;
  projectId?: number;
  action: string;
}

/** BYOK 直连开放平台的 provider 缓存（按 apiKey 区分，进程内复用） */
const byokProviders = new Map<string, ReturnType<typeof createOpenAICompatible>>();
function byokProvider(apiKey: string) {
  let p = byokProviders.get(apiKey);
  if (!p) {
    p = createOpenAICompatible({
      name: "kimi-byok",
      baseURL: "https://api.moonshot.cn/v1",
      apiKey,
      includeUsage: true,
      supportsStructuredOutputs: true,
      fetch: longFetch,
    });
    byokProviders.set(apiKey, p);
  }
  return p;
}

let cachedModelId: string | undefined;

/** 站点默认模型 id（不硬编码），进程内缓存 */
export async function getModelId(): Promise<string> {
  if (!cachedModelId) {
    const { defaultModelId } = await listModels();
    cachedModelId = defaultModelId;
  }
  return cachedModelId;
}

/** 站点网关模型（代购通道） */
export async function getModel() {
  return kimiGw(await getModelId());
}

/**
 * 解析本次调用该用哪个模型实例：
 * - 用户绑了自己的开放平台 Key → BYOK 直连（模型费从他余额扣），via="byok"
 * - 否则 → 站点网关代购，via="site"
 */
export async function resolveModel(billing?: BillingCtx): Promise<{
  model: ReturnType<typeof kimiGw>;
  via: "byok" | "site";
  modelId: string;
}> {
  const modelId = await getModelId();
  if (billing) {
    const userKey = await getUserApiKey(billing.userId);
    if (userKey) {
      return { model: byokProvider(userKey)(modelId) as never, via: "byok", modelId };
    }
  }
  return { model: kimiGw(modelId) as never, via: "site", modelId };
}

/**
 * 流式生成结构化对象：替代 generateObject 的非流式 HTTP 请求。
 * 网关侧大输出动辄 5-15 分钟，非流式请求在生成完成前零字节——代理/LB 很容易按闲置连接掐断
 * （实测非流式大任务在 ~10 分钟处稳定失败，流式则一直活到 15+ 分钟并成功返回）。
 * streamObject 与 generateObject 共用同一套 schema 校验/修复/重试逻辑。
 */
export async function generateObjectStreamed<T>(opts: {
  model: ReturnType<typeof kimiGw>;
  schema: z.ZodType<T>;
  prompt: string;
  maxRetries?: number;
}): Promise<{ object: T; usage: { input: number; output: number } }> {
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
    usage: Promise<{ inputTokens?: number; outputTokens?: number }>;
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
    let usage = { input: 0, output: 0 };
    try {
      const u = await s.usage;
      usage = { input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0 };
    } catch {
      // usage 读取失败不阻塞主流程
    }
    console.log(
      `[ai] object done ${(Date.now() - t0) / 1000}s, chunks=${chunks}, tok in=${usage.input} out=${usage.output}`,
    );
    return { object, usage };
  } catch (err) {
    await tapper.catch(() => {});
    console.error(
      `[ai] object FAILED after ${(Date.now() - t0) / 1000}s, chunks=${chunks}:`,
      (err as Error)?.message,
    );
    throw err;
  }
}

/**
 * 带计费的结构化对象生成：解析该用谁的 Key → 流式生成 → 按真实 usage 记扣点数。
 * 余额不足时：调用照常完成（不阻断用户拿结果），但返回 billing.ok=false，
 * 由路由层决定是否在响应里提示充值（首单不拦，体验优先）。
 */
export async function generateObjectBilled<T>(opts: {
  billing: BillingCtx;
  schema: z.ZodType<T>;
  prompt: string;
  maxRetries?: number;
}) {
  const { model, via, modelId } = await resolveModel(opts.billing);
  const { object, usage } = await generateObjectStreamed({
    model,
    schema: opts.schema,
    prompt: opts.prompt,
    maxRetries: opts.maxRetries,
  });
  const billing = await chargeUsage({
    userId: opts.billing.userId,
    projectId: opts.billing.projectId,
    action: opts.billing.action,
    model: modelId,
    inputTokens: usage.input,
    outputTokens: usage.output,
    via,
  });
  return { object, usage, via, billing };
}
