// 剧本产出阶段：为每个入选方案生成「方向卡 + 人物小传 + 首卡 1~10 集全量连贯剧本（分批产出）+ 2 段不连贯投流素材」
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAiProvider } from "@/hooks/useAiProvider";
import type { RemapPool, ConceptScriptPack, PromoClip, DirectionCard, CharacterBio } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import { ErrorBox, Generating } from "@/components/chrome";
import { EpisodeDoc, SceneBlock, BeatMirrorView, formatScript, isLegacyPack } from "@/components/pipeline/ScriptDoc";
import { Clapperboard, Copy, Download, Scissors, Check, Lock, Users, ListOrdered } from "lucide-react";

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
        {(card.motifs?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mono-label text-[9px] text-muted-foreground">母题复合：</span>
            {card.motifs!.map((m) => (
              <span key={m} className="border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">{m}</span>
            ))}
          </div>
        )}
        {(card.objectHooks?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <span className="mono-label text-[9px] text-muted-foreground">贯穿物件钩（伏笔—羞辱—反转认亲）：</span>
            {card.objectHooks!.map((o, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground/80">{o.name}</span> —— {o.chain}
              </p>
            ))}
          </div>
        )}
        {card.colorCode && <p><span className="font-semibold text-foreground/80">色彩编码：</span>{card.colorCode}</p>}
      </div>
    </section>
  );
}

