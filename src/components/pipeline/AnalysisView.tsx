import { trpc } from "@/providers/trpc";
import type { AnalysisResult } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import { ErrorBox, Generating, Led } from "@/components/chrome";
import { Radar, RefreshCw } from "lucide-react";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-border bg-card/60 px-4 py-3.5">
      <p className="mono-label text-[10px]">{label}</p>
      <div className="mt-2 text-sm leading-relaxed text-foreground/90">{children}</div>
    </div>
  );
}

export function AnalysisView({
  projectId,
  hasSample,
  analysis,
  onDone,
}: {
  projectId: number;
  hasSample: boolean;
  analysis: AnalysisResult | null;
  onDone: () => void;
}) {
  const runMut = trpc.pipeline.runAnalysis.useMutation({ onSuccess: onDone });

  if (!analysis) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-4 border border-dashed border-border px-6 py-16 text-center">
          <Radar className="h-8 w-8 text-primary" />
          <div>
            <p className="font-medium">拆解爆款基因</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              AI 将分析样本的题材套路、人设、核心冲突、钩子节奏与付费卡点，
              并逐一解读你标红的爆款素材段为什么有效。
            </p>
          </div>
          {runMut.isPending ? (
            <Generating text="正在拆解爆款样本…" />
          ) : (
            <Button
              onClick={() => runMut.mutate({ projectId })}
              disabled={!hasSample}
              className="h-11 px-6"
            >
              {hasSample ? "开始 AI 拆解" : "请先在「样本录入」保存样本"}
            </Button>
          )}
        </div>
        {runMut.error && <ErrorBox message={runMut.error.message} onRetry={() => runMut.mutate({ projectId })} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="mono-label flex items-center gap-2">
          <Led tone="mint" /> Deconstruction Report · 拆解报告
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => runMut.mutate({ projectId })}
          disabled={runMut.isPending}
          className="h-9 gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${runMut.isPending ? "animate-spin" : ""}`} />
          {runMut.isPending ? "拆解中…" : "重新拆解"}
        </Button>
      </div>
      {runMut.error && <ErrorBox message={runMut.error.message} />}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="题材定位">
          {analysis.dramaType ? (
            <>
              <span className="mr-2 border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                {analysis.dramaType}
              </span>
              {analysis.genre}
            </>
          ) : (
            analysis.genre
          )}
        </Field>
        <Field label="核心套路">{analysis.tropeSummary}</Field>
        <Field label="主角人设">{analysis.protagonist}</Field>
        <Field label="反派 / 阻力">{analysis.antagonist}</Field>
      </div>

      {analysis.coreExpectation && (
        <div className="border border-primary/50 bg-primary/5 px-4 py-3.5">
          <p className="mono-label text-[10px] text-primary">
            Core Expectation · 核心期待（观众为什么付费）
          </p>
          <p className="mt-2 text-sm font-medium leading-relaxed">{analysis.coreExpectation}</p>
          {(analysis.elements?.length ?? 0) > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="mono-label text-[10px] text-muted-foreground">服务期待的元素（可换皮）：</span>
              {analysis.elements!.map((e, i) => (
                <span key={i} className="border border-border bg-card px-2 py-0.5 text-xs text-foreground/80">
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <Field label="核心冲突">{analysis.coreConflict}</Field>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="钩子节奏">{analysis.hookRhythm}</Field>
        <Field label="付费卡点规律">{analysis.paywallPattern}</Field>
      </div>

      <Field label="钩型清单">
        <div className="flex flex-wrap gap-1.5">
          {analysis.hookTypes.map((h, i) => (
            <span key={i} className="border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {h}
            </span>
          ))}
        </div>
      </Field>

      <div className="space-y-2">
        <p className="mono-label text-[10px]">Red Segment Decode · 红标段解读</p>
        {analysis.redSegmentTraits.map((r, i) => (
          <div key={i} className="border border-border border-l-2 border-l-destructive bg-card/60 px-4 py-3">
            <p className="font-script text-sm text-destructive/90">“{r.quote}”</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{r.trait}</p>
          </div>
        ))}
      </div>

      <Field label="可迁移爆款元素">
        <ul className="space-y-1.5">
          {analysis.transferableElements.map((t, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="mono-label mt-0.5 text-[10px] text-primary">{String(i + 1).padStart(2, "0")}</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Field>

      <Field label="目标市场适配">{analysis.marketFit}</Field>
    </div>
  );
}
