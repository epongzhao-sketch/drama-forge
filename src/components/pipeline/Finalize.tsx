// 编审定稿阶段：审阅各入选方案的剧本包 → 判档质检 → 选定最终 1 个
import { useState } from "react";
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
  const evalMut = trpc.pipeline.evaluatePack.useMutation({ onSuccess: onDone });

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
            <Button size="sm" variant="secondary" disabled={!activePack || legacy || evalMut.isPending}
              onClick={() => evalMut.mutate({ projectId, conceptId: activeId })}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {evalMut.isPending ? "判档质检中…" : "判档质检"}
            </Button>
            <Button size="sm" disabled={!activePack || legacy || finalMut.isPending || isFinal(activeId)}
              onClick={() => finalMut.mutate({ projectId, conceptId: activeId })}>
              {isFinal(activeId) ? "✓ 已定稿" : "选定此方案为最终成品"}
            </Button>
            {finalMut.error && <ErrorBox message={finalMut.error.message} />}
            {evalMut.error && <ErrorBox message={evalMut.error.message} />}
          </div>
          {evalMut.isPending && <Generating text="判档质检中（建议性报告）…" />}
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
