import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import type { EpisodeScript, OutlineEpisode } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import { ErrorBox, Generating } from "@/components/chrome";
import { Copy, Download, Film, Languages, Play, Check } from "lucide-react";

type ScriptRow = { epNo: number; contentZh: EpisodeScript | null; contentEn: EpisodeScript | null };

function formatScript(s: EpisodeScript, lang: "zh" | "en"): string {
  const lines: string[] = [];
  lines.push(lang === "zh" ? `第 ${s.epNo} 集《${s.title}》` : `EP${s.epNo} "${s.title}"`);
  lines.push("");
  for (const sc of s.scenes) {
    lines.push(`【${lang === "zh" ? "场景" : "SCENE"} ${sc.sceneNo}】${sc.location} — ${sc.time}`);
    for (const b of sc.beats) {
      if (b.type === "dialogue") lines.push(`${b.character ?? "?"}：${b.text}`);
      else lines.push(`（${b.text}）`);
    }
    lines.push("");
  }
  lines.push(`${lang === "zh" ? "【本集悬念】" : "[CLIFFHANGER]"}${s.cliffhanger}`);
  return lines.join("\n");
}

function ScriptDoc({ script, lang }: { script: EpisodeScript; lang: "zh" | "en" }) {
  return (
    <div className="border border-border bg-card/70">
      <div className="border-b border-border px-4 py-3">
        <p className="mono-label text-[10px] text-primary">
          {lang === "zh" ? `EPISODE ${script.epNo}` : `EPISODE ${script.epNo} · EN`}
        </p>
        <h3 className="mt-1 text-lg font-semibold">
          {lang === "zh" ? `第 ${script.epNo} 集 · ${script.title}` : script.title}
        </h3>
      </div>
      <div className="space-y-5 px-4 py-5 md:px-6">
        {script.scenes.map((sc) => (
          <div key={sc.sceneNo}>
            <p className="font-mono2 border-l-2 border-primary pl-3 text-xs font-semibold uppercase tracking-wider text-primary">
              {lang === "zh" ? `场景 ${sc.sceneNo}` : `SCENE ${sc.sceneNo}`} · {sc.location} · {sc.time}
            </p>
            <div className="mt-3 space-y-2.5">
              {sc.beats.map((b, i) =>
                b.type === "dialogue" ? (
                  <div key={i} className="flex gap-3 pl-3">
                    <span className="font-mono2 w-20 shrink-0 pt-0.5 text-right text-xs font-semibold text-foreground/80">
                      {b.character}
                    </span>
                    <p className="font-script min-w-0 flex-1 text-[15px] leading-7">{b.text}</p>
                  </div>
                ) : (
                  <p key={i} className="font-script pl-3 text-sm leading-7 text-muted-foreground">
                    ▪ {b.text}
                  </p>
                ),
              )}
            </div>
          </div>
        ))}
        <div className="border border-l-2 border-border border-l-destructive bg-destructive/5 px-4 py-3">
          <p className="mono-label text-[9px] text-destructive">Cliffhanger</p>
          <p className="font-script mt-1 text-sm leading-relaxed">{script.cliffhanger}</p>
        </div>
      </div>
    </div>
  );
}

