// 浏览器端 PDF 处理：文本层抽取 + 扫描件逐页渲染成 PNG
// 服务端部署包不含 node_modules（无法跑 pdfjs 依赖的原生 canvas），
// 而浏览器天然具备全部渲染能力 —— 所以 PDF 解析放在这里，服务端只负责视觉转写。
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** 文本层少于此字符数 → 判定为扫描件，走视觉识别 */
export const MIN_TEXT_CHARS = 120;
export const VISION_MAX_PAGES = 20;
/** 渲染页图总体积上限（base64 前），与代理/网关的请求体限制对齐 */
const MAX_RENDER_BYTES = 24 * 1024 * 1024;

type Pdfjs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<Pdfjs> | undefined;

/** 懒加载 pdfjs（~1MB，只在用户真的上传 PDF 时才拉取）。worker URL 在模块顶层静态解析，确保拿到真实路径字符串 */
function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl;
      return lib;
    });
  }
  return pdfjsPromise;
}

async function openDoc(buf: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`PDF 打开失败（${msg.slice(0, 80)}）—— 文件可能损坏或已加密`);
  }
}

/** 抽取文本层：按行重组（pdfjs 的 hasEOL 标记比坐标拼接更可靠） */
export async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  const doc = await openDoc(buf);
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let t = "";
      for (const item of tc.items) {
        if (!("str" in item)) continue;
        t += item.str;
        if (item.hasEOL) t += "\n";
      }
      pages.push(t.trim());
    }
    return pages
      .filter(Boolean)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } finally {
    await doc.destroy();
  }
}

/** 逐页渲染为 PNG base64（无 data: 前缀），供服务端视觉识别 */
export async function renderPdfPageImages(buf: ArrayBuffer): Promise<string[]> {
  const doc = await openDoc(buf);
  try {
    if (doc.numPages > VISION_MAX_PAGES) {
      throw new Error(
        `这份扫描 PDF 共 ${doc.numPages} 页，超过 ${VISION_MAX_PAGES} 页上限 —— 建议拆分成单集文件再上传`,
      );
    }
    const images: string[] = [];
    let total = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("浏览器不支持 canvas 渲染，请更换浏览器");
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/png");
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      total += (b64.length * 3) / 4;
      if (total > MAX_RENDER_BYTES) {
        throw new Error("页面图像体积超出上传上限 —— 建议拆分成单集文件再上传");
      }
      images.push(b64);
      canvas.width = 0; // 释放显存
      canvas.height = 0;
    }
    return images;
  } finally {
    await doc.destroy();
  }
}
