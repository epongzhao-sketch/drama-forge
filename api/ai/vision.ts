// 扫描件页图的视觉转写 —— 网关凭证仅服务端使用，模型 id 运行时从网关读取（kimi-* → claude-*），不硬编码
// PDF 文本层抽取与页面渲染都在浏览器端完成（部署包无 node_modules，跑不了原生 canvas），
// 这里只接收渲染好的 PNG 页图，调 Claude 视觉转写。
import Anthropic from "@anthropic-ai/sdk";

/** 分阶段进度回调（用于上传接口的流式心跳，防止长任务被代理超时掐断） */
export type VisionProgressFn = (stage: "vision", detail: string) => void;

const VISION_PROMPT = `这是一份短剧剧本文档的页面。请把页面内容完整转写为纯文本，要求：
- 按顺序转写全部文字，不要总结、不要省略、不要评论
- 保留剧本结构：集号（第X集/EP X）、场景头（场景/地点/时间）、角色名与台词分行、动作描述
- 台词保持「角色名：台词」的格式；动作/镜头描述用（）包裹
- 页眉页脚、页码、水印忽略
- 直接输出转写文本，不要加任何前后缀说明`;

/** kimi 模型 id → 同名 claude 模型 id；取不到就用 haiku（最便宜的视觉档） */
function toClaudeModelId(kimiId: string | undefined): string {
  const id = (kimiId ?? "").toLowerCase();
  if (id.includes("opus")) return "claude-opus-4-5";
  if (id.includes("sonnet")) return "claude-sonnet-4-5";
  if (id.includes("haiku")) return "claude-haiku-4-5";
  return "claude-haiku-4-5";
}

let anthropicClient: Anthropic | undefined;
function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    // 网关 baseURL 自带 /coding/v1 后缀，而 Anthropic SDK 会再拼 /v1/messages → 必须先剥掉 /v1，
    // 否则打到 /coding/v1/v1/messages 拿到 404。鉴权：x-api-key（SDK 默认）+ Bearer 显式并带。
    const base = (process.env.KIMI_AGENTGW_BASE_URL ?? "").replace(/\/v1\/?$/, "");
    anthropicClient = new Anthropic({
      baseURL: base,
      apiKey: process.env.KIMI_AGENTGW_API_KEY,
      maxRetries: 0,
      defaultHeaders: { Authorization: `Bearer ${process.env.KIMI_AGENTGW_API_KEY}` },
    });
  }
  return anthropicClient;
}

async function resolveModelId(): Promise<string> {
  const { listModels } = await import("./client");
  const { defaultModelId } = await listModels().catch(() => ({ defaultModelId: undefined as string | undefined }));
  return toClaudeModelId(defaultModelId);
}

/** 逐批视觉转写页面图像（PNG base64），每 4 页一批控制单请求体积与输出长度 */
export async function visionTranscribePages(
  pageImages: string[],
  onProgress?: VisionProgressFn,
): Promise<{ text: string; usage: { input: number; output: number } }> {
  const anthropic = getAnthropic();
  const model = await resolveModelId();
  const chunks: string[] = [];
  let input = 0;
  let output = 0;
  for (let i = 0; i < pageImages.length; i += 4) {
    const batch = pageImages.slice(i, i + 4);
    onProgress?.("vision", `正在识别第 ${i + 1}-${Math.min(i + 4, pageImages.length)} 页 / 共 ${pageImages.length} 页…`);
    const res = await anthropic.messages.create({
      model,
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [
            ...batch.map(
              (data): Anthropic.ImageBlockParam => ({
                type: "image",
                source: { type: "base64", media_type: "image/png", data },
              }),
            ),
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
    });
    const t = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    chunks.push(t);
    input += res.usage.input_tokens;
    output += res.usage.output_tokens;
  }
  const text = chunks.filter(Boolean).join("\n\n");
  if (!text) {
    throw new Error("视觉转写没有返回文字 —— 这份 PDF 可能无法识别，建议改用 Word 标红后导出 .docx 上传");
  }
  return { text, usage: { input, output } };
}
