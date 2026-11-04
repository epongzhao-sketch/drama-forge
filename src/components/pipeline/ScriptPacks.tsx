// 剧本产出阶段：为每个入选方案生成「方向卡 + 人物小传 + 3~5 集连贯剧本 + 2 段不连贯投流素材」
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import type { RemapPool, ConceptScriptPack, PromoClip, DirectionCard, CharacterBio } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import { ErrorBox, Generating } from "@/components/chrome";
import { EpisodeDoc, SceneBlock, formatScript, isLegacyPack } from "@/components/pipeline/ScriptDoc";
import { Clapperboard, Copy, Download, Scissors, Check, Lock, Users } from "lucide-react";

function DirectionCardView({ card }: { card: DirectionCard }) {
  return (
    <section className="panel px-4 py-4 md:px-5">
      <p className="mono-label text-[10px] text-primary">Direction Card · 方向卡</p>
      <div className="mt-3 space-y-3 text-[13px] leading-relaxed">
        <div className="rounded border border-[hsl(var(--mint))]/40 bg-[hsl(var(--mint))]/10 px-3 py-2">
          <p className="mono-label flex items-center gap-1 text-[9px] text-[hsl(var(--mint))]">
            <Lock className="h-3 w-3" /> 核心期待 · 锁定
          </p>
          <p className="mt-1 text-foreground/90">{card.expectation}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {card.elements.map((e) => (
            <span key={e} className="mono-label border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {e}
            </span>
          ))}
        </div>
        <p><span className="font-semibold text-foreground/80">忍的代价（写死）：</span>{card.enduranceCost}</p>
        {card.clock && <p><span className="font-semibold text-foreground/80">时钟：</span>{card.clock}</p>}
        {card.mastermind && <p><span className="font-semibold text-foreground/80">真正的反派：</span>{card.mastermind}</p>}
        <p><span className="font-semibold text-foreground/80">「不得不破戒」的触发点：</span>{card.breakingPoint}</p>
        <p><span className="font-semibold text-foreground/80">强弱格局：</span>{card.powerMap}</p>
      </div>
    </section>
  );
}

function BioCard({ c }: { c: CharacterBio }) {
  const rows: [string, string | undefined][] = [
    ["真实身份", c.realIdentity],
    ["表面身份", c.coverIdentity],
    ["前史", c.backstory],
    ["性格", c.personality],
    ["欲望", c.desire],
    ["弱点", c.weakness],
    ["武器/筹码", c.weapon],
    ["弧光", c.arc],
    ["强弱定位", c.powerPosition],
    ["反派三查", c.villainCheck],
  ];
  return (
    <div className="border border-border bg-card/70 px-4 py-3">
      <p className="text-sm font-semibold">
        【{c.name}｜{c.nameZh}】
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
          {c.role}
          {c.age ? `，${c.age}` : ""}
        </span>
      </p>
      <div className="mt-2 space-y-1">
        {rows.map(([k, v]) =>
          v ? (
            <p key={k} className="text-xs leading-relaxed text-muted-foreground">
              <span className="text-foreground/70">{k}：</span>
              {v}
            </p>
          ) : null,
        )}
      </div>
    </div>
  );
}

function CharacterBiosView({ characters }: { characters: CharacterBio[] }) {
  return (
    <section>
      <p className="mono-label mb-3 flex items-center gap-1.5 text-[10px] text-primary">
        <Users className="h-3 w-3" /> Character Bios · 人物小传（{characters.length}）
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {characters.map((c) => (
          <BioCard key={`${c.name}-${c.role}`} c={c} />
        ))}
      </div>
    </section>
  );
}

function PromoClipDoc({ clip }: { clip: PromoClip }) {
  return (
    <div className="border border-destructive/40 bg-destructive/5">
      <div className="border-b border-destructive/30 px-4 py-3">
        <p className="mono-label text-[10px] text-destructive">投流素材 · 完整单集 · 不连贯</p>
        <h4 className="mt-1 text-sm font-semibold">{clip.promoName}</h4>
        <p className="mono-label mt-1 text-[9px] text-muted-foreground">
          落在第 {clip.epNo} 集 · {clip.positionHint}
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">{clip.premise}</p>
      </div>
      <div className="space-y-5 px-4 py-5 md:px-6">
        {clip.episode.scenes.map((sc) => (
          <SceneBlock key={sc.sceneNo} epNo={clip.epNo} sc={sc} highlight />
        ))}
        <div className="border border-l-2 border-border border-l-destructive bg-card/60 px-3 py-2">
          <p className="mono-label text-[9px] text-destructive">Hook Line · 大字幕金句</p>
          <p className="font-script mt-0.5 text-sm font-medium">&ldquo;{clip.hookLine}&rdquo;</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">（{clip.hookLineZh}）</p>
        </div>
      </div>
    </div>
  );
}

