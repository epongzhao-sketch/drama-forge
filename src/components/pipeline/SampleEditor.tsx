import { useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import type { RedSegment } from "@contracts/pipeline";
import { parsePastedHtml, parseScriptFile } from "@/lib/parseScriptFile";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "@/components/chrome";
import { Highlighter, Save, Trash2, Eye, PencilLine, Info, FileUp, Loader2 } from "lucide-react";

function uid() {
  return Math.random().toString(36).slice(2, 10);
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
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const importFile = async (file: File) => {
    if (content.trim() && !window.confirm(`导入「${file.name}」将替换当前样本内容和全部红标段，继续吗？`)) {
      return;
    }
    setImporting(true);
    setPasteMsg(null);
    try {
      const parsed = await parseScriptFile(file);
      setContent(parsed.text);
      setSegments(parsed.segments);
      setEditedAfterMark(false);
      setMode("edit");
      setPasteMsg(
        parsed.hasRed
          ? `已从「${file.name}」导入 ${parsed.text.length.toLocaleString()} 字，自动识别 ${parsed.segments.length} 段红色标注素材`
          : `已从「${file.name}」导入 ${parsed.text.length.toLocaleString()} 字（纯文本文件不含颜色信息，请手动标红）`,
      );
    } catch (err) {
      setPasteMsg(null);
      alert(err instanceof Error ? err.message : "文件解析失败");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void importFile(file);
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
          直接上传标好红的 <span className="text-foreground/80">.docx</span> 剧本文件（<span className="text-destructive">红色字体/红色高亮</span>自动识别为红标段），
          或粘贴文本后手动标红。<span className="text-foreground/80">建议先导入原文再标红，标红后避免改动原文。</span>
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
        <input
          ref={fileRef}
          type="file"
          accept=".docx,.txt,.md"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="h-11 gap-1.5"
        >
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
          {importing ? "解析中…" : "上传剧本文件"}
        </Button>
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

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`relative ${dragging ? "outline-dashed outline-2 -outline-offset-2 outline-primary" : ""}`}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80">
            <p className="flex items-center gap-2 border border-primary bg-card px-4 py-3 text-sm text-primary">
              <FileUp className="h-4 w-4" /> 松开导入 .docx / .txt / .md 剧本文件
            </p>
          </div>
        )}
        {mode === "edit" ? (
          <textarea
            ref={taRef}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onPaste={handlePaste}
            placeholder="在这里粘贴爆款短剧的原剧本或剧情文本，或点击上方「上传剧本文件」/ 把文件拖进来…&#10;&#10;第1集&#10;场景：豪宅客厅 — 夜&#10;林晚：（摔碎酒杯）你骗了我三年！&#10;……"
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
      </div>

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
