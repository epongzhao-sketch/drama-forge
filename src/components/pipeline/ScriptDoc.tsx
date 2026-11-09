// 剧本渲染与导出的共享组件：中文短剧工作稿格式
// 场景头「集-场  日/夜  内/外  地点」+ 出场人物；▲ 动作行；台词 角色(情绪): "EN"（中文）；【字幕】【特效】
import { useState } from "react";
import type { EpisodeScript, ScriptScene, ScriptBeat, BeatMirror } from "@contracts/pipeline";
import { GitCompareArrows } from "lucide-react";

const CN_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** 1→一，12→十二，21→二十一，60→六十 */
export function cnNum(n: number): string {
  if (n <= 10) return CN_NUM[n];
  if (n < 20) return `十${CN_NUM[n - 10]}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${CN_NUM[tens]}十${ones ? CN_NUM[ones] : ""}`;
}

export function sceneHeader(epNo: number, sc: ScriptScene): string {
  return `${epNo}-${sc.sceneNo}  ${sc.timeOfDay}  ${sc.intExt}  ${sc.location}`;
}

/** 模型有时会把 ▲ / 【】 直接写进文本，渲染与导出前统一剥掉 */
function cleanAction(zh: string): string {
  return zh.replace(/^[▲\s]+/, "");
}
function cleanNote(zh: string): string {
  return zh.replace(/^【+/, "").replace(/】+$/, "");
}

function formatBeat(b: ScriptBeat): string {
  switch (b.type) {
    case "dialogue":
      return b.isVo
        ? `${b.character ?? "？"} (vo): "${b.en ?? ""}"（${b.zh}）`
        : `${b.character ?? "？"}${b.mood ? `(${b.mood})` : ""}: "${b.en ?? ""}"（${b.zh}）`;
    case "caption":
      return `【字幕: ${b.en ?? ""}】（${b.zh}）`;
    case "note":
      return `【${cleanNote(b.zh)}】`;
    default:
      return `▲ ${cleanAction(b.zh)}`;
  }
}

export function formatScript(s: EpisodeScript): string {
  const lines: string[] = [];
  lines.push(`第${cnNum(s.epNo)}集${s.titleZh ? `《${s.titleZh}》` : ""}${s.title ? `（${s.title}）` : ""}`);
  for (const sc of s.scenes) {
    lines.push("");
    lines.push(sceneHeader(s.epNo, sc));
    if (sc.cast?.length) lines.push(`出场人物: ${sc.cast.join("、")}`);
    for (const b of sc.beats) lines.push(formatBeat(b));
  }
  return lines.join("\n");
}

/** 是否为旧版格式的剧本包（无方向卡/人物小传/集纲），需要重新产出 */
export function isLegacyPack(pack: { directionCard?: unknown; characters?: unknown; outline?: unknown }): boolean {
  return !pack.directionCard || !pack.characters || !pack.outline;
}

function BeatLine({ b }: { b: ScriptBeat }) {
  if (b.type === "dialogue") {
    return (
      <div className="flex gap-2 pl-3">
        <span className="w-24 shrink-0 pt-0.5 text-right text-xs font-semibold text-foreground/80">
          {b.character}
          {b.isVo ? (
            <span className="block text-[10px] font-normal italic text-primary/80">(vo)</span>
          ) : (
            b.mood && <span className="block text-[10px] font-normal text-muted-foreground">({b.mood})</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-script text-[15px] leading-6 ${b.isVo ? "italic text-foreground/75" : ""}`}>&ldquo;{b.en}&rdquo;</p>
          <p className="mt-0.5 text-[13px] leading-6 text-muted-foreground">（{b.zh}）</p>
        </div>
      </div>
    );
  }
  if (b.type === "caption") {
    return (
      <div className="border border-dashed border-primary/40 bg-primary/5 px-3 py-1.5">
        <p className="font-script text-sm font-medium tracking-wide">【字幕: {b.en}】</p>
        <p className="text-[12px] text-muted-foreground">（{b.zh}）</p>
      </div>
    );
  }
  if (b.type === "note") {
    return <p className="pl-3 text-[13px] italic leading-6 text-muted-foreground/80">【{cleanNote(b.zh)}】</p>;
  }
  return <p className="pl-3 text-sm leading-6 text-foreground/85">▲ {cleanAction(b.zh)}</p>;
}

export function SceneBlock({ epNo, sc, highlight }: { epNo: number; sc: ScriptScene; highlight?: boolean }) {
  return (
    <div>
      <p
        className={`border-l-2 pl-3 text-xs font-semibold tracking-wide ${
          highlight ? "border-destructive text-destructive" : "border-primary text-primary"
        }`}
      >
        {sceneHeader(epNo, sc)}
      </p>
      {sc.cast?.length > 0 && (
        <p className="pl-3 text-[11px] text-muted-foreground">出场人物: {sc.cast.join("、")}</p>
      )}
      <div className="mt-3 space-y-2.5">
        {sc.beats.map((b, i) => (
          <BeatLine key={i} b={b} />
        ))}
      </div>
    </div>
  );
}

export function EpisodeDoc({ script }: { script: EpisodeScript }) {
  return (
    <div className="border border-border bg-card/70">
      <div className="border-b border-border px-4 py-3">
        <p className="mono-label text-[10px] text-primary">EPISODE {script.epNo}</p>
        <h3 className="mt-1 text-lg font-semibold">
          第{cnNum(script.epNo)}集{script.titleZh ? ` · ${script.titleZh}` : ""}
        </h3>
        {script.title && <p className="mt-0.5 text-xs text-muted-foreground">{script.title}</p>}
      </div>
      <div className="space-y-5 px-4 py-5 md:px-6">
        {script.scenes.map((sc) => (
          <SceneBlock key={sc.sceneNo} epNo={script.epNo} sc={sc} />
        ))}
      </div>
    </div>
  );
}

/** 节拍镜像对照：新剧本集逐拍对齐原作的哪个节拍（左原作功能 / 右新剧落法） */
export function BeatMirrorView({ mirror }: { mirror?: BeatMirror }) {
  const [open, setOpen] = useState(false);
  if (!mirror || mirror.mapping.length === 0) return null;
  return (
    <div className="border border-primary/30 bg-primary/5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-primary/10"
      >
        <GitCompareArrows className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium text-primary">
          节拍镜像对照 · 复刻原作 EP{mirror.sourceEpNo}（{mirror.mapping.length} 拍对齐）
        </span>
        <span className="mono-label ml-auto text-[10px] text-muted-foreground">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-primary/20 px-3.5 py-3">
          {mirror.mapping.map((m, i) => (
            <div key={i} className="grid gap-1.5 text-xs sm:grid-cols-2">
              <p className="border border-border bg-card/60 px-2.5 py-1.5 leading-relaxed text-muted-foreground">
                <span className="mono-label mr-1.5 text-[9px]">原作</span>
                {m.sourceBeat}
              </p>
              <p className="border border-primary/30 bg-card/60 px-2.5 py-1.5 leading-relaxed text-foreground/85">
                <span className="mono-label mr-1.5 text-[9px] text-primary">新剧</span>
                {m.newBeat}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
