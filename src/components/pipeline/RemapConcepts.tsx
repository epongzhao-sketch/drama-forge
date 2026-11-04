// 换皮方案阶段：AI 一次产出 10 个方案 → 人工粗选 3~5 个进入剧本产出
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import type { AnalysisResult, RemapPool } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBox, Generating } from "@/components/chrome";
import { Sparkles, CheckCircle2, Circle, Lock, RefreshCw } from "lucide-react";

export function RemapConcepts({
  projectId,
  analysis,
  pool,
  onSaved,
}: {
  projectId: number;
  analysis: AnalysisResult | null;
  pool: RemapPool | null;
  onSaved: () => void;
}) {
  const [totalEpisodes, setTotalEpisodes] = useState(pool?.totalEpisodes ?? 60);
  const [episodeSeconds, setEpisodeSeconds] = useState(pool?.episodeSeconds ?? 75);
  const [notes, setNotes] = useState(pool?.notes ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(pool?.selectedIds ?? []));

  const genMut = trpc.pipeline.generateConcepts.useMutation({ onSuccess: onSaved });
  const selMut = trpc.pipeline.selectConcepts.useMutation({ onSuccess: onSaved });

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  };

  const canConfirm = picked.size >= 1 && picked.size <= 5;

  return (
    <div className="space-y-5">
      {/* 生成参数 */}
      <section className="panel px-4 py-4 md:px-5">
        <p className="mono-label text-[10px]">Remap Settings · 全局参数</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rc-eps">新剧总集数</Label>
            <Input id="rc-eps" type="number" min={1} max={120} value={totalEpisodes}
              onChange={(e) => setTotalEpisodes(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-sec">单集时长（秒）</Label>
            <Input id="rc-sec" type="number" min={30} max={300} value={episodeSeconds}
              onChange={(e) => setEpisodeSeconds(Number(e.target.value))} />
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="rc-notes">补充要求（选填）</Label>
          <Textarea id="rc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="例：偏向女频复仇赛道，避开校园题材…" />
        </div>
        <div className="mt-4">
          <Button onClick={() => genMut.mutate({ projectId, totalEpisodes, episodeSeconds, notes: notes || undefined })}
            disabled={!analysis || genMut.isPending}>
            <Sparkles className="h-4 w-4" />
            {genMut.isPending ? "AI 正在产出 10 个方案…" : pool ? "重新生成 10 个换皮方案" : "生成 10 个换皮方案"}
          </Button>
          {!analysis && <p className="mt-2 text-xs text-muted-foreground">需要先完成 AI 拆解。</p>}
        </div>
        {genMut.isPending && <Generating text="锁定核心期待，正在为同一期待换 10 种元素外皮（约 1-3 分钟）…" />}
        {genMut.error && <ErrorBox message={genMut.error.message} />}
      </section>

      {/* 方案列表 */}
      {pool && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <p className="mono-label text-[10px]">
              Concepts · 10 个候选方案 —— 核心期待全部锁定，只是元素外皮不同；勾选 3~5 个进入剧本产出（已选 {picked.size}）
            </p>
            <Button size="sm" variant="secondary" disabled={!canConfirm || selMut.isPending}
              onClick={() => selMut.mutate({ projectId, selectedIds: [...picked] })}>
              {selMut.isPending ? "保存中…" : `确认粗选（${picked.size} 个）`}
            </Button>
          </div>
          {selMut.error && <ErrorBox message={selMut.error.message} />}
          <div className="grid gap-3 md:grid-cols-2">
            {pool.concepts.map((c) => {
              const on = picked.has(c.id);
              const selected = pool.selectedIds.includes(c.id);
              return (
                <button key={c.id} type="button" onClick={() => toggle(c.id)}
                  className={`panel flex flex-col gap-2 px-4 py-4 text-left transition-colors ${
                    on ? "border-primary/60 bg-primary/5" : "hover:border-primary/30"
                  }`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-snug">{c.title}</p>
                    {on
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </div>
                  <p className="mono-label text-[9px] text-muted-foreground">{c.genre}</p>
                  {c.keptExpectation && (
                    <div className="rounded border border-[hsl(var(--mint))]/40 bg-[hsl(var(--mint))]/10 px-2 py-1.5">
                      <p className="mono-label flex items-center gap-1 text-[9px] text-[hsl(var(--mint))]">
                        <Lock className="h-3 w-3" /> 锁定核心期待 · Locked Core
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-foreground/85">{c.keptExpectation}</p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground"><span className="text-foreground/70">主角：</span>{c.protagonist}</p>
                  <p className="text-xs text-muted-foreground"><span className="text-foreground/70">背景：</span>{c.setting}</p>
                  <p className="border-l-2 border-primary/50 pl-2 text-xs leading-relaxed text-foreground/85">{c.twist}</p>
                  {(c.swappedElements?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <RefreshCw className="h-3 w-3 text-muted-foreground" />
                      {c.swappedElements!.map((s) => (
                        <span key={s} className="mono-label border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  {selected && (
                    <span className="mono-label self-start border border-[hsl(var(--mint))]/50 bg-[hsl(var(--mint))]/10 px-1.5 py-0.5 text-[9px] text-[hsl(var(--mint))]">
                      已入选
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {pool.selectedIds.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              已粗选 {pool.selectedIds.length} 个方案。进入「剧本产出」阶段为每个方案生成 3~5 集连贯剧本 + 2 段投流素材。
            </p>
          )}
        </section>
      )}
    </div>
  );
}
