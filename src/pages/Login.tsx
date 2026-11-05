import { Button } from "@/components/ui/button";
import { Clapperboard } from "lucide-react";
import { PIPELINE_STAGES } from "@contracts/pipeline";

function getOAuthUrl() {
  const kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL;
  const appID = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);

  return url.toString();
}

export default function Login() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="border border-border bg-card/70 px-6 py-10 text-center backdrop-blur md:px-10">
          <span className="relative mx-auto flex h-12 w-12 items-center justify-center border border-border bg-secondary">
            <Clapperboard className="h-5 w-5 text-primary" />
            <span className="absolute -top-px -right-px h-1.5 w-1.5 bg-primary" />
          </span>
          <h1 className="mt-5 text-2xl font-bold tracking-tight">爆剧复刻舱</h1>
          <p className="mono-label mt-1.5">Drama Forge · 爆款复刻流水线</p>
          <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
            录入爆款样本，标红高能素材段 —— AI 拆解、换皮复刻，流水线产出中英双语短剧剧本。
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
            {PIPELINE_STAGES.map((s, i) => (
              <span key={s.key} className="mono-label text-[9px]">
                <span className="text-primary">{String(i + 1).padStart(2, "0")}</span> {s.label}
              </span>
            ))}
          </div>
          <Button
            className="mt-8 h-12 w-full text-base font-medium"
            onClick={() => {
              window.location.href = getOAuthUrl();
            }}
          >
            使用 Kimi 账号登录
          </Button>
          {import.meta.env.DEV && (
            <a href="/api/dev-login" className="mt-2.5 block">
              <Button variant="outline" className="h-11 w-full text-sm">
                本地开发登录（免 OAuth，仅开发环境显示）
              </Button>
            </a>
          )}
          <p className="mono-label mt-4 text-[9px]">登录后即可保存你的复刻项目库</p>
        </div>
      </div>
    </div>
  );
}
