// AI provider —— 多服务商注册表：凭证仅服务端使用，模型 id 运行时从各服务商 /models 读取
// 服务商来源：① KIMI_AGENTGW_BASE_URL/API_KEY（内置默认，兼容旧部署）② AI_PROVIDERS 环境变量（JSON 数组）
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamObject } from "ai";
import { z } from "zod";
import { Agent, fetch as undiciFetch } from "undici";
import { listModelsFor, AiMisconfigured } from "./client";

// 结构化大输出（方向卡+人物小传/整套剧本）非流式返回，网关在生成完成前不发响应头。
// Node 默认 headersTimeout 300s，大任务会被误判超时（Headers Timeout Error），这里放宽到 15 分钟。
const longRunningAgent = new Agent({
  headersTimeout: 15 * 60_000,
  bodyTimeout: 15 * 60_000,
  connectTimeout: 30_000,
});

const longFetch = ((url: string, init?: RequestInit) =>
  undiciFetch(url, { ...init, dispatcher: longRunningAgent } as never)) as unknown as typeof fetch;

// ---------- 多服务商配置 ----------

export interface AiProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  /** 显式指定的默认模型 id（第三方 /models 常无 default_model_id 字段，兜底取第一个往往不合适） */
  defaultModel?: string;
}

let cachedConfigs: AiProviderConfig[] | null = null;

/** 读取全部已配置服务商（进程内缓存；密钥只留在服务端，绝不下发浏览器） */
export function listProviderConfigs(): AiProviderConfig[] {
  if (cachedConfigs) return cachedConfigs;
  const configs: AiProviderConfig[] = [];
  if (process.env.KIMI_AGENTGW_BASE_URL && process.env.KIMI_AGENTGW_API_KEY) {
    configs.push({
      id: "default",
      name: process.env.AI_PROVIDER_DEFAULT_NAME || "默认网关",
      baseUrl: process.env.KIMI_AGENTGW_BASE_URL,
      apiKey: process.env.KIMI_AGENTGW_API_KEY,
      defaultModel: process.env.AI_PROVIDER_DEFAULT_MODEL || undefined,
    });
  }
  if (process.env.AI_PROVIDERS) {
    try {
      const extra = JSON.parse(process.env.AI_PROVIDERS) as Array<Record<string, unknown>>;
      for (const [i, p] of extra.entries()) {
        if (typeof p.baseUrl === "string" && p.baseUrl && typeof p.apiKey === "string" && p.apiKey) {
          configs.push({
            id: typeof p.id === "string" && p.id ? p.id : `extra-${i}`,
            name: typeof p.name === "string" && p.name ? p.name : `服务商 ${configs.length + 1}`,
            baseUrl: p.baseUrl,
            apiKey: p.apiKey,
            defaultModel: typeof p.defaultModel === "string" && p.defaultModel ? p.defaultModel : undefined,
          });
        }
      }
    } catch (err) {
      console.error("[ai] AI_PROVIDERS 解析失败（应为 JSON 数组）:", (err as Error).message);
    }
  }
  cachedConfigs = configs;
  return configs;
}

/** 解析服务商配置：传 id 选指定，否则取第一个已配置的 */
export function getProviderConfig(id?: string | null): AiProviderConfig {
  const configs = listProviderConfigs();
  const cfg = (id ? configs.find((c) => c.id === id) : undefined) ?? configs[0];
  if (!cfg) {
    throw new AiMisconfigured(
      "未配置任何 AI 服务商：请设置 KIMI_AGENTGW_BASE_URL/API_KEY 或 AI_PROVIDERS 环境变量。",
    );
  }
  return cfg;
}

/** 浏览器侧可见的服务商信息（不含密钥） */
export function publicProviderInfo() {
  return listProviderConfigs().map((c) => ({ id: c.id, name: c.name, defaultModel: c.defaultModel ?? null }));
}

// provider 实例缓存：按 baseUrl+key 区分，同一服务商复用
const providerCache = new Map<string, ReturnType<typeof createOpenAICompatible>>();
function providerFor(cfg: AiProviderConfig) {
  const key = `${cfg.baseUrl}|${cfg.apiKey}`;
  let p = providerCache.get(key);
  if (!p) {
    p = createOpenAICompatible({
      name: `ai-${cfg.id}`,
      baseURL: cfg.baseUrl,
      apiKey: cfg.apiKey,
      includeUsage: true,
      supportsStructuredOutputs: true,
      fetch: longFetch,
    });
    providerCache.set(key, p);
  }
  return p;
}

// 模型 id 缓存：按服务商 id 缓存解析结果
const modelIdCache = new Map<string, string>();

/** 读取指定服务商的默认模型（不硬编码）：显式 defaultModel > /models 的 default_model_id > 第一个模型 */
export async function getModel(providerId?: string | null) {
  const cfg = getProviderConfig(providerId);
  let id = modelIdCache.get(cfg.id);
  if (!id) {
    id = cfg.defaultModel || (await listModelsFor(cfg)).defaultModelId;
    modelIdCache.set(cfg.id, id);
  }
  return providerFor(cfg)(id);
}

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