function BioCard({ c }: { c: CharacterBio }) {
  const rows: [string, string | undefined][] = [
    ["真实身份", c.realIdentity],
    ["表面身份", c.coverIdentity],
    ["登场字幕卡", c.captionCard],
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
      {c.arc4 && (
        <div className="mt-2 grid gap-1 border-t border-border pt-2 sm:grid-cols-4">
          {(
            [
              ["起点", c.arc4.start],
              ["转折", c.arc4.turn],
              ["高潮", c.arc4.climax],
              ["终点", c.arc4.end],
            ] as const
          ).map(([label, text]) => (
            <div key={label} className="bg-background/60 px-2 py-1.5">
              <span className="mono-label text-[9px] text-primary">{label}</span>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      )}
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

function OutlineView({ outline }: { outline: NonNullable<ConceptScriptPack["outline"]> }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? outline.beats : outline.beats.slice(0, 10);
  return (
    <section className="panel px-4 py-4 md:px-5">
      <p className="mono-label flex items-center gap-1.5 text-[10px] text-primary">
        <ListOrdered className="h-3 w-3" /> Series Outline · 全剧集纲（{outline.beats.length} 条）
      </p>
      <div className="mt-3 space-y-2 text-[13px] leading-relaxed">
        <div className="rounded border border-[hsl(var(--mint))]/40 bg-[hsl(var(--mint))]/10 px-3 py-2">
          <p className="mono-label text-[9px] text-[hsl(var(--mint))]">大期待</p>
          <p className="mt-0.5 text-foreground/90">{outline.expectation}</p>
        </div>
        <p><span className="font-semibold text-foreground/80">框架：</span>{outline.framework}</p>
        <p><span className="font-semibold text-foreground/80">核心梗：</span>{outline.coreGimmick}</p>
      </div>
      <div className="mt-3 space-y-1.5">
        {shown.map((b) => (
          <div key={b.epNo} className="flex gap-3 border border-border bg-card/50 px-3 py-2 text-xs">
            <span className={`mono-label mt-0.5 w-12 shrink-0 text-[10px] ${b.paywall ? "text-destructive" : "text-primary"}`}>
              EP{b.epNo}
              {b.paywall && <span className="ml-1 border border-destructive/50 bg-destructive/10 px-1 text-[8px]">墙</span>}
            </span>
            <div className="space-y-0.5 leading-snug">
              <p className="text-foreground/90">{b.plot}</p>
              <p className="text-muted-foreground">
                <span className="text-foreground/60">钩：</span>
                {b.hook}
              </p>
              <p className="text-muted-foreground">
                <span className="text-foreground/60">尾：</span>
                {b.cliffhanger}
              </p>
            </div>
          </div>
        ))}
      </div>
      {outline.beats.length > 10 && (
        <Button size="sm" variant="ghost" className="mt-2 h-7 text-xs" onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起" : `展开全部 ${outline.beats.length} 条`}
        </Button>
      )}
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
        <BeatMirrorView mirror={clip.episode.mirror} />
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
  if (card.motifs?.length) lines.push(`母题复合：${card.motifs.join("、")}`);
  if (card.objectHooks?.length) {
    for (const o of card.objectHooks) lines.push(`物件钩：${o.name} —— ${o.chain}`);
  }
  if (card.colorCode) lines.push(`色彩编码：${card.colorCode}`);
  return lines.join("\n");
}

function formatBios(characters: CharacterBio[]): string {
  const lines = ["二、人物小传"];
  for (const c of characters) {
    lines.push("");
    lines.push(`【${c.name}｜${c.nameZh}】${c.role}${c.age ? `，${c.age}` : ""}`);
    if (c.realIdentity) lines.push(`真实身份：${c.realIdentity}`);
    if (c.coverIdentity) lines.push(`表面身份：${c.coverIdentity}`);
    if (c.captionCard) lines.push(`登场字幕卡：${c.captionCard}`);
    if (c.backstory) lines.push(`前史：${c.backstory}`);
    lines.push(`性格：${c.personality}`);
    if (c.desire) lines.push(`欲望：${c.desire}`);
    if (c.weakness) lines.push(`弱点：${c.weakness}`);
    if (c.weapon) lines.push(`武器/筹码：${c.weapon}`);
    if (c.arc4) lines.push(`四态弧线：起点「${c.arc4.start}」→ 转折「${c.arc4.turn}」→ 高潮「${c.arc4.climax}」→ 终点「${c.arc4.end}」`);
    else if (c.arc) lines.push(`弧光：${c.arc}`);
    if (c.powerPosition) lines.push(`强弱定位：${c.powerPosition}`);
    if (c.villainCheck) lines.push(`反派三查：${c.villainCheck}`);
  }
  return lines.join("\n");
}

function formatOutline(outline: NonNullable<ConceptScriptPack["outline"]>): string {
  const lines = ["三、全剧集纲"];
  lines.push(`大期待：${outline.expectation}`);
  lines.push(`框架：${outline.framework}`);
  lines.push(`核心梗：${outline.coreGimmick}`);
  for (const b of outline.beats) {
    lines.push("");
    lines.push(`第${b.epNo}集${b.paywall ? "【付费墙】" : ""}`);
    lines.push(`钩子：${b.hook}`);
    lines.push(`剧情：${b.plot}`);
    lines.push(`集尾悬念：${b.cliffhanger}`);
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
  if (pack.outline) {
    parts.push("");
    parts.push(formatOutline(pack.outline));
  }
  parts.push("");
  parts.push(pack.outline ? "四、连贯剧本" : "三、连贯剧本");
  parts.push(pack.episodes.map(formatScript).join("\n\n\n"));
  parts.push("");
  parts.push(pack.outline ? "五、投流素材（完整单集 · 不连贯）" : "四、投流素材（完整单集 · 不连贯）");
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
      {pack.outline && <OutlineView outline={pack.outline} />}
      <p className="mono-label text-[10px] text-primary">Episodes · 连贯剧本（{pack.episodes.length} 集）</p>
      {pack.episodes.map((ep) => (
        <div key={ep.epNo} className="space-y-2">
          <EpisodeDoc script={ep} />
          <BeatMirrorView mirror={ep.mirror} />
        </div>
      ))}
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
  const startMut = trpc.packJobs.start.useMutation();
  const { activeId: providerId } = useAiProvider();
  const utils = trpc.useUtils();
  const [progress, setProgress] = useState<{ conceptId: string; text: string } | null>(null);
  const [jobError, setJobError] = useState<{ conceptId: string; message: string } | null>(null);

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
  const busyId = progress?.conceptId ?? null;

  // 异步产出：提交任务秒回，服务端后台逐步执行（每步落库），这里只轮询进度。
  // 根治平台代理掐断长请求（Load failed）——页面关闭/刷新/断网都不影响产出，随时回来查看。
  const runPack = async (conceptId: string, force = false) => {
    setJobError(null);
    try {
      setProgress({ conceptId, text: "提交产出任务…" });
      await startMut.mutateAsync({ projectId, conceptId, force, providerId });
      for (;;) {
        await new Promise((r) => setTimeout(r, 8000));
        const st = await utils.packJobs.status.fetch({ projectId, conceptId });
        if (st.status === "done") {
          setProgress(null);
          onDone();
          return;
        }
        if (st.status === "failed") {
          setProgress(null);
          setJobError({ conceptId, message: st.error ?? "产出失败" });
          return;
        }
        if (st.status === "running") {
          const total = st.totalSteps || 4;
          setProgress({
            conceptId,
            text: `第 ${Math.min(st.stepIndex + 1, total)}/${total} 步：${st.stepLabel}…${
              st.attempt ? `（本步自动重试第 ${st.attempt} 次）` : ""
            }`,
          });
        }
      }
    } catch (e) {
      setProgress(null);
      setJobError({ conceptId, message: e instanceof Error ? e.message : "提交失败" });
    }
  };

  const statusBadge = (id: string) => {
    const pack = packMap.get(id);
    const generating = busyId === id;
    if (pack && pack.status === "done") return { cls: "bg-[hsl(var(--mint))]/10 text-[hsl(var(--mint))]", text: "已产出" };
    if (pack?.status === "generating") return { cls: "bg-primary/10 text-primary", text: generating ? "生成中" : "产出中（可继续）" };
    if (generating) return { cls: "bg-primary/10 text-primary", text: "生成中" };
    return { cls: "bg-secondary text-muted-foreground", text: "待生成" };
  };

  const buttonLabel = (id: string): string => {
    if (busyId === id) return "正在产出剧本包…";
    const pack = packMap.get(id);
    if (pack?.status === "generating") return "继续产出（从断点续跑）";
    if (pack?.status === "done") return "重新产出";
    if (legacy) return "重新产出（新版格式）";
    return "产出该方案的剧本包";
  };
  const buttonForce = (id: string): boolean => {
    const pack = packMap.get(id);
    return pack?.status === "done" || legacy;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {pool.selectedIds.map((id) => {
          const concept = pool.concepts.find((c) => c.id === id);
          const badge = statusBadge(id);
          return (
            <button key={id} onClick={() => setActiveId(id)}
              className={`panel flex items-center gap-2 px-3.5 py-2.5 text-left text-xs transition-colors ${
                activeId === id ? "border-primary/60 bg-primary/10" : "hover:border-primary/30"
              }`}>
              <Clapperboard className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">{concept?.title ?? id}</span>
              <span className={`mono-label px-1 py-0.5 text-[9px] ${badge.cls}`}>{badge.text}</span>
            </button>
          );
        })}
      </div>

      {activeId && (
        <div>
          {(!activePack || legacy || activePack.status === "generating") && (
            <div className="panel px-4 py-8 text-center">
              {legacy && (
                <p className="mb-3 text-xs text-muted-foreground">
                  该剧本包是旧版格式——重新产出后可获得小黑DNA新版结构：方向卡（含母题复合/物件钩/色彩编码）+ 人物小传（四态弧线+登场字幕卡）+ 全剧集纲（付费墙布局）+ 中文工作稿剧本。
                </p>
              )}
              {activePack?.status === "generating" && !legacy && (
                <p className="mb-3 text-xs text-muted-foreground">
                  该方案已有产出进度（已落库 {activePack.episodes?.length ?? 0} 集）——继续产出只会补未完成的部分，不会重复。
                </p>
              )}
              <Button onClick={() => void runPack(activeId, buttonForce(activeId))} disabled={!!busyId}>
                {buttonLabel(activeId)}
              </Button>
              {progress?.conceptId === activeId && (
                <Generating text={`${progress.text}（全程约 15-40 分钟；服务端后台产出，页面可关闭，随时回来查看进度）`} />
              )}
              {jobError?.conceptId === activeId && !progress && (
                <>
                  <ErrorBox message={jobError.message} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    任务已在服务端保留断点，点上方按钮重试即可从断点继续，已完成的步骤不会重复。
                  </p>
                </>
              )}
            </div>
          )}
          {activePack && !legacy && activePack.status === "done" && (
            <>
              <div className="mb-3 flex justify-end">
                <Button size="sm" variant="secondary" disabled={!!busyId}
                  onClick={() => void runPack(activeId, buttonForce(activeId))}>
                  {buttonLabel(activeId)}
                </Button>
              </div>
              {progress?.conceptId === activeId && <Generating text={`${progress.text}（全程约 15-40 分钟）`} />}
              {jobError?.conceptId === activeId && <ErrorBox message={jobError.message} />}
              <PackView pack={activePack} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
