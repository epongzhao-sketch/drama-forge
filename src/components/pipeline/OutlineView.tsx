import { useState } from "react";
import { trpc } from "@/providers/trpc";
import type { OutlineEpisode } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import { ErrorBox, Generating, Led } from "@/components/chrome";
import { ListOrdered, RefreshCw, Zap } from "lucide-react";

const BATCH = 6;

export function OutlineView({
  projectId,
  outlines,
  totalEpisodes,
  ready,
  onDone,
}: {
  projectId: number;
  outlines: OutlineEpisode[];
  totalEpisodes: number;
  ready: boolean;
  onDone: () => void;
}) {
  const [regenEp, setRegenEp] = useState<number | null>(null);
  const genMut = trpc.pipeline.generateOutlines.useMutation({
    onSuccess: () => {
      setRegenEp(null);
      onDone();
    },
    onError: () => setRegenEp(null),
  });

  const byEp = new Map(outlines.map((o) => [o.epNo, o]));
  let nextFrom = 1;
  for (let i = 1; i <= totalEpisodes; i++) {
    if (!byEp.has(i)) {
      nextFrom = i;
      break;
    }
    nextFrom = i + 1;
  }
  const done = outlines.length >= totalEpisodes;

  const generateNext = () => {
    genMut.mutate({ projectId, from: nextFrom, count: Math.min(BATCH, totalEpisodes - nextFrom + 1) });
  };
  const regen = (epNo: number) => {
    setRegenEp(epNo);
    genMut.mutate({ projectId, from: epNo, count: 1 });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mono-label flex items-center gap-2">
          <Led tone={outlines.length ? "mint" : undefined} />
          Episode Outlines · {outlines.length} / {totalEpisodes} 集
        </p>
        <div className="flex h-1 flex-1 min-w-24 gap-px bg-border">
          {Array.from({ length: totalEpisodes }, (_, i) => (
            <span key={i} className={`h-full flex-1 ${byEp.has(i + 1) ? "bg-primary" : ""}`} />
          ))}
        </div>
        {!done ? (
          <Button
            size="sm"
            onClick={generateNext}
            disabled={!ready || genMut.isPending}
            className="h-9 gap-1.5"
          >
            <Zap className="h-3.5 w-3.5" />
            {genMut.isPending && regenEp === null
              ? "生成中…"
              : `生成第 ${nextFrom}-${Math.min(nextFrom + BATCH - 1, totalEpisodes)} 集`}
          </Button>
        ) : (
          <span className="mono-label text-[10px] text-primary">全部生成完毕</span>
        )}
      </div>

      {genMut.isPending && regenEp === null && (
        <Generating text={`正在生成第 ${nextFrom} 集起的分集大纲…`} />
      )}
      {genMut.error && <ErrorBox message={genMut.error.message} />}

      {!ready && (
        <p className="border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
          请先在「总纲」阶段生成 Series Bible。
        </p>
      )}

      {outlines.length === 0 && !genMut.isPending ? (
        <div className="flex flex-col items-center gap-4 border border-dashed border-border px-6 py-16 text-center">
          <ListOrdered className="h-8 w-8 text-primary" />
          <div>
            <p className="font-medium">还没有分集大纲</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              每次生成 {BATCH} 集，AI 会衔接上一批的结尾钩子，并按爆款节奏放置付费卡点。
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {Array.from({ length: totalEpisodes }, (_, i) => i + 1)
            .filter((ep) => byEp.has(ep))
            .map((ep) => {
              const o = byEp.get(ep)!;
              return (
                <div
                  key={ep}
                  className={`group flex items-start gap-3 border border-border bg-card/60 px-3.5 py-3 transition-colors hover:border-primary/40 ${
                    o.paywall ? "border-l-2 border-l-destructive" : ""
                  }`}
                >
                  <span className="font-mono2 mt-0.5 w-9 shrink-0 text-sm font-semibold text-primary">
                    E{String(ep).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{o.title}</span>
                      {o.paywall && (
                        <span className="mono-label border border-destructive/50 bg-destructive/10 px-1.5 py-0.5 text-[9px] text-destructive">
                          Paywall
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{o.summary}</p>
                    <p className="mt-1.5 text-xs">
                      <span className="mono-label mr-1.5 text-[9px] text-primary">Hook</span>
                      <span className="text-foreground/85">{o.hook}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => regen(ep)}
                    disabled={genMut.isPending}
                    aria-label={`重新生成第 ${ep} 集大纲`}
                    title="重新生成本集"
                    className="shrink-0 p-2 text-muted-foreground opacity-0 transition-opacity hover:text-primary focus:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${regenEp === ep ? "animate-spin" : ""}`} />
                  </button>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
