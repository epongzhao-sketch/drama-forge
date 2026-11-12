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
  // 旧版拆解报告没有六板块字段 / 逐集节拍镜像表 → 提示重新拆解
  const isLegacy = !!analysis && (!analysis.hook4 || !analysis.beatMap);

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
            <Generating text="正在拆解爆款样本（约 1-2 分钟）…" />
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
          {runMut.isPending ? "拆解中…" : isLegacy ? "重新拆解（小黑DNA版）" : "重新拆解"}
        </Button>
      </div>
      {isLegacy && (
        <p className="border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          这份报告是旧版——重新拆解后可获得六板块完整结构（EP1 四层钩拆解 / 付费墙位置表 / 人物四态弧线 / 母题复合与物件钩 / 换皮三关）+ 逐集节拍镜像表（节拍级复刻的骨架依据）。
        </p>
      )}
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

      {analysis.hook4 && (
        <div className="border border-border bg-card/60 px-4 py-3.5">
          <p className="mono-label text-[10px]">EP1 四层钩拆解 · DNA 黄金开局</p>
          <div className="mt-3 space-y-2.5">
            {(
              [
                ["前 3 秒 · 视觉钩", analysis.hook4.visual3s],
                ["前 30 秒 · 信息钩", analysis.hook4.info30s],
                ["前 60 秒 · 金钩", analysis.hook4.golden60s],
                ["集尾 · 痛点钩", analysis.hook4.epEndPain],
              ] as const
            ).map(([label, text], i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="mono-label mt-0.5 w-28 shrink-0 text-[10px] text-primary">{label}</span>
                <span className="leading-relaxed text-foreground/90">{text}</span>
              </div>
            ))}
          </div>
          {analysis.openingSkeleton && (
            <p className="mt-2.5 border-t border-border pt-2.5 text-xs text-muted-foreground">
              开局骨架：{analysis.openingSkeleton}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="钩子节奏">{analysis.hookRhythm}</Field>
        <Field label="付费卡点规律">{analysis.paywallPattern}</Field>
      </div>

      {analysis.paywallTable && analysis.paywallTable.length > 0 && (
        <Field label="付费墙位置表（DNA：每墙 ≥9/10 大情绪点）">
          <div className="space-y-1.5">
            {analysis.paywallTable.map((w, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="mono-label w-12 shrink-0 text-[10px] text-primary">{w.ep}</span>
                <span className="flex-1">{w.event}</span>
                <span
                  className={`mono-label px-1.5 py-0.5 text-[10px] ${
                    w.intensity >= 9
                      ? "bg-[hsl(var(--mint))]/10 text-[hsl(var(--mint))]"
                      : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {w.intensity}/10
                </span>
              </div>
            ))}
          </div>
          {analysis.beatDensity && (
            <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">卡点密度：{analysis.beatDensity}</p>
          )}
        </Field>
      )}

      {analysis.arcs && analysis.arcs.length > 0 && (
        <Field label="人物四态弧线（起点→转折→高潮→终点，各绑情绪关键词）">
          <div className="space-y-3">
            {analysis.arcs.map((arc, i) => (
              <div key={i}>
                <p className="text-xs font-medium text-foreground">{arc.character}</p>
                <div className="mt-1.5 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-4">
                  {(
                    [
                      ["起点", arc.start],
                      ["转折", arc.turn],
                      ["高潮", arc.climax],
                      ["终点", arc.end],
                    ] as const
                  ).map(([label, text]) => (
                    <div key={label} className="border border-border bg-background/60 px-2 py-1.5">
                      <span className="mono-label text-[9px] text-primary">{label}</span>
                      <p className="mt-0.5 leading-snug">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {analysis.emotionCurve5 && (
            <p className="mt-2.5 border-t border-border pt-2 text-xs text-muted-foreground">
              情绪 5 段式：{analysis.emotionCurve5}
            </p>
          )}
        </Field>
      )}

      {(analysis.motifs?.length || analysis.objectHooks?.length || analysis.reskinGate) && (
        <Field label="换皮方法论 · 母题与物件钩">
          {analysis.motifs && analysis.motifs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mono-label text-[10px] text-muted-foreground">母题复合：</span>
              {analysis.motifs.map((m, i) => (
                <span key={i} className="border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {m}
                </span>
              ))}
            </div>
          )}
          {analysis.objectHooks && analysis.objectHooks.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {analysis.objectHooks.map((o, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mono-label mt-0.5 text-[10px] text-primary">OBJ</span>
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          )}
          {analysis.reskinGate && (
            <div className="mt-2.5 space-y-1.5 border-t border-border pt-2.5 text-xs">
              {(
                [
                  ["第一关 · 骨架成立", analysis.reskinGate.skeleton],
                  ["第二关 · 融梗方法", analysis.reskinGate.adaptMotifs],
                  ["第三关 · 文化适配", analysis.reskinGate.cultureFit],
                ] as const
              ).map(([label, text]) => (
                <p key={label}>
                  <span className="mono-label mr-2 text-[10px] text-primary">{label}</span>
                  <span className="text-muted-foreground">{text}</span>
                </p>
              ))}
            </div>
          )}
        </Field>
      )}

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

      {analysis.beatMap && analysis.beatMap.length > 0 && (
        <div className="border border-primary/50 bg-card/60 px-4 py-3.5">
          <p className="mono-label text-[10px] text-primary">
            Beat Map · 逐集节拍镜像表（新剧将逐拍对齐此节奏骨架）
          </p>
          <div className="mt-3 space-y-3">
            {analysis.beatMap.map((ep) => (
              <div key={ep.epNo} className="border border-border bg-background/50 px-3 py-2.5">
                <p className="flex items-center gap-2 text-xs font-semibold">
                  <span className="mono-label text-[10px] text-primary">EP{ep.epNo}</span>
                  {ep.paywall && (
                    <span className="border border-destructive/50 bg-destructive/10 px-1.5 py-0.5 text-[9px] text-destructive">付费卡点</span>
                  )}
                  {(ep.scenes || ep.lines) && (
                    <span className="mono-label border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      体量 {ep.scenes ?? "?"}场 / {ep.lines ?? "?"}行
                    </span>
                  )}
                  <span className="ml-auto text-[10px] font-normal text-muted-foreground">集尾：{ep.cliffhangerType}</span>
                </p>
                <div className="mt-2 space-y-1">
                  {ep.beats.map((b, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="mono-label w-10 shrink-0 pt-0.5 text-[9px] text-muted-foreground">{b.position}</span>
                      <span className="shrink-0 border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{b.type}</span>
                      <span className="min-w-0 flex-1 leading-relaxed text-foreground/85">{b.summary}</span>
                      <span
                        className={`mono-label shrink-0 px-1.5 py-0.5 text-[10px] ${
                          b.intensity >= 9
                            ? "bg-destructive/10 text-destructive"
                            : b.intensity >= 7
                              ? "bg-primary/10 text-primary"
                              : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {b.intensity}/10
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
