import type { EvalReport, EvalVerdict } from "@contracts/pipeline";
import { VERDICT_LABELS } from "@contracts/pipeline";
import { Ban, Compass, Gauge, Wrench } from "lucide-react";

const VERDICT_STYLE: Record<EvalVerdict, { badge: string; dot: string }> = {
  pass: {
    badge: "border-[hsl(var(--mint)/0.6)] bg-[hsl(var(--mint)/0.12)] text-[hsl(var(--mint))]",
    dot: "bg-[hsl(var(--mint))]",
  },
  pass_with_fixes: {
    badge: "border-sky-400/50 bg-sky-400/10 text-sky-300",
    dot: "bg-sky-400",
  },
  revise_resubmit: {
    badge: "border-primary/60 bg-primary/10 text-primary",
    dot: "bg-primary",
  },
  fail: {
    badge: "border-destructive/60 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
};

function ColumnHead({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: string }) {
  return (
    <p className={`mono-label flex items-center gap-1.5 text-[10px] ${tone}`}>
      {icon}
      {label}
    </p>
  );
}

export function EvalReportView({ report }: { report: EvalReport }) {
  const v = VERDICT_STYLE[report.verdict];
  return (
    <div className="space-y-3 border border-border bg-card/60 p-4">
      {/* 判定行 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={`flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold ${v.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />
          {VERDICT_LABELS[report.verdict]}
        </span>
        {report.grade && (
          <span className="border border-border bg-background/60 px-2 py-1 font-mono text-[11px] text-foreground/80">
            等级 {report.grade}
          </span>
        )}
        <span className="text-xs text-muted-foreground">{report.summary}</span>
      </div>

      {/* 核心期待核对 */}
      <div className="border border-border bg-background/40 px-3.5 py-3">
        <ColumnHead icon={<Compass className="h-3 w-3" />} label="核心期待核对" tone="text-foreground/70" />
        <p className="mt-1.5 text-xs leading-relaxed text-foreground/85">{report.coreExpectationCheck}</p>
      </div>

      {/* 三栏：阻挡项 / 优化项 / 体量与赛道 */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-2 border border-destructive/30 bg-destructive/5 px-3.5 py-3">
          <ColumnHead
            icon={<Ban className="h-3 w-3" />}
            label={`阻挡项 · ${report.blockers.length}`}
            tone="text-destructive"
          />
          {report.blockers.length === 0 ? (
            <p className="text-xs text-muted-foreground">无 —— 没有不改就不能做的问题</p>
          ) : (
            <ul className="space-y-2.5">
              {report.blockers.map((b, i) => (
                <li key={i} className="space-y-1">
                  <p className="text-xs font-medium leading-relaxed text-foreground/90">{b.issue}</p>
                  <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    <span className="mt-0.5 shrink-0 border border-destructive/40 px-1 font-mono text-[9px] text-destructive">
                      {b.level}
                    </span>
                    {b.fix}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border border-sky-400/25 bg-sky-400/5 px-3.5 py-3">
          <ColumnHead
            icon={<Wrench className="h-3 w-3" />}
            label={`优化项 · ${report.optimizations.length}`}
            tone="text-sky-300"
          />
          {report.optimizations.length === 0 ? (
            <p className="text-xs text-muted-foreground">无</p>
          ) : (
            <ul className="space-y-2.5">
              {report.optimizations.map((o, i) => (
                <li key={i} className="space-y-1">
                  <p className="text-xs font-medium leading-relaxed text-foreground/90">{o.issue}</p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{o.fix}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 border border-primary/30 bg-primary/5 px-3.5 py-3">
          <ColumnHead icon={<Gauge className="h-3 w-3" />} label="体量与赛道" tone="text-primary" />
          <p className="text-xs leading-relaxed text-foreground/85">{report.volumeTrack}</p>
        </div>
      </div>
    </div>
  );
}
