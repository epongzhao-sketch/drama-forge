// 剧本文件上传 —— PDF 在此解析（multipart 大文件走 REST 而非 tRPC）
// docx/txt/md 仍在浏览器端解析（src/lib/parseScriptFile.ts），不经由此路由
import { Hono } from "hono";
import { authenticateRequest } from "../kimi/auth";
import { extractPdfScript } from "../ai/pdf";

const MAX_PDF_BYTES = 30 * 1024 * 1024;

export const uploadRoutes = new Hono();

uploadRoutes.post("/script", async (c) => {
  let user;
  try {
    user = await authenticateRequest(c.req.raw.headers);
  } catch {
    return c.json({ error: "请先登录" }, 401);
  }
  void user;

  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return c.json({ error: "请求格式错误（需要 multipart/form-data）" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "缺少文件字段 file" }, 400);
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return c.json({ error: "此接口仅接受 .pdf 文件（docx/txt 请直接在前端导入）" }, 400);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_PDF_BYTES) {
    return c.json({ error: "PDF 超过 30MB 上限 —— 建议拆分成单集文件再上传" }, 413);
  }
  try {
    const result = await extractPdfScript(buf);
    return c.json({
      text: result.text,
      via: result.via,
      layoutMatters: result.layoutMatters,
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "PDF 解析失败" },
      422,
    );
  }
});
