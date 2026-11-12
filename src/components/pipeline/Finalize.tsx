// 编审定稿阶段：审阅各入选方案的剧本包 → 判档质检 → 选定最终 1 个
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import type { RemapPool, ConceptScriptPack, EvalReport } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import { ErrorBox, Generating } from "@/components/chrome";
import { EvalReportView } from "@/components/pipeline/EvalReportView";
import { EpisodeDoc, SceneBlock, BeatMirrorView, isLegacyPack } from "@/components/pipeline/ScriptDoc";
import { ShieldCheck, Trophy } from "lucide-react";

export function Finalize({
  projectId,
  pool,
  packs,
  packEval,
  onDone,
}: {
  projectId: number;
  pool: RemapPool | null;
  packs: ConceptScriptPack[];
  packEval: EvalReport | null;
  onDone: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(pool?.selectedIds[0] ?? null);
  const finalMut = trpc.pipeline.finalizeConcept.useMutation({ onSuccess: onDone });
  // 判档质检改异步：提交秒回 + 轮询（根治平台代理掐断长请求）
  const evalStartMut = trpc.stageJobs.start.useMutation();
  const utils = trpc.useUtils();
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalConceptId, setEvalConceptId] = useState<string | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runEval = async (conceptId: string) => {
    setEvalError(null);
    try {
      setEvalRunning(true);
      setEvalConceptId(conceptId);
      await evalStartMut.mutateAsync({ projectId, kind: "evaluate", conceptId });
      pollRef.current = setInterval(async () => {
        try {
          const st = await utils.stageJobs.status.fetch({ projectId, kind: "evaluate", conceptId });
          if (st.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setEvalRunning(false);
            setEvalConceptId(null);
            onDone();
          } else if (st.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setEvalRunning(false);
            setEvalConceptId(null);
            setEvalError(st.error ?? "判档质检失败");
          }
        } catch {
          // 单次轮询失败下轮再试
        }
      }, 8000);
    } catch (e) {
      setEvalRunning(false);
      setEvalConceptId(null);
      setEvalError(e instanceof Error ? e.message : "提交失败");
    }
  };

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  if (!pool || pool.selectedIds.length === 0) {
    return (
      <div className="panel px-4 py-10 text-center text-sm text-muted-foreground">
        还没有入选方案。请先在「换皮方案」粗选，再到「剧本产出」生成剧本包，最后来这里定稿。
      </div>
    );
  }

  const packMap = new Map(packs.map((p) => [p.conceptId, p]));
  const activePack = activeId ? packMap.get(activeId) : undefined;
  const legacy = activePack ? isLegacyPack(activePack) : false;
  const isFinal = (id: string) => pool.finalId === id;

  return (
    <div className="space-y-5">
      <div className="panel border-primary/30 bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
        编审流程：逐个审阅入选方案的剧本包（可跑判档质检），选定最优的 1 个作为最终成品。
      </div>

      <div className="flex flex-wrap gap-2">
        {pool.selectedIds.map((id) => {
          const concept = pool.concepts.find((c) => c.id === id);
          const pack = packMap.get(id);
          return (
            <button key={id} onClick={() => setActiveId(id)}
              className={`panel flex items-center gap-2 px-3.5 py-2.5 text-left text-xs transition-colors ${
                activeId === id ? "border-primary/60 bg-primary/10" : "hover:border-primary/30"
              } ${isFinal(id) ? "ring-1 ring-[hsl(var(--mint))]" : ""}`}>
              {isFinal(id) && <Trophy className="h-3.5 w-3.5 text-[hsl(var(--mint))]" />}
              <span className="font-medium">{concept?.title ?? id}</span>
              <span className="mono-label text-[9px] text-muted-foreground">{pack ? "有剧本包" : "无剧本包"}</span>
            </button>
          );
        })}
      </div>

      {activeId && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={!activePack || legacy || evalRunning}
              onClick={() => void runEval(activeId)}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {evalRunning && evalConceptId === activeId ? "判档质检中…" : "判档质检"}
            </Button>
            <Button size="sm" disabled={!activePack || legacy || finalMut.isPending || isFinal(activeId)}
              onClick={() => finalMut.mutate({ projectId, conceptId: activeId })}>
              {isFinal(activeId) ? "✓ 已定稿" : "选定此方案为最终成品"}
            </Button>
            {finalMut.error && <ErrorBox message={finalMut.error.message} />}
            {evalError && <ErrorBox message={evalError} />}
          </div>
          {evalRunning && evalConceptId === activeId && <Generating text="判档质检中（后台运行，可离开本页）…" />}
          {packEval && activePack && !legacy && <EvalReportView report={packEval} />}

          {!activePack ? (
            <div className="panel px-4 py-8 text-center text-sm text-muted-foreground">
              该方案还没有剧本包 —— 请先到「剧本产出」阶段生成。
            </div>
          ) : legacy ? (
            <div className="panel px-4 py-8 text-center text-sm text-muted-foreground">
              该剧本包是旧版格式 —— 请到「剧本产出」阶段点「重新产出（新版格式）」后再来审阅。
            </div>
          ) : (
            <div className="space-y-4">
              {activePack.episodes.map((ep) => (
                <div key={ep.epNo} className="space-y-2">
                  <EpisodeDoc script={ep} />
                  <BeatMirrorView mirror={ep.mirror} />
                </div>
              ))}
              <p className="mono-label text-[10px] text-destructive">投流素材 · 完整单集 · 不连贯</p>
              {activePack.promoClips.map((c) => (
                <div key={c.id} className="border border-destructive/40 bg-destructive/5 px-4 py-4">
                  <p className="mono-label text-[9px] text-destructive">
                    {c.promoName} · 落在第{c.epNo}集 · {c.positionHint}
                  </p>
                  <p className="mt-0.5 text-sm font-medium">
                    第{c.epNo}集{c.episode.titleZh ? ` · ${c.episode.titleZh}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.premise}</p>
                  <div className="mt-3 space-y-5">
                    {c.episode.scenes.map((sc) => <SceneBlock key={sc.sceneNo} epNo={c.epNo} sc={sc} highlight />)}
                  </div>
                  <div className="mt-3 border border-l-2 border-border border-l-destructive bg-card/60 px-3 py-2">
                    <p className="mono-label text-[9px] text-destructive">Hook Line · 大字幕金句</p>
                    <p className="font-script mt-0.5 text-sm">&ldquo;{c.hookLine}&rdquo;</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">（{c.hookLineZh}）</p>
                  </div>
                  <div className="mt-3">
                    <BeatMirrorView mirror={c.episode.mirror} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
