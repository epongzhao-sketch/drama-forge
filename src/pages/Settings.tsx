// 账号与用量设置：绑定开放平台 Key（BYOK）、点数余额、充值、用量记录
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { AppHeader, ErrorBox } from "@/components/chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Wallet, Zap, Trash2, Check, RefreshCw } from "lucide-react";

function fmt(n: number) {
  return n.toLocaleString();
}

export default function Settings() {
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.wallet.status.useQuery();
  const { data: logs } = trpc.wallet.usageLogs.useQuery({ limit: 20 });
  const { data: txs } = trpc.wallet.transactions.useQuery({ limit: 20 });

  const [keyInput, setKeyInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const invalidate = () => {
    void utils.wallet.status.invalidate();
    void utils.wallet.usageLogs.invalidate();
    void utils.wallet.transactions.invalidate();
  };

  const setKeyMut = trpc.wallet.setApiKey.useMutation({
    onSuccess: () => {
      setKeyInput("");
      setMsg("Key 已绑定，之后的 AI 调用将走你的开放平台账号（模型费从你的余额扣）");
      invalidate();
    },
  });
  const clearKeyMut = trpc.wallet.clearApiKey.useMutation({
    onSuccess: () => {
      setMsg("已解绑，之后走站点代购通道（按点数计费）");
      invalidate();
    },
  });
  const rechargeMut = trpc.wallet.recharge.useMutation({
    onSuccess: () => {
      setMsg("充值成功，点数已入账");
      invalidate();
    },
  });

  const err = setKeyMut.error ?? clearKeyMut.error ?? rechargeMut.error;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-6">
        <div>
          <h1 className="text-xl font-semibold">账号与用量</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI 调用的模型费用与点数。绑定自己的开放平台 Key 后，模型费直接从你的 Kimi 余额扣；
            平台另按实际用量收取 {status?.serviceFeePct ?? 25}% 服务费（折算成点数）维持站点运营。
          </p>
        </div>

        {err && <ErrorBox message={err.message} />}
        {msg && (
          <div className="panel flex items-center gap-2 border-[hsl(var(--mint))]/40 bg-[hsl(var(--mint))]/10 px-4 py-3 text-xs text-[hsl(var(--mint))]">
            <Check className="h-3.5 w-3.5" /> {msg}
          </div>
        )}

        {/* 点数余额 */}
        <section className="panel px-5 py-5">
          <p className="mono-label flex items-center gap-1.5 text-[10px] text-primary">
            <Wallet className="h-3.5 w-3.5" /> Credits · 点数余额
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums">
            {isLoading ? "…" : fmt(status?.balance ?? 0)}
            <span className="ml-2 text-sm font-normal text-muted-foreground">点</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            点数 = 实际模型 token 消耗 × {status?.markup ?? 1.25}（含 {status?.serviceFeePct ?? 25}% 平台服务费）
          </p>

          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-foreground/80">充值点数</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(status?.rechargeTiers ?? []).map((t) => (
                <button
                  key={t.cny}
                  onClick={() => rechargeMut.mutate({ tierCny: t.cny })}
                  disabled={rechargeMut.isPending}
                  className="panel flex flex-col items-center gap-0.5 px-3 py-3 transition-colors hover:border-primary/50"
                >
                  <span className="text-sm font-semibold">¥{t.cny}</span>
                  <span className="mono-label text-[9px] text-muted-foreground">{fmt(t.credits)} 点</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              当前为站内模拟充值（接真实支付后此处走支付回调入账）。
            </p>
          </div>
        </section>

        {/* BYOK 绑定 */}
        <section className="panel px-5 py-5">
          <p className="mono-label flex items-center gap-1.5 text-[10px] text-primary">
            <KeyRound className="h-3.5 w-3.5" /> Bring Your Own Key · 自带开放平台 Key
          </p>

          {status?.hasKey ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between border border-border bg-muted/30 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">已绑定 Key</p>
                  <p className="font-mono2 text-xs text-muted-foreground">{status.keyPreview}</p>
                </div>
                <span className="mono-label border border-[hsl(var(--mint))]/50 bg-[hsl(var(--mint))]/10 px-2 py-0.5 text-[9px] text-[hsl(var(--mint))]">
                  BYOK 通道
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                你的 AI 调用正通过此 Key 直连 Kimi 开放平台，模型费从你的余额扣；平台服务费仍以点数计。
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={clearKeyMut.isPending}
                onClick={() => clearKeyMut.mutate()}
              >
                <Trash2 className="h-3.5 w-3.5" /> 解绑 Key
              </Button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                绑定后模型费走你自己的开放平台余额（通常更划算）；不绑则走站点代购通道，全部按点数计。
                Key 仅加密存储在服务端，绝不回显、绝不进入前端。
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="kimi-key">Kimi 开放平台 API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="kimi-key"
                    type="password"
                    placeholder="sk-..."
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                  />
                  <Button
                    disabled={!keyInput.trim() || setKeyMut.isPending}
                    onClick={() => setKeyMut.mutate({ apiKey: keyInput.trim() })}
                  >
                    {setKeyMut.isPending ? "绑定中…" : "绑定"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  在 platform.moonshot.cn → API Key 管理 创建。Key 以 sk- 开头。
                </p>
              </div>
            </div>
          )}
        </section>

        {/* 用量记录 */}
        <section className="panel px-5 py-5">
          <p className="mono-label mb-3 flex items-center gap-1.5 text-[10px] text-primary">
            <Zap className="h-3.5 w-3.5" /> Usage · 最近用量
          </p>
          {!logs || logs.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">还没有 AI 调用记录</p>
          ) : (
            <div className="space-y-1.5">
              {logs.map((l) => (
                <div key={l.id} className="flex items-center justify-between border-b border-border/50 pb-1.5 text-xs last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="mono-label border border-border bg-muted/40 px-1.5 py-0.5 text-[9px]">{l.action}</span>
                    <span className={`mono-label px-1.5 py-0.5 text-[9px] ${l.via === "byok" ? "bg-[hsl(var(--mint))]/10 text-[hsl(var(--mint))]" : "bg-secondary text-muted-foreground"}`}>
                      {l.via === "byok" ? "自带 Key" : "站点代购"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 tabular-nums text-muted-foreground">
                    <span>{fmt(l.inputTokens)}+{fmt(l.outputTokens)} tok</span>
                    <span className="font-medium text-foreground/80">-{fmt(l.creditsCharged)} 点</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 钱包流水 */}
        <section className="panel px-5 py-5">
          <p className="mono-label mb-3 flex items-center gap-1.5 text-[10px] text-primary">
            <RefreshCw className="h-3.5 w-3.5" /> Transactions · 钱包流水
          </p>
          {!txs || txs.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">还没有流水</p>
          ) : (
            <div className="space-y-1.5">
              {txs.map((t) => (
                <div key={t.id} className="flex items-center justify-between border-b border-border/50 pb-1.5 text-xs last:border-0">
                  <div>
                    <span className={`mono-label px-1.5 py-0.5 text-[9px] ${
                      t.kind === "recharge" ? "bg-[hsl(var(--mint))]/10 text-[hsl(var(--mint))]" :
                      t.kind === "consume" ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground"
                    }`}>
                      {t.kind === "recharge" ? "充值" : t.kind === "consume" ? "消费" : "调整"}
                    </span>
                    {t.note && <span className="ml-2 text-muted-foreground">{t.note}</span>}
                  </div>
                  <div className="flex items-center gap-3 tabular-nums">
                    <span className={t.delta > 0 ? "text-[hsl(var(--mint))]" : "text-foreground/80"}>
                      {t.delta > 0 ? "+" : ""}{fmt(t.delta)}
                    </span>
                    <span className="text-muted-foreground">余 {fmt(t.balanceAfter)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