function formatDirectionCard(card: DirectionCard): string {
  const lines = ["一、方向卡"];
  lines.push(`核心期待：${card.expectation}`);
  lines.push(`元素：${card.elements.join("、")}`);
  lines.push(`忍的代价（写死）：${card.enduranceCost}`);
  if (card.clock) lines.push(`时钟：${card.clock}`);
  if (card.mastermind) lines.push(`真正的反派：${card.mastermind}`);
  lines.push(`「不得不破戒」的触发点：${card.breakingPoint}`);
  lines.push(`强弱格局：${card.powerMap}`);
  return lines.join("\n");
}

function formatBios(characters: CharacterBio[]): string {
  const lines = ["二、人物小传"];
  for (const c of characters) {
    lines.push("");
    lines.push(`【${c.name}｜${c.nameZh}】${c.role}${c.age ? `，${c.age}` : ""}`);
    if (c.realIdentity) lines.push(`真实身份：${c.realIdentity}`);
    if (c.coverIdentity) lines.push(`表面身份：${c.coverIdentity}`);
    if (c.backstory) lines.push(`前史：${c.backstory}`);
    lines.push(`性格：${c.personality}`);
    if (c.desire) lines.push(`欲望：${c.desire}`);
    if (c.weakness) lines.push(`弱点：${c.weakness}`);
    if (c.weapon) lines.push(`武器/筹码：${c.weapon}`);
    if (c.arc) lines.push(`弧光：${c.arc}`);
    if (c.powerPosition) lines.push(`强弱定位：${c.powerPosition}`);
    if (c.villainCheck) lines.push(`反派三查：${c.villainCheck}`);
  }
  return lines.join("\n");
}

export function formatPackText(pack: ConceptScriptPack): string {
  const parts: string[] = [];
  parts.push(pack.logline);
  parts.push("");
  parts.push(formatDirectionCard(pack.directionCard));
  parts.push("");
  parts.push(formatBios(pack.characters));
  parts.push("");
  parts.push("三、连贯剧本");
  parts.push(pack.episodes.map(formatScript).join("\n\n\n"));
  parts.push("");
  parts.push("四、投流素材（完整单集 · 不连贯）");
  for (const c of pack.promoClips) {
    parts.push("");
    parts.push(`【投流素材｜${c.promoName}】落在第${c.epNo}集 · ${c.positionHint}`);
    parts.push(`情境前提：${c.premise}`);
    parts.push(formatScript(c.episode));
    parts.push(`【大字幕金句】"${c.hookLine}"（${c.hookLineZh}）`);
  }
  return parts.join("\n");
}

function PackView({ pack }: { pack: ConceptScriptPack }) {
  const [copied, setCopied] = useState(false);
  const fullText = formatPackText(pack);

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
      <DirectionCardView card={pack.directionCard} />
      <CharacterBiosView characters={pack.characters} />
      <p className="mono-label text-[10px] text-primary">Episodes · 连贯剧本（{pack.episodes.length} 集）</p>
      {pack.episodes.map((ep) => <EpisodeDoc key={ep.epNo} script={ep} />)}
      <p className="mono-label flex items-center gap-1.5 text-[10px] text-destructive">
        <Scissors className="h-3 w-3" /> Promo Clips · 2 集不连贯投流素材
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
  const legacy = activePack ? isLegacyPack(activePack) : false;

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
          {(!activePack || legacy) && (
            <div className="panel px-4 py-8 text-center">
              {legacy && (
                <p className="mb-3 text-xs text-muted-foreground">
                  该剧本包是旧版格式（无方向卡/人物小传）——请重新产出，获得方向卡 + 人物小传 + 中文工作稿格式剧本。
                </p>
              )}
              <Button onClick={() => genMut.mutate({ projectId, conceptId: activeId })} disabled={genMut.isPending}>
                {genMut.isPending ? "正在产出剧本包…" : legacy ? "重新产出（新版格式）" : "产出该方案的剧本包"}
              </Button>
              {genMut.isPending && <Generating text="先定方向卡与人物小传，再写 3~5 集连贯剧本 + 2 集投流素材（约 3-4 分钟）…" />}
              {genMut.error && <ErrorBox message={genMut.error.message} />}
            </div>
          )}
          {activePack && !legacy && (
            <>
              <div className="mb-3 flex justify-end">
                <Button size="sm" variant="secondary" disabled={genMut.isPending}
                  onClick={() => genMut.mutate({ projectId, conceptId: activeId })}>
                  重新产出
                </Button>
              </div>
              {genMut.isPending && <Generating text="重新产出中（方向卡 + 人物小传 + 剧本）…" />}
              {genMut.error && <ErrorBox message={genMut.error.message} />}
              <PackView pack={activePack} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
