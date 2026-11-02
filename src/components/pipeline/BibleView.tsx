import { trpc } from "@/providers/trpc";
import type { BibleResult } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import { ErrorBox, Generating, Led } from "@/components/chrome";
import { RefreshCw, BookOpen } from "lucide-react";

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-border bg-card/60 px-4 py-3.5">
      <p className="mono-label text-[10px]">{label}</p>
      <div className="mt-2 text-sm leading-relaxed text-foreground/90">{children}</div>
    </div>
  );
}

export function BibleView({
  projectId,
  bible,
  ready,
  onDone,
}: {
  projectId: number;
  bible: BibleResult | null;
  ready: boolean;
  onDone: () => void;
}) {
  const genMut = trpc.pipeline.generateBible.useMutation({ onSuccess: onDone });

  if (!bible) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-4 border border-dashed border-border px-6 py-16 text-center">
          <BookOpen className="h-8 w-8 text-primary" />
          <div>
            <p className="font-medium">总纲尚未生成</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              完成「AI 拆解」和「换皮设定」后，在设定页点击「保存并生成总纲」，或在此直接生成。
            </p>
          </div>
          {genMut.isPending ? (
            <Generating text="正在生成总纲（Series Bible）…" />
          ) : (
            <Button onClick={() => genMut.mutate({ projectId })} disabled={!ready} className="h-11 px-6">
              {ready ? "生成总纲" : "请先完成拆解与换皮设定"}
            </Button>
          )}
        </div>
        {genMut.error && <ErrorBox message={genMut.error.message} onRetry={() => genMut.mutate({ projectId })} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="mono-label flex items-center gap-2">
          <Led tone="mint" /> Series Bible · 总纲
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => genMut.mutate({ projectId })}
          disabled={genMut.isPending}
          className="h-9 gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${genMut.isPending ? "animate-spin" : ""}`} />
          {genMut.isPending ? "生成中…" : "重新生成"}
        </Button>
      </div>
      {genMut.isPending && <Generating text="正在重新生成总纲…" />}
      {genMut.error && <ErrorBox message={genMut.error.message} />}

      {/* 剧名横幅 */}
      <div className="border border-primary/30 bg-primary/5 px-5 py-6">
        <p className="mono-label text-[10px] text-primary">Title</p>
        <h2 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight">{bible.titleZh}</h2>
        <p className="font-mono2 mt-1 text-sm text-muted-foreground">{bible.titleEn}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <p className="text-sm leading-relaxed">{bible.loglineZh}</p>
          <p className="font-script text-sm leading-relaxed text-muted-foreground">{bible.loglineEn}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Block label="世界观">{bible.worldview}</Block>
        <Block label="主线冲突">{bible.mainConflict}</Block>
      </div>

      <Block label={`人物表 · ${bible.characters.length} 人`}>
        <div className="grid gap-2 md:grid-cols-2">
          {bible.characters.map((c, i) => (
            <div key={i} className="border border-border bg-background/40 px-3.5 py-3">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-primary">{c.name}</span>
                <span className="mono-label text-[9px]">{c.role}</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{c.bio}</p>
            </div>
          ))}
        </div>
      </Block>

      <div className="grid gap-3 md:grid-cols-2">
        <Block label="调性与风格">{bible.toneAndStyle}</Block>
        <Block label="单集结构公式">{bible.episodeFormula}</Block>
      </div>
    </div>
  );
}
