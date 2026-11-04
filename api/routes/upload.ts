// 扫描件页图上传 —— 浏览器把 PDF 页面渲染成 PNG 后传到这里做视觉转写
// （PDF 文本层抽取、docx/txt/md 解析都在浏览器端完成，不经由此路由；
//   部署包只有 dist/ 没有 node_modules，服务端跑不了 pdfjs 依赖的原生 canvas）
//
// 响应是 NDJSON 流：先不断下发 {"stage","detail"} 心跳，最后一条带 done:true（或 error）。
// 视觉识别可能跑 1-2 分钟——没有心跳的话，反向代理会在 ~60s 无字节时掐断连接，
// 浏览器端就只剩一句 "Failed to fetch"。
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { authenticateRequest } from "../kimi/auth";
import { visionTranscribePages } from "../ai/vision";
import { chargeUsage } from "../ai/wallet";

const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 28 * 1024 * 1024;
const HEARTBEAT_MS = 4000;

export const uploadRoutes = new Hono();

uploadRoutes.post("/vision", async (c) => {
  let user;
  try {
    user = await authenticateRequest(c.req.raw.headers);
  } catch {
    return c.json({ error: "请先登录" }, 401);
  }

  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return c.json({ error: "请求格式错误（需要 multipart/form-data）" }, 400);
  }
  const files = form.getAll("images").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return c.json({ error: "缺少页面图像字段 images" }, 400);
  }
  if (files.length > MAX_IMAGES) {
    return c.json({ error: `共 ${files.length} 页，超过 ${MAX_IMAGES} 页上限 —— 建议拆分成单集文件再上传` }, 413);
  }
  let total = 0;
  const images: string[] = [];
  for (const f of files) {
    total += f.size;
    if (f.size > MAX_IMAGE_BYTES || total > MAX_TOTAL_BYTES) {
      return c.json({ error: "页面图像体积超出上限 —— 建议拆分成单集文件再上传" }, 413);
    }
    const buf = Buffer.from(await f.arrayBuffer());
    images.push(buf.toString("base64"));
  }

  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  c.header("X-Accel-Buffering", "no"); // 关掉 nginx 类代理的响应缓冲，心跳直达浏览器

  return stream(c, async (s) => {
    let closed = false;
    const send = async (obj: Record<string, unknown>) => {
      if (closed) return;
      try {
        await s.write(JSON.stringify(obj) + "\n");
      } catch {
        closed = true; // 客户端已断开，后续写入静默丢弃
      }
    };
    // 兜底心跳：即使回调间隔长，也保证每 4s 至少一个字节
    let lastDetail = "正在准备…";
    const timer = setInterval(() => {
      void send({ stage: "working", detail: lastDetail });
    }, HEARTBEAT_MS);
    try {
      const t0 = Date.now();
      const result = await visionTranscribePages(images, (stage, detail) => {
        lastDetail = detail;
        void send({ stage, detail });
      });
      console.log(
        `[vision] ${images.length} pages, ${result.text.length} chars in ${((Date.now() - t0) / 1000).toFixed(1)}s, tokens in=${result.usage.input} out=${result.usage.output}`,
      );
      // 视觉转写计点（站点代购通道——视觉模型走 Anthropic 网关，无 BYOK）
      const billing = await chargeUsage({
        userId: user.id,
        action: "vision",
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        via: "site",
      });
      await send({ done: true, text: result.text, via: "vision", layoutMatters: true, creditsCharged: billing.charged });
    } catch (err) {
      await send({ done: true, error: err instanceof Error ? err.message : "视觉识别失败" });
    } finally {
      clearInterval(timer);
    }
  });
});
