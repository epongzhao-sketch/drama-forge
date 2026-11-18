import { useMemo, useState } from "react";
import { useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader, Led, ErrorBox } from "@/components/chrome";
import { Button } from "@/components/ui/button";
import { PIPELINE_STAGES, type PipelineStageKey } from "@contracts/pipeline";
import { SampleEditor } from "@/components/pipeline/SampleEditor";
import { AnalysisView } from "@/components/pipeline/AnalysisView";
import { RemapConcepts } from "@/components/pipeline/RemapConcepts";
import { ScriptPacks } from "@/components/pipeline/ScriptPacks";
import { Finalize } from "@/components/pipeline/Finalize";
import { ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Info, Trophy } from "lucide-react";

export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const { isAuthenticated } = useAuth({ redirectOnUnauthenticated: true });
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.pipeline.get.useQuery(
    { id: projectId },
    { enabled: isAuthenticated && Number.isFinite(projectId) },
  );
  const [stage, setStage] = useState<PipelineStageKey>("sample");

  const refresh = () => utils.pipeline.get.invalidate({ id: projectId });

  const status = useMemo(() => {
    if (!data) return null;
    const pool = data.remapPool;
    return {
      hasSample: !!data.sample,
      hasAnalysis: !!data.analysis,
      hasRemap: !!pool && pool.concepts.length > 0,
      selectedCount: pool?.selectedIds.length ?? 0,
      packCount: data.packs.length,
      hasFinal: !!pool?.finalId,
    };
  }, [data]);

  const stageState = (key: PipelineStageKey): "done" | "active" | "idle" => {
    if (!status) return "idle";
    const doneMap: Record<PipelineStageKey, boolean> = {
      sample: status.hasSample,
      analysis: status.hasAnalysis,
      remap: status.hasRemap && status.selectedCount > 0,
      pack: status.packCount > 0,
      final: status.hasFinal,
    };
    if (key === stage) return "active";
    return doneMap[key] ? "done" : "idle";
  };

  const stageIndex = PIPELINE_STAGES.findIndex((s) => s.key === stage);
  const goStage = (dir: 1 | -1) => {
    const next = PIPELINE_STAGES[stageIndex + dir];
    if (next) setStage(next.key);
  };

  // 每阶段完成判定 + 未完成时的行动指引（底部引导条的数据源）
  type StageFlow = { done: boolean; doneText: string; todo: string; todoStage?: PipelineStageKey };
  const stageFlow: StageFlow | null = useMemo(() => {
    if (!status) return null;
    const flow: Record<PipelineStageKey, StageFlow> = {
      sample: status.hasSample
        ? { done: true, doneText: "样本已保存", todo: "" }
        : { done: false, doneText: "", todo: "上传或粘贴剧本，标红爆款素材段，然后点「保存样本」" },
      analysis: !status.hasSample
        ? { done: false, doneText: "", todo: "AI 拆解需要先有样本", todoStage: "sample" }
        : status.hasAnalysis
          ? { done: true, doneText: "拆解报告已生成", todo: "" }
          : { done: false, doneText: "", todo: "点击「开始 AI 拆解」，等待约 1-2 分钟生成拆解报告" },
      remap: !status.hasAnalysis
        ? { done: false, doneText: "", todo: "换皮方案基于拆解报告生成，请先完成 AI 拆解", todoStage: "analysis" }
        : !status.hasRemap
          ? { done: false, doneText: "", todo: "点「生成 10 个换皮方案」，等待 AI 产出（约 1-3 分钟）" }
          : status.selectedCount === 0
            ? { done: false, doneText: "", todo: "勾选 3~5 个最看好的方案，然后点「确认粗选」" }
            : { done: true, doneText: `已粗选 ${status.selectedCount} 个方案`, todo: "" },
      pack:
        status.selectedCount === 0
          ? { done: false, doneText: "", todo: "剧本包按入选方案产出，请先在「换皮方案」完成粗选", todoStage: "remap" }
          : status.packCount === 0
            ? { done: false, doneText: "", todo: "选中一个方案，点「产出该方案的剧本包」——首卡 1~10 集全量产出，约 15-40 分钟，请保持页面打开" }
            : status.packCount < status.selectedCount
              ? { done: true, doneText: `已产出 ${status.packCount}/${status.selectedCount} 个剧本包，可继续产出，也可以直接去定稿`, todo: "" }
              : { done: true, doneText: `${status.packCount} 个剧本包全部产出`, todo: "" },
      final: status.hasFinal
        ? { done: true, doneText: "已选定最终成品 🎉——可在编审定稿页「继续生成全集剧本」把第 11 集续写至大结局", todo: "" }
        : status.packCount === 0
          ? { done: false, doneText: "", todo: "还没有剧本包可审，请先在「剧本产出」生成", todoStage: "pack" }
          : { done: false, doneText: "", todo: "逐个审阅剧本包（可先跑判档质检），点「选定此方案为最终成品」" },
    };
    return flow[stage];
  }, [status, stage]);

  if (error) {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <main className="mx-auto max-w-3xl px-4 py-16">
          <ErrorBox message={error.message} />
          <Link to="/" className="mono-label mt-4 inline-block text-[10px] text-primary hover:underline">
            ← 返回项目库
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <AppHeader />
      {isLoading || !data || !status ? (
        <main className="mx-auto max-w-[1440px] px-4 py-8 md:px-6">
          <div className="panel h-[420px] animate-pulse" />
        </main>
      ) : (
        <div className="mx-auto flex max-w-[1440px] flex-col lg:flex-row">
          {/* 左侧：流水线导航 */}
          <aside className="shrink-0 border-b border-border lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:w-60 lg:border-b-0 lg:border-r">
            <div className="px-4 pt-5 lg:px-5">
              <Link to="/" className="mono-label inline-flex items-center gap-1 text-[10px] hover:text-primary transition-colors">
                <ChevronLeft className="h-3 w-3" /> 项目库
              </Link>
              <h1 className="mt-2 truncate text-lg font-semibold" title={data.project.title}>
                {data.project.title}
              </h1>
              {data.project.sourceTitle && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  复刻对象：{data.project.sourceTitle}
                </p>
              )}
            </div>

            {/* 移动端横向滚动 / 桌面纵向 */}
            <nav className="flex gap-1 overflow-x-auto px-3 py-4 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-3">
              {PIPELINE_STAGES.map((s, i) => {
                const st = stageState(s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() => setStage(s.key)}
                    className={`flex min-h-11 shrink-0 items-center gap-3 border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:border-0 lg:border-l-2 ${
                      st === "active"
                        ? "border-primary/60 bg-primary/10 lg:border-l-primary"
                        : "border-border hover:border-primary/40 lg:border-l-transparent lg:hover:bg-secondary/60"
                    }`}
                  >
                    <span className={`font-mono2 text-[10px] ${st === "active" ? "text-primary" : "text-muted-foreground"}`}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-xs font-medium leading-tight ${st === "active" ? "text-primary" : ""}`}>
                        {s.label}
                      </span>
                      <span className="mono-label mt-0.5 block text-[8px]">{s.en}</span>
                    </span>
                    <span className="ml-auto pl-2">
                      {st === "done" ? (
                        <Check className="h-3.5 w-3.5 text-[hsl(var(--mint))]" />
                      ) : (
                        <Led tone={st === "active" ? "amber" : undefined} pulse={st === "active"} />
                      )}
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* 桌面端进度摘要 */}
            <div className="hidden px-5 pb-6 lg:block">
              <p className="mono-label text-[10px]">Progress</p>
              <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                <p className="flex justify-between"><span>入选方案</span><span className="font-mono2 text-foreground/80">{status.selectedCount}</span></p>
                <p className="flex justify-between"><span>剧本包</span><span className="font-mono2 text-foreground/80">{status.packCount}/{status.selectedCount}</span></p>
                <p className="flex justify-between"><span>已定稿</span><span className="font-mono2 text-foreground/80">{status.hasFinal ? "1" : "0"}</span></p>
              </div>
            </div>
          </aside>

          {/* 中间：阶段内容 */}
          <main className="min-w-0 flex-1 px-4 py-6 md:px-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="mono-label text-[10px] text-primary">
                  Stage {String(stageIndex + 1).padStart(2, "0")} / 05 · {PIPELINE_STAGES[stageIndex].en}
                </p>
                <h2 className="mt-1 text-xl font-bold md:text-2xl">{PIPELINE_STAGES[stageIndex].label}</h2>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => goStage(-1)}
                  disabled={stageIndex === 0}
                  aria-label="上一阶段"
                  className="flex h-11 items-center gap-1 border border-border px-3 text-xs transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden md:inline">上一步</span>
                </button>
                <button
                  onClick={() => goStage(1)}
                  disabled={stageIndex === PIPELINE_STAGES.length - 1}
                  aria-label="下一阶段"
                  className="flex h-11 items-center gap-1 border border-border px-3 text-xs transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-30"
                >
                  <span className="hidden md:inline">下一步</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {stage === "sample" && (
              <SampleEditor projectId={projectId} initial={data.sample} onSaved={refresh} />
            )}
            {stage === "analysis" && (
              <AnalysisView
                projectId={projectId}
                hasSample={status.hasSample}
                analysis={data.analysis}
                onDone={refresh}
              />
            )}
            {stage === "remap" && (
              <RemapConcepts
                projectId={projectId}
                analysis={data.analysis}
                pool={data.remapPool}
                onSaved={refresh}
              />
            )}
            {stage === "pack" && (
              <ScriptPacks
                projectId={projectId}
                pool={data.remapPool}
                packs={data.packs}
                onDone={refresh}
              />
            )}
            {stage === "final" && (
              <Finalize
                projectId={projectId}
                pool={data.remapPool}
                packs={data.packs}
                packEval={data.evaluations.find((e) => e.scope === "pack")?.report ?? null}
                onDone={refresh}
              />
            )}

            {/* 底部引导条：未完成 → 告诉用户该做什么；完成 → 醒目的「下一步」 */}
            {stageFlow && (
              <div className="sticky bottom-3 z-20 mt-8 flex flex-wrap items-center gap-3 border border-primary/40 bg-card/95 px-4 py-3.5 shadow-lg shadow-black/30 backdrop-blur">
                {stageFlow.done ? (
                  <>
                    <p className="flex min-w-0 items-center gap-2 text-xs text-foreground/85">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[hsl(var(--mint))]" />
                      <span>{stageFlow.doneText}</span>
                    </p>
                    <div className="flex-1" />
                    {stageIndex < PIPELINE_STAGES.length - 1 ? (
                      <Button onClick={() => goStage(1)} className="h-11 gap-1.5 px-5 text-sm font-medium">
                        下一步：{PIPELINE_STAGES[stageIndex + 1].label}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Link to="/">
                        <Button variant="secondary" className="h-11 gap-1.5 px-5 text-sm font-medium">
                          <Trophy className="h-4 w-4 text-[hsl(var(--mint))]" />
                          完成，返回项目库
                        </Button>
                      </Link>
                    )}
                  </>
                ) : (
                  <>
                    <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <Info className="h-4 w-4 shrink-0 text-primary" />
                      <span>{stageFlow.todo}</span>
                    </p>
                    <div className="flex-1" />
                    {stageFlow.todoStage ? (
                      <Button
                        variant="outline"
                        onClick={() => setStage(stageFlow.todoStage!)}
                        className="h-10 gap-1.5"
                      >
                        回到「{PIPELINE_STAGES.find((s) => s.key === stageFlow.todoStage)?.label}」
                      </Button>
                    ) : (
                      <span className="mono-label text-[10px] text-muted-foreground">
                        完成本阶段后，这里会出现「下一步」按钮
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </main>

          {/* 右侧：情报栏（仅桌面） */}
          <aside className="hidden w-72 shrink-0 border-l border-border px-5 py-6 xl:block">
            <p className="mono-label text-[10px]">Intel · 情报栏</p>
            <div className="mt-3 space-y-3">
              {data.analysis ? (
                <div className="border border-border bg-card/60 px-3.5 py-3">
                  <p className="mono-label text-[9px] text-primary">爆款基因</p>
                  <p className="mt-1.5 text-xs font-medium">{data.analysis.genre}</p>
                  {data.analysis.coreExpectation && (
                    <p className="mt-1.5 border-l-2 border-primary/50 pl-2 text-[11px] leading-relaxed text-foreground/80">
                      {data.analysis.coreExpectation}
                    </p>
                  )}
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{data.analysis.tropeSummary}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {data.analysis.hookTypes.slice(0, 4).map((h, i) => (
                      <span key={i} className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{h}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="border border-dashed border-border px-3.5 py-4 text-xs text-muted-foreground">
                  完成 AI 拆解后，这里会显示爆款基因摘要。
                </p>
              )}
              {data.sample && (
                <div className="border border-border bg-card/60 px-3.5 py-3">
                  <p className="mono-label text-[9px]">样本</p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {data.sample.content.length.toLocaleString()} 字 · 红标 {data.sample.redSegments.length} 段
                  </p>
                </div>
              )}
              {data.remapPool && data.remapPool.concepts.length > 0 && (
                <div className="border border-border bg-card/60 px-3.5 py-3">
                  <p className="mono-label text-[9px]">换皮方案</p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {data.remapPool.concepts.length} 个候选 · 已选 {data.remapPool.selectedIds.length} 个
                  </p>
                  {data.remapPool.selectedIds.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {data.remapPool.selectedIds.map((id) => {
                        const c = data.remapPool!.concepts.find((x) => x.id === id);
                        const isFinal = data.remapPool!.finalId === id;
                        return (
                          <p key={id} className={`truncate text-[11px] ${isFinal ? "text-[hsl(var(--mint))] font-medium" : "text-foreground/75"}`}>
                            {isFinal ? "★ " : ""}{c?.title ?? id}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