export function ScriptStudio({
  projectId,
  outlines,
  scripts,
  totalEpisodes,
  onDone,
}: {
  projectId: number;
  outlines: OutlineEpisode[];
  scripts: ScriptRow[];
  totalEpisodes: number;
  onDone: () => void;
}) {
  const scriptMap = useMemo(() => new Map(scripts.map((s) => [s.epNo, s])), [scripts]);
  const outlineSet = useMemo(() => new Set(outlines.map((o) => o.epNo)), [outlines]);
  const [selected, setSelected] = useState<number>(() => scripts[0]?.epNo ?? outlines[0]?.epNo ?? 1);
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [batch, setBatch] = useState<{ running: boolean; current: number | null }>({ running: false, current: null });
  const [batchError, setBatchError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const genMut = trpc.pipeline.generateScript.useMutation({ onSuccess: onDone });
  const trMut = trpc.pipeline.translateScript.useMutation({ onSuccess: onDone });

  const row = scriptMap.get(selected);
  const outline = outlines.find((o) => o.epNo === selected);
  const activeScript = lang === "zh" ? row?.contentZh : row?.contentEn;
  const pending = genMut.isPending || trMut.isPending;

  const eps = Array.from({ length: totalEpisodes }, (_, i) => i + 1);

  const runBatch = async () => {
    setBatchError(null);
    const targets = eps.filter((ep) => outlineSet.has(ep) && !scriptMap.get(ep)?.contentZh).slice(0, 5);
    if (!targets.length) return;
    setBatch({ running: true, current: null });
    for (const ep of targets) {
      setBatch({ running: true, current: ep });
      try {
        await genMut.mutateAsync({ projectId, epNo: ep });
      } catch (e) {
        setBatchError(`第 ${ep} 集生成失败：${e instanceof Error ? e.message : "未知错误"}`);
        break;
      }
      onDone();
    }
    setBatch({ running: false, current: null });
  };

  const copyScript = async () => {
    if (!activeScript) return;
    await navigator.clipboard.writeText(formatScript(activeScript, lang));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const downloadScript = () => {
    if (!activeScript) return;
    const blob = new Blob([formatScript(activeScript, lang)], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `EP${String(selected).padStart(2, "0")}_${lang}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const nextMissing = eps.filter((ep) => outlineSet.has(ep) && !scriptMap.get(ep)?.contentZh).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      {/* 集数选择 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="mono-label text-[10px]">Episodes</p>
          <span className="mono-label text-[10px]">
            中 {scripts.filter((s) => s.contentZh).length} · 英 {scripts.filter((s) => s.contentEn).length}
          </span>
        </div>
        <div className="grid grid-cols-6 gap-1 lg:grid-cols-4">
          {eps.map((ep) => {
            const r = scriptMap.get(ep);
            const hasOutline = outlineSet.has(ep);
            const active = ep === selected;
            return (
              <button
                key={ep}
                onClick={() => setSelected(ep)}
                disabled={!hasOutline && !r}
                title={hasOutline ? `第 ${ep} 集` : `第 ${ep} 集（尚无大纲）`}
                className={`relative flex h-11 items-center justify-center border font-mono2 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : hasOutline
                      ? "border-border hover:border-primary/50"
                      : "border-border/50 text-muted-foreground/40 cursor-not-allowed"
                }`}
              >
                {String(ep).padStart(2, "0")}
                {r?.contentZh && (
                  <span
                    className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                      r.contentEn ? "bg-[hsl(var(--mint))]" : "bg-primary"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className="space-y-1.5 text-[10px] text-muted-foreground">
          <p className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> 已有中文剧本</p>
          <p className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--mint))]" /> 中英双语齐</p>
        </div>
        {nextMissing > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={runBatch}
            disabled={batch.running || pending}
            className="h-11 w-full gap-1.5"
          >
            <Play className="h-3.5 w-3.5" />
            {batch.running ? `连拍中 · 第 ${batch.current ?? "-"} 集` : `自动连拍（${Math.min(5, nextMissing)} 集）`}
          </Button>
        )}
      </div>

      {/* 剧本面板 */}
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-border">
            {(["zh", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`flex h-11 items-center px-4 text-xs transition-colors ${
                  lang === l ? "bg-primary text-primary-foreground font-medium" : "hover:bg-secondary"
                }`}
              >
                {l === "zh" ? "中文" : "English"}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {activeScript && (
            <>
              <Button variant="outline" size="sm" onClick={copyScript} className="h-9 gap-1.5">
                {copied ? <Check className="h-3.5 w-3.5 text-[hsl(var(--mint))]" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "已复制" : "复制"}
              </Button>
              <Button variant="outline" size="sm" onClick={downloadScript} className="h-9 gap-1.5">
                <Download className="h-3.5 w-3.5" />
                导出 .txt
              </Button>
            </>
          )}
        </div>

        {(genMut.error || trMut.error) && (
          <ErrorBox message={(genMut.error ?? trMut.error)?.message} />
        )}
        {batchError && <ErrorBox message={batchError} />}

        {(pending || batch.running) && (
          <Generating
            text={
              batch.running
                ? `自动连拍中：正在生成第 ${batch.current ?? "…"} 集剧本…`
                : genMut.isPending
                  ? `正在生成第 ${selected} 集剧本…`
                  : "正在翻译英文版…"
            }
          />
        )}

        {activeScript ? (
          <ScriptDoc script={activeScript} lang={lang} />
        ) : (
          <div className="flex flex-col items-center gap-4 border border-dashed border-border px-6 py-16 text-center">
            <Film className="h-8 w-8 text-primary" />
            <div>
              <p className="font-medium">
                第 {selected} 集{lang === "en" ? "英文版" : ""}剧本尚未生成
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                {lang === "zh"
                  ? outline
                    ? `大纲已就绪：《${outline.title}》—— ${outline.hook}`
                    : "这一集还没有大纲，请先回到「分集大纲」生成。"
                  : row?.contentZh
                    ? "中文剧本已就绪，可以一键翻译成英文版。"
                    : "请先生成中文剧本。"}
              </p>
            </div>
            {lang === "zh" && outline && (
              <Button
                onClick={() => genMut.mutate({ projectId, epNo: selected })}
                disabled={pending || batch.running}
                className="h-11 px-6"
              >
                生成本集剧本
              </Button>
            )}
            {lang === "en" && row?.contentZh && (
              <Button
                onClick={() => trMut.mutate({ projectId, epNo: selected })}
                disabled={pending || batch.running}
                className="h-11 gap-1.5 px-6"
              >
                <Languages className="h-4 w-4" />
                翻译成英文版
              </Button>
            )}
          </div>
        )}

        {activeScript && lang === "zh" && !row?.contentEn && (
          <button
            onClick={() => trMut.mutate({ projectId, epNo: selected })}
            disabled={pending || batch.running}
            className="flex w-full items-center justify-center gap-2 border border-border px-4 py-3 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
          >
            <Languages className="h-3.5 w-3.5" />
            本集还没有英文版 —— 点击翻译
          </button>
        )}
      </div>
    </div>
  );
}
