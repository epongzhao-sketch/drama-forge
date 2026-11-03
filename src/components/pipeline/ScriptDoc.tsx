// 剧本渲染与导出的共享组件：连贯集 & 投流素材段共用同一套视觉语言
import type { EpisodeScript, ScriptScene } from "@contracts/pipeline";

export function formatScript(s: EpisodeScript): string {
  const lines: string[] = [];
  lines.push(`第 ${s.epNo} 集《${s.title}》`);
  lines.push("");
  for (const sc of s.scenes) {
    lines.push(`【场景 ${sc.sceneNo}】${sc.location} — ${sc.time}`);
    for (const b of sc.beats) {
      if (b.type === "dialogue") lines.push(`${b.character ?? "?"}：${b.text}`);
      else lines.push(`（${b.text}）`);
    }
    lines.push("");
  }
  lines.push(`【本集悬念】${s.cliffhanger}`);
  return lines.join("\n");
}

export function formatScene(sc: ScriptScene): string {
  const lines: string[] = [`【场景 ${sc.sceneNo}】${sc.location} — ${sc.time}`];
  for (const b of sc.beats) {
    if (b.type === "dialogue") lines.push(`${b.character ?? "?"}：${b.text}`);
    else lines.push(`（${b.text}）`);
  }
  return lines.join("\n");
}

export function SceneBlock({ sc, highlight }: { sc: ScriptScene; highlight?: boolean }) {
  return (
    <div>
      <p
        className={`font-mono2 border-l-2 pl-3 text-xs font-semibold uppercase tracking-wider ${
          highlight ? "border-destructive text-destructive" : "border-primary text-primary"
        }`}
      >
        场景 {sc.sceneNo} · {sc.location} · {sc.time}
      </p>
      <div className="mt-3 space-y-2.5">
        {sc.beats.map((b, i) =>
          b.type === "dialogue" ? (
            <div key={i} className="flex gap-3 pl-3">
              <span className="font-mono2 w-20 shrink-0 pt-0.5 text-right text-xs font-semibold text-foreground/80">
                {b.character}
              </span>
              <p className="font-script min-w-0 flex-1 text-[15px] leading-7">{b.text}</p>
            </div>
          ) : (
            <p key={i} className="font-script pl-3 text-sm leading-7 text-muted-foreground">
              ▪ {b.text}
            </p>
          ),
        )}
      </div>
    </div>
  );
}

export function EpisodeDoc({ script }: { script: EpisodeScript }) {
  return (
    <div className="border border-border bg-card/70">
      <div className="border-b border-border px-4 py-3">
        <p className="mono-label text-[10px] text-primary">EPISODE {script.epNo}</p>
        <h3 className="mt-1 text-lg font-semibold">第 {script.epNo} 集 · {script.title}</h3>
      </div>
      <div className="space-y-5 px-4 py-5 md:px-6">
        {script.scenes.map((sc) => (
          <SceneBlock key={sc.sceneNo} sc={sc} />
        ))}
        <div className="border border-l-2 border-border border-l-destructive bg-destructive/5 px-4 py-3">
          <p className="mono-label text-[9px] text-destructive">Cliffhanger</p>
          <p className="font-script mt-1 text-sm leading-relaxed">{script.cliffhanger}</p>
        </div>
      </div>
    </div>
  );
}
