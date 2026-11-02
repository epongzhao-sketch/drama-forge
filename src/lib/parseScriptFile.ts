import JSZip from "jszip";
import type { RedSegment } from "@contracts/pipeline";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** 判断 CSS color / docx 色值是否为红色系 */
export function isReddish(color: string): boolean {
  const c = color.replace(/\s+/g, "").toLowerCase();
  if (["red", "#f00", "#ff0000", "crimson", "#dc143c"].includes(c)) return true;
  const rgb = c.match(/rgba?\((\d+),(\d+),(\d+)/);
  if (rgb) {
    const [, r, g, b] = rgb.map(Number);
    return r > 140 && g < 110 && b < 110 && r > g * 1.5;
  }
  const hex = c.match(/^#([0-9a-f]{6})$/);
  if (hex) {
    const v = parseInt(hex[1], 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    return r > 140 && g < 110 && b < 110 && r > g * 1.5;
  }
  return false;
}

export interface ParsedScript {
  text: string;
  segments: RedSegment[];
}

/** 合并相邻（首尾相接）的红标段，减少清单噪音 */
function mergeAdjacent(segments: RedSegment[]): RedSegment[] {
  const out: RedSegment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.end === s.start) last.end = s.end;
    else out.push({ ...s });
  }
  return out;
}

/** 解析粘贴的 HTML（来自 Word / 网页剪贴板），提取红色文字区间为红标段 */
export function parsePastedHtml(html: string): ParsedScript | null {
  if (!/color\s*:|style=/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let text = "";
  const segments: RedSegment[] = [];

  const walk = (node: Node, red: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      if (red && t.trim()) {
        segments.push({ id: uid(), start: text.length, end: text.length + t.length });
      }
      text += t;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      text += "\n";
      return;
    }
    const color = node.style?.color ?? "";
    const isRed = red || (color ? isReddish(color) : false);
    const blockBefore = ["p", "div", "li", "tr", "h1", "h2", "h3"].includes(tag) && text && !text.endsWith("\n");
    if (blockBefore) text += "\n";
    node.childNodes.forEach((ch) => walk(ch, isRed));
    if (["p", "div", "li", "tr", "h1", "h2", "h3"].includes(tag)) text += "\n";
  };
  doc.body.childNodes.forEach((n) => walk(n, false));
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  const valid = segments.filter((s) => s.end > s.start && s.end <= text.length);
  if (!text || valid.length === 0) return null;
  return { text, segments: mergeAdjacent(valid) };
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** 读取 run 的字体颜色（直接格式化），返回 #rrggbb 或 null */
function runColor(rPr: Element | null): string | null {
  if (!rPr) return null;
  for (const el of Array.from(rPr.getElementsByTagNameNS(W_NS, "color"))) {
    const val = el.getAttribute("w:val") ?? el.getAttribute("val");
    if (val && /^[0-9a-fA-F]{6}$/.test(val)) return `#${val.toLowerCase()}`;
  }
  return null;
}

/** run 是否被标红高亮（w:highlight val="red"） */
function runRedHighlight(rPr: Element | null): boolean {
  if (!rPr) return false;
  for (const el of Array.from(rPr.getElementsByTagNameNS(W_NS, "highlight"))) {
    const val = (el.getAttribute("w:val") ?? el.getAttribute("val") ?? "").toLowerCase();
    if (val === "red" || val === "darkred") return true;
  }
  return false;
}

/** 解析 .docx：提取纯文本 + 红色字体/红色高亮区间 */
export async function parseDocx(buf: ArrayBuffer): Promise<ParsedScript> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("这不是有效的 .docx 文件（缺少 word/document.xml）");
  const xml = await file.async("string");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error(".docx 内容解析失败");

  let text = "";
  const segments: RedSegment[] = [];

  const walkRun = (r: Element) => {
    const rPrList = r.getElementsByTagNameNS(W_NS, "rPr");
    // rPr 必须是 run 的直接属性（getElementsByTagNameNS 会深入子树，但 run 内没有嵌套 run）
    const rPr = rPrList.length ? rPrList[0] : null;
    const color = runColor(rPr);
    const red = (color ? isReddish(color) : false) || runRedHighlight(rPr);
    let runText = "";
    for (const child of Array.from(r.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      if (el.localName === "t" || el.localName === "delText" || el.localName === "instrText") {
        runText += el.textContent ?? "";
      } else if (el.localName === "tab") {
        runText += "\t";
      } else if (el.localName === "br" || el.localName === "cr") {
        runText += "\n";
      }
    }
    if (red && runText.trim()) {
      segments.push({ id: uid(), start: text.length, end: text.length + runText.length });
    }
    text += runText;
  };

  const walkContainer = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      if (el.localName === "r") walkRun(el);
      else if (el.localName === "hyperlink" || el.localName === "smartTag" || el.localName === "ins") {
        walkContainer(el);
      }
    }
  };

  const body = doc.getElementsByTagNameNS(W_NS, "body")[0];
  if (!body) throw new Error(".docx 正文为空");
  const walkBlock = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      if (el.localName === "p") {
        walkContainer(el);
        text += "\n";
      } else if (el.localName === "tbl") {
        // 表格：逐行提取
        for (const p of Array.from(el.getElementsByTagNameNS(W_NS, "p"))) {
          walkContainer(p);
          text += "\n";
        }
      }
    }
  };
  walkBlock(body);

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("文件里没有可提取的文字");
  const valid = mergeAdjacent(segments.filter((s) => s.end > s.start && s.end <= text.length));
  return { text, segments: valid };
}

