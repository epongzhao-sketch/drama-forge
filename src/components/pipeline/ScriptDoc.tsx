// 剧本渲染与导出的共享组件：中英双语，连贯集 & 投流素材段共用同一套视觉语言
// 英文 = 拍摄稿，中文 = 审阅稿（与英文逐条对应）
import type { EpisodeScript, ScriptScene } from "@contracts/pipeline";

export function formatScript(s: EpisodeScript): string {
  const lines: string[] = [];
  lines.push(`EPISODE ${s.epNo} — "${s.title}" / 第 ${s.epNo} 集《${s.titleZh}》`);
  lines.push("");
  for (const sc of s.scenes) {
    lines.push(`[SCENE ${sc.sceneNo}] ${sc.location} — ${sc.time} ｜ 场景${sc.sceneNo} ${sc.locationZh} — ${sc.timeZh}`);
    for (const b of sc.beats) {
      if (b.type === "dialogue") {
        lines.push(`${b.character ?? "?"}: ${b.en}`);
        lines.push(`    ${b.character ?? "?"}：${b.zh}`);
      } else {
        lines.push(`(${b.en})`);
        lines.push(`    （${b.zh}）`);
      }
    }
    lines.push("");
  }
  lines.push(`[CLIFFHANGER] ${s.cliffhanger}`);
  lines.push(`【本集悬念】${s.cliffhangerZh}`);
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
        Scene {sc.sceneNo} · {sc.location} · {sc.time}
      </p>
      <p className="pl-3 text-[11px] text-muted-foreground">{sc.locationZh} — {sc.timeZh}</p>
      <div className="mt-3 space-y-3">
        {sc.beats.map((b, i) =>
          b.type === "dialogue" ? (
            <div key={i} className="flex gap-3 pl-3">
              <span className="font-mono2 w-20 shrink-0 pt-0.5 text-right text-xs font-semibold text-foreground/80">
                {b.character}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-script text-[15px] leading-6">{b.en}</p>
                <p className="mt-0.5 text-[13px] leading-6 text-muted-foreground">{b.zh}</p>
              </div>
            </div>
          ) : (
            <div key={i} className="pl-3">
              <p className="font-script text-sm leading-6 text-muted-foreground">▪ {b.en}</p>
              <p className="mt-0.5 pl-3 text-[13px] leading-6 text-muted-foreground/70">（{b.zh}）</p>
            </div>
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
        <h3 className="mt-1 text-lg font-semibold">EP{script.epNo} · {script.title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{script.titleZh}</p>
      </div>
      <div className="space-y-5 px-4 py-5 md:px-6">
        {script.scenes.map((sc) => (
          <SceneBlock key={sc.sceneNo} sc={sc} />
        ))}
        <div className="border border-l-2 border-border border-l-destructive bg-destructive/5 px-4 py-3">
          <p className="mono-label text-[9px] text-destructive">Cliffhanger · 本集悬念</p>
          <p className="font-script mt-1 text-sm leading-relaxed">{script.cliffhanger}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{script.cliffhangerZh}</p>
        </div>
      </div>
    </div>
  );
}
