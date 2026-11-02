// PDF 剧本解析 —— 纯文字 PDF 走文本层提取；扫描件/含图 PDF 逐页渲染成图，走 Claude 视觉转写
// 网关凭证仅服务端使用，模型 id 运行时从网关读取（kimi-* → claude-*），不硬编码
// 注意：pdf-parse 是纯 ESM 包，只能动态 import（静态 import 会被 esbuild CJS interop 打成 require 而崩）
import Anthropic from "@anthropic-ai/sdk";

export interface PdfExtraction {
  text: string;
  /** 是否有值得保留的版面（剧本结构）——决定是否存原始文件 */
  layoutMatters: boolean;
  /** 走的路径：text = 纯文本层；vision = Claude 视觉转写 */
  via: "text" | "vision";
  /** 视觉转写消耗的 token（计费用） */
  usage?: { input: number; output: number };
}

const MIN_TEXT_CHARS = 120; // 文本层少于此字符数 → 判定为扫描件（一集短剧剧本都可能只有百来字）
const VISION_MAX_BYTES = 30 * 1024 * 1024;
const VISION_MAX_PAGES = 20; // 超出说明是全剧长文档，建议拆分单集
const VISION_PROMPT = `这是一份短剧剧本文档的页面。请把页面内容完整转写为纯文本，要求：
- 按顺序转写全部文字，不要总结、不要省略、不要评论
- 保留剧本结构：集号（第X集/EP X）、场景头（场景/地点/时间）、角色名与台词分行、动作描述
- 台词保持「角色名：台词」的格式；动作/镜头描述用（）包裹
- 页眉页脚、页码、水印忽略
- 直接输出转写文本，不要加任何前后缀说明`;

function looksLikeScript(text: string): boolean {
  const head = text.slice(0, 4000);
  const sceneLike = (head.match(/第\s*\d+\s*集|EP\.?\s*\d+|场景|内景|外景|INT\.|EXT\./gi) ?? []).length;
  const dialogueLike = (head.match(/[：:]/g) ?? []).length;
  return sceneLike >= 2 || (sceneLike >= 1 && dialogueLike >= 5);
}

interface PdfDoc {
  text: string;
  pageImages: string[]; // base64 png，仅扫描路径用
}

/** 文本层 + 页面截图（一次解析，两个结果都拿到） */
async function parsePdf(buf: Buffer): Promise<PdfDoc> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const textRes = await parser.getText();
    const text = (textRes.text ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    let pageImages: string[] = [];
    if (text.length < MIN_TEXT_CHARS) {
      const shot = await parser.getScreenshot({ scale: 1.6 });
      pageImages = (shot.pages ?? [])
        .map((p) => (p.dataUrl ?? "").replace(/^data:image\/png;base64,/, ""))
        .filter(Boolean);
    }
    return { text, pageImages };
  } finally {
    await parser.destroy().catch(() => undefined); // pdfjs worker 报错无碍结果
  }
}

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

async function visionTranscribePages(
  pageImages: string[],
): Promise<{ text: string; usage: { input: number; output: number } }> {
  const anthropic = getAnthropic();
  const model = await resolveModelId();
  const chunks: string[] = [];
  let input = 0;
  let output = 0;
  // 每 4 页一批，控制单请求体积与输出长度
  for (let i = 0; i < pageImages.length; i += 4) {
    const batch = pageImages.slice(i, i + 4);
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

/**
 * 解析上传的 PDF 剧本：
 * 1. 先抽文本层——够长就直接用（快、免费）
 * 2. 文本层几乎没有（扫描件/图片型）→ 逐页渲染成图，Claude 视觉转写（计费，走平台网关）
 */
export async function extractPdfScript(buf: Buffer): Promise<PdfExtraction> {
  if (buf.length > VISION_MAX_BYTES) {
    throw new Error("这份 PDF 超过 30MB，超出识别上限 —— 建议拆分成单集文件再上传");
  }
  let doc: PdfDoc;
  try {
    doc = await parsePdf(buf);
  } catch (err) {
    throw new Error(`PDF 解析失败：${err instanceof Error ? err.message.slice(0, 120) : "文件损坏"}`);
  }
  if (doc.text.length >= MIN_TEXT_CHARS) {
    return { text: doc.text, layoutMatters: looksLikeScript(doc.text), via: "text" };
  }
  // 扫描件路径
  if (doc.pageImages.length === 0) {
    throw new Error("这份 PDF 既没有文字层也渲染不出页面 —— 文件可能损坏");
  }
  if (doc.pageImages.length > VISION_MAX_PAGES) {
    throw new Error(`这份扫描 PDF 共 ${doc.pageImages.length} 页，超过 ${VISION_MAX_PAGES} 页上限 —— 建议拆分成单集文件再上传`);
  }
  const t0 = Date.now();
  const { text, usage } = await visionTranscribePages(doc.pageImages);
  console.log(
    `[pdf-vision] ${doc.pageImages.length} pages, ${text.length} chars in ${((Date.now() - t0) / 1000).toFixed(1)}s, tokens in=${usage.input} out=${usage.output}`,
  );
  return { text, layoutMatters: true, via: "vision", usage };
}
