import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, Clapperboard, Wallet } from "lucide-react";
import { Link, useNavigate } from "react-router";

export function Led({ tone, pulse }: { tone?: "amber" | "mint" | "red"; pulse?: boolean }) {
  const cls = tone === "amber" ? "led-amber" : tone === "mint" ? "led-mint" : tone === "red" ? "led-red" : "";
  return <span className={`led ${cls} ${pulse ? "led-pulse" : ""}`} aria-hidden />;
}

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
      <span className="relative flex h-8 w-8 items-center justify-center border border-border bg-secondary">
        <Clapperboard className="h-4 w-4 text-primary" />
        <span className="absolute -top-px -right-px h-1.5 w-1.5 bg-primary" />
      </span>
      <span className="leading-none">
        <span className="block text-[15px] font-semibold tracking-wide">爆剧复刻舱</span>
        <span className="mono-label block mt-1 text-[9px]">DRAMA&nbsp;FORGE</span>
      </span>
    </Link>
  );
}

export function AppHeader({ right }: { right?: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: wallet } = trpc.wallet.status.useQuery(undefined, { enabled: !!user });
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-4 md:px-6">
        <Logo />
        <div className="hidden sm:flex items-center gap-2 ml-2 border border-border bg-secondary/60 px-2.5 py-1">
          <Led tone="mint" pulse />
          <span className="mono-label text-[10px]">Pipeline&nbsp;Online</span>
        </div>
        <div className="flex-1" />
        {right}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="h-8 w-8 border border-border">
                  <AvatarFallback className="bg-secondary text-xs font-medium text-primary">
                    {user.name?.charAt(0).toUpperCase() ?? "U"}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <DropdownMenuItem onClick={() => navigate("/settings")} className="cursor-pointer">
                <Wallet className="mr-2 h-4 w-4" />
                账号与用量
                {wallet && (
                  <span className="ml-auto mono-label text-[9px] text-muted-foreground">
                    {wallet.balance.toLocaleString()} 点
                  </span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

export function ErrorBox({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 px-3.5 py-3">
      <Led tone="red" />
      <div className="min-w-0 flex-1">
        <p className="mono-label text-[10px] text-destructive">Error</p>
        <p className="mt-1 text-sm text-foreground/90">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mono-label shrink-0 border border-border px-2.5 py-1.5 text-[10px] hover:border-primary hover:text-primary transition-colors"
        >
          重试
        </button>
      )}
    </div>
  );
}

export function Generating({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 border border-primary/30 bg-primary/5 px-4 py-6">
      <Led tone="amber" pulse />
      <div>
        <p className="text-sm text-foreground/90">{text}</p>
        <p className="mono-label mt-1 text-[10px]">AI generating — 通常需要 20-60 秒</p>
      </div>
    </div>
  );
}
