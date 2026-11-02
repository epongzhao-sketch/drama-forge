import { useMemo, useState } from "react";
import { useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader, Led, ErrorBox } from "@/components/chrome";
import { PIPELINE_STAGES, type PipelineStageKey } from "@contracts/pipeline";
import { SampleEditor } from "@/components/pipeline/SampleEditor";
import { AnalysisView } from "@/components/pipeline/AnalysisView";
import { RemapForm } from "@/components/pipeline/RemapForm";
import { BibleView } from "@/components/pipeline/BibleView";
import { OutlineView } from "@/components/pipeline/OutlineView";
import { ScriptStudio } from "@/components/pipeline/ScriptStudio";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
    const total = data.remap?.totalEpisodes ?? 60;
    return {
      hasSample: !!data.sample,
      hasAnalysis: !!data.analysis,
      hasRemap: !!data.remap,
      hasBible: !!data.bible,
      outlineCount: data.outlines.length,
      scriptCount: data.scripts.filter((s) => s.contentZh).length,
      total,
    };
  }, [data]);

  const stageState = (key: PipelineStageKey): "done" | "active" | "idle" => {
    if (!status) return "idle";
    const doneMap: Record<PipelineStageKey, boolean> = {
      sample: status.hasSample,
      analysis: status.hasAnalysis,
      remap: status.hasRemap,
      bible: status.hasBible,
      outline: status.outlineCount > 0,
      script: status.scriptCount > 0,
    };
    if (key === stage) return "active";
    return doneMap[key] ? "done" : "idle";
  };

  const stageIndex = PIPELINE_STAGES.findIndex((s) => s.key === stage);
  const goStage = (dir: 1 | -1) => {
    const next = PIPELINE_STAGES[stageIndex + dir];
    if (next) setStage(next.key);
  };

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
                      <Led tone={st === "done" ? "mint" : st === "active" ? "amber" : undefined} pulse={st === "active"} />
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* 桌面端进度摘要 */}
            <div className="hidden px-5 pb-6 lg:block">
              <p className="mono-label text-[10px]">Progress</p>
              <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                <p className="flex justify-between"><span>分集大纲</span><span className="font-mono2 text-foreground/80">{status.outlineCount}/{status.total}</span></p>
                <p className="flex justify-between"><span>中文剧本</span><span className="font-mono2 text-foreground/80">{status.scriptCount}/{status.total}</span></p>
                <p className="flex justify-between"><span>英文剧本</span><span className="font-mono2 text-foreground/80">{data.scripts.filter((s) => s.contentEn).length}/{status.total}</span></p>
              </div>
            </div>
          </aside>

          {/* 中间：阶段内容 */}
          <main className="min-w-0 flex-1 px-4 py-6 md:px-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="mono-label text-[10px] text-primary">
                  Stage {String(stageIndex + 1).padStart(2, "0")} / 06 · {PIPELINE_STAGES[stageIndex].en}
                </p>
                <h2 className="mt-1 text-xl font-bold md:text-2xl">{PIPELINE_STAGES[stageIndex].label}</h2>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => goStage(-1)}
                  disabled={stageIndex === 0}
                  aria-label="上一阶段"
                  className="flex h-11 w-11 items-center justify-center border border-border transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => goStage(1)}
                  disabled={stageIndex === PIPELINE_STAGES.length - 1}
                  aria-label="下一阶段"
                  className="flex h-11 w-11 items-center justify-center border border-border transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-30"
                >
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
              <RemapForm
                projectId={projectId}
                analysis={data.analysis}
                remap={data.remap}
                hasBible={status.hasBible}
                onSaved={refresh}
                onBible={() => {
                  refresh();
                  setStage("bible");
                }}
              />
            )}
            {stage === "bible" && (
              <BibleView
                projectId={projectId}
                bible={data.bible}
                ready={status.hasAnalysis && status.hasRemap}
                onDone={refresh}
              />
            )}
            {stage === "outline" && (
              <OutlineView
                projectId={projectId}
                outlines={data.outlines}
                totalEpisodes={status.total}
                ready={status.hasBible}
                onDone={refresh}
              />
            )}
            {stage === "script" && (
              <ScriptStudio
                projectId={projectId}
                outlines={data.outlines}
                scripts={data.scripts}
                totalEpisodes={status.total}
                onDone={refresh}
              />
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
              {data.remap && (
                <div className="border border-border bg-card/60 px-3.5 py-3">
                  <p className="mono-label text-[9px]">换皮设定</p>
                  <p className="mt-1.5 text-xs font-medium">{data.remap.newGenre}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {data.remap.totalEpisodes} 集 × {data.remap.episodeSeconds}s · {data.remap.setting}
                  </p>
                </div>
              )}
              {data.bible && (
                <div className="border border-primary/30 bg-primary/5 px-3.5 py-3">
                  <p className="mono-label text-[9px] text-primary">新剧</p>
                  <p className="mt-1.5 text-sm font-semibold">{data.bible.titleZh}</p>
                  <p className="font-mono2 mt-0.5 text-[10px] text-muted-foreground">{data.bible.titleEn}</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