/** 按文件类型解析上传的剧本文件（PDF 走服务端 /api/upload/script；onProgress 接收识别进度文案） */
export async function parseScriptFile(
  file: File,
  onProgress?: (detail: string) => void,
): Promise<ParsedScript & { hasRed: boolean }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) {
    const parsed = await parseDocx(await file.arrayBuffer());
    return { ...parsed, hasRed: parsed.segments.length > 0 };
  }
  if (name.endsWith(".doc")) {
    throw new Error("暂不支持旧版 .doc 格式 —— 请在 Word / WPS 里另存为 .docx 后再上传");
  }
  if (name.endsWith(".pdf")) {
    if (file.size > 30 * 1024 * 1024) {
      throw new Error("PDF 超过 30MB 上限 —— 建议拆分成单集文件再上传");
    }
    const form = new FormData();
    form.append("file", file);
    // 响应是 NDJSON 心跳流：逐行读，最后一条 done 才是结果；流中断才报网络错误
    let res: Response;
    try {
      res = await fetch("/api/upload/script", { method: "POST", body: form });
    } catch {
      throw new Error("网络连接中断 —— 请检查网络后重试（大文件上传建议稳定网络）");
    }
    if (!res.ok || !res.body) {
      let msg = `PDF 解析失败（HTTP ${res.status}）`;
      try {
        const d = (await res.json()) as { error?: string };
        if (d.error) msg = d.error;
      } catch {
        /* 非 JSON 错误页，用默认文案 */
      }
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final: { text?: string; via?: string; error?: string } | null = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line) as { done?: boolean; text?: string; via?: string; error?: string; detail?: string };
            if (obj.detail) onProgress?.(obj.detail);
            if (obj.done) final = obj;
          } catch {
            /* 半行/心跳噪音，忽略 */
          }
        }
      }
    } catch {
      throw new Error("识别过程中连接中断 —— 请重试（扫描件识别较久，建议网络稳定时操作）");
    }
    if (!final) throw new Error("服务器没有返回结果，请重试");
    if (final.error || !final.text) throw new Error(final.error ?? "PDF 解析失败");
    return { text: final.text, segments: [], hasRed: false };
  }
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    const text = (await file.text()).replace(/\r\n?/g, "\n").trim();
    if (!text) throw new Error("文件里没有文字内容");
    return { text, segments: [], hasRed: false };
  }
  throw new Error("支持 .docx / .pdf / .txt / .md 文件");
}