import { useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import type { RedSegment } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "@/components/chrome";
import { Highlighter, Save, Trash2, Eye, PencilLine, Info } from "lucide-react";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** 判断 CSS color 是否为红色系 */
function isReddish(color: string): boolean {
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

/** 解析粘贴的 HTML，提取红色文字区间为红标段 */
function parsePastedHtml(html: string): { text: string; segments: RedSegment[] } | null {
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
  return { text, segments: valid };
}

export function SampleEditor({
  projectId,
  initial,
  onSaved,
}: {
  projectId: number;
  initial: { content: string; redSegments: RedSegment[] } | null;
  onSaved: () => void;
}) {
  const [content, setContent] = useState(initial?.content ?? "");
  const [segments, setSegments] = useState<RedSegment[]>(initial?.redSegments ?? []);
  const [mode, setMode] = useState<"edit" | "preview">(initial ? "preview" : "edit");
  const [editedAfterMark, setEditedAfterMark] = useState(false);
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const saveMut = trpc.pipeline.saveSample.useMutation({
    onSuccess: () => {
      setEditedAfterMark(false);
      onSaved();
    },
  });

  const dirty =
    content !== (initial?.content ?? "") ||
    JSON.stringify(segments) !== JSON.stringify(initial?.redSegments ?? []);

  const markSelection = () => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    if (e - s < 2) return;
    // 与已有区间重叠的不再添加
    const overlap = segments.some((g) => s < g.end && e > g.start);
    if (overlap) return;
    setSegments((prev) => [...prev, { id: uid(), start: s, end: e }].sort((a, b) => a.start - b.start));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData("text/html");
    if (!html) return;
    const parsed = parsePastedHtml(html);
    if (!parsed) return;
    e.preventDefault();
    setContent(parsed.text);
    setSegments(parsed.segments.sort((a, b) => a.start - b.start));
    setEditedAfterMark(false);
    setPasteMsg(`已自动识别 ${parsed.segments.length} 段红色标注素材`);
  };

  const handleContentChange = (v: string) => {
    setContent(v);
    if (segments.length) setEditedAfterMark(true);
    setSegments((prev) => prev.filter((s) => s.end <= v.length));
  };

  const previewParts = useMemo(() => {
    if (mode !== "preview") return null;
    const sorted = [...segments]
      .filter((s) => s.end > s.start && s.end <= content.length)
      .sort((a, b) => a.start - b.start);
    const parts: { key: string; text: string; red: boolean }[] = [];
    let cur = 0;
    for (const s of sorted) {
      if (s.start > cur) parts.push({ key: `t${cur}`, text: content.slice(cur, s.start), red: false });
      parts.push({ key: s.id, text: content.slice(s.start, s.end), red: true });
      cur = s.end;
    }
    if (cur < content.length) parts.push({ key: "tail", text: content.slice(cur), red: false });
    return parts;
  }, [mode, content, segments]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border border-border bg-secondary/50 px-3 py-2.5">
        <Info className="h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          粘贴爆款原剧本（从 Word / 文档粘贴时，<span className="text-destructive">红色字体</span>会被自动识别为红标段）；
          或用鼠标选中文字后点击「标为爆款素材段」。<span className="text-foreground/80">建议先贴完原文再标红，标红后避免改动原文。</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex border border-border">
          <button
            onClick={() => setMode("edit")}
            className={`flex h-11 items-center gap-1.5 px-3.5 text-xs transition-colors ${
              mode === "edit" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-secondary"
            }`}
          >
            <PencilLine className="h-3.5 w-3.5" /> 编辑
          </button>
          <button
            onClick={() => setMode("preview")}
            className={`flex h-11 items-center gap-1.5 px-3.5 text-xs transition-colors ${
              mode === "preview" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-secondary"
            }`}
          >
            <Eye className="h-3.5 w-3.5" /> 红标预览
          </button>
        </div>
        {mode === "edit" && (
          <Button variant="outline" size="sm" onClick={markSelection} className="h-11 gap-1.5 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive">
            <Highlighter className="h-3.5 w-3.5" />
            标为爆款素材段
          </Button>
        )}
        <div className="flex-1" />
        <span className="mono-label text-[10px]">
          {content.length.toLocaleString()} 字 · 红标 {segments.length} 段
        </span>
        <Button
          size="sm"
          onClick={() => saveMut.mutate({ projectId, content, redSegments: segments })}
          disabled={!dirty || content.trim().length < 10 || saveMut.isPending}
          className="h-11 gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {saveMut.isPending ? "保存中…" : "保存样本"}
        </Button>
      </div>

      {pasteMsg && (
        <p className="border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">{pasteMsg}</p>
      )}
      {editedAfterMark && (
        <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          你在标红后修改了原文，标记位置可能偏移 —— 建议在预览中核对，必要时清空后重新标红。
        </p>
      )}
      {saveMut.error && <ErrorBox message={saveMut.error.message} />}

      {mode === "edit" ? (
        <textarea
          ref={taRef}
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          onPaste={handlePaste}
          placeholder="在这里粘贴爆款短剧的原剧本或剧情文本…&#10;&#10;第1集&#10;场景：豪宅客厅 — 夜&#10;林晚：（摔碎酒杯）你骗了我三年！&#10;……"
          className="font-script min-h-[420px] w-full resize-y border border-border bg-card/70 p-4 text-[15px] leading-7 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
        />
      ) : (
        <div className="font-script min-h-[420px] whitespace-pre-wrap border border-border bg-card/70 p-4 text-[15px] leading-7">
          {previewParts?.length ? (
            previewParts.map((p) =>
              p.red ? (
                <mark key={p.key} className="redmark">{p.text}</mark>
              ) : (
                <span key={p.key}>{p.text}</span>
              ),
            )
          ) : (
            <span className="text-muted-foreground/60">暂无内容</span>
          )}
        </div>
      )}

      {segments.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="mono-label">Marked Segments · 红标段清单</p>
            <button
              onClick={() => setSegments([])}
              className="mono-label text-[10px] text-muted-foreground hover:text-destructive transition-colors"
            >
              清空全部
            </button>
          </div>
          <div className="grid gap-1.5">
            {segments.map((s, i) => (
              <div key={s.id} className="flex min-w-0 items-start gap-3 border border-border bg-card/60 px-3 py-2">
                <span className="mono-label mt-0.5 shrink-0 text-[10px] text-destructive">R{String(i + 1).padStart(2, "0")}</span>
                <p className="min-w-0 flex-1 truncate text-xs text-foreground/80">
                  {content.slice(s.start, s.end).replace(/\n/g, " ⏎ ") || "（区间失效）"}
                </p>
                <button
                  onClick={() => setSegments((prev) => prev.filter((g) => g.id !== s.id))}
                  aria-label={`删除红标段 R${i + 1}`}
                  className="shrink-0 p-1 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
