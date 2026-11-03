// 剧本产出阶段：为每个入选方案生成「3~5 集连贯剧本 + 2 段不连贯投流素材」
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import type { RemapPool, ConceptScriptPack, PromoClip } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import { ErrorBox, Generating } from "@/components/chrome";
import { EpisodeDoc, SceneBlock, formatScript, formatScene } from "@/components/pipeline/ScriptDoc";
import { Clapperboard, Copy, Download, Scissors, Check } from "lucide-react";

function PromoClipDoc({ clip }: { clip: PromoClip }) {
  return (
    <div className="border border-destructive/40 bg-destructive/5">
      <div className="border-b border-destructive/30 px-4 py-3">
        <p className="mono-label text-[10px] text-destructive">投流素材 · 不连贯</p>
        <h4 className="mt-1 text-sm font-semibold">{clip.positionHint}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{clip.premise}</p>
      </div>
      <div className="px-4 py-4">
        <SceneBlock sc={clip.scene} highlight />
        <div className="mt-3 border border-l-2 border-border border-l-destructive bg-card/60 px-3 py-2">
          <p className="mono-label text-[9px] text-destructive">大字幕金句</p>
          <p className="font-script mt-0.5 text-sm font-medium">{clip.hookLine}</p>
        </div>
      </div>
    </div>
  );
}

function PackView({ pack }: { pack: ConceptScriptPack }) {
  const [copied, setCopied] = useState(false);
  const fullText =
    pack.episodes.map(formatScript).join("\n\n\n") +
    "\n\n\n===== 投流素材（不连贯） =====\n\n" +
    pack.promoClips.map((c) => `【${c.positionHint}】${c.premise}\n\n${formatScene(c.scene)}\n【金句】${c.hookLine}`).join("\n\n");

  const copy = async () => {
    await navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const download = () => {
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `剧本包-${pack.conceptId}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="border-l-2 border-primary/60 pl-2 text-xs text-muted-foreground">{pack.logline}</p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={download}><Download className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      {pack.episodes.map((ep) => <EpisodeDoc key={ep.epNo} script={ep} />)}
      <p className="mono-label flex items-center gap-1.5 text-[10px] text-destructive">
        <Scissors className="h-3 w-3" /> Promo Clips · 2 段不连贯投流素材
      </p>
      {pack.promoClips.map((c) => <PromoClipDoc key={c.id} clip={c} />)}
    </div>
  );
}

export function ScriptPacks({
  projectId,
  pool,
  packs,
  onDone,
}: {
  projectId: number;
  pool: RemapPool | null;
  packs: ConceptScriptPack[];
  onDone: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(pool?.selectedIds[0] ?? null);
  const genMut = trpc.pipeline.generateScriptPack.useMutation({ onSuccess: onDone });

  if (!pool || pool.selectedIds.length === 0) {
    return (
      <div className="panel px-4 py-10 text-center text-sm text-muted-foreground">
        请先在「换皮方案」阶段生成 10 个方案并粗选 3~5 个，再回来产出剧本。
      </div>
    );
  }

  const packMap = new Map(packs.map((p) => [p.conceptId, p]));
  const activePack = activeId ? packMap.get(activeId) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {pool.selectedIds.map((id) => {
          const concept = pool.concepts.find((c) => c.id === id);
          const pack = packMap.get(id);
          const generating = genMut.isPending && genMut.variables?.conceptId === id;
          return (
            <button key={id} onClick={() => setActiveId(id)}
              className={`panel flex items-center gap-2 px-3.5 py-2.5 text-left text-xs transition-colors ${
                activeId === id ? "border-primary/60 bg-primary/10" : "hover:border-primary/30"
              }`}>
              <Clapperboard className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">{concept?.title ?? id}</span>
              <span className={`mono-label px-1 py-0.5 text-[9px] ${
                pack ? "bg-[hsl(var(--mint))]/10 text-[hsl(var(--mint))]" : generating ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
              }`}>
                {pack ? "已产出" : generating ? "生成中" : "待生成"}
              </span>
            </button>
          );
        })}
      </div>

      {activeId && (
        <div>
          {!activePack && (
            <div className="panel px-4 py-8 text-center">
              <Button onClick={() => genMut.mutate({ projectId, conceptId: activeId })} disabled={genMut.isPending}>
                {genMut.isPending ? "正在产出剧本包…" : "产出该方案的剧本包"}
              </Button>
              {genMut.isPending && <Generating text="正在写 3~5 集连贯剧本 + 2 段投流素材（约 1-2 分钟）…" />}
              {genMut.error && <ErrorBox message={genMut.error.message} />}
            </div>
          )}
          {activePack && (
            <>
              <div className="mb-3 flex justify-end">
                <Button size="sm" variant="secondary" disabled={genMut.isPending}
                  onClick={() => genMut.mutate({ projectId, conceptId: activeId })}>
                  重新产出
                </Button>
              </div>
              {genMut.error && <ErrorBox message={genMut.error.message} />}
              <PackView pack={activePack} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
