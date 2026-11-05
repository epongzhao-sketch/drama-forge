import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader, Led, ErrorBox } from "@/components/chrome";
import { PIPELINE_STAGES } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, ArrowRight, Film } from "lucide-react";

type ProjectRow = {
  id: number;
  title: string;
  sourceTitle: string | null;
  createdAt: Date;
  progress: {
    hasSample: boolean;
    selectedCount: number;
    packCount: number;
    finalId: string | null;
  };
};

function stageDone(p: ProjectRow["progress"], key: string): boolean {
  switch (key) {
    case "sample": return p.hasSample;
    case "analysis": return p.hasSample;
    case "remap": return p.selectedCount > 0;
    case "pack": return p.packCount > 0;
    case "final": return !!p.finalId;
    default: return false;
  }
}

export default function Home() {
  const { isAuthenticated, isLoading } = useAuth({ redirectOnUnauthenticated: true });
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: rows, isLoading: loading, error } = trpc.pipeline.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const createMut = trpc.pipeline.create.useMutation({
    onSuccess: async (p) => {
      await utils.pipeline.list.invalidate();
      setOpen(false);
      setTitle("");
      setSourceTitle("");
      navigate(`/project/${p.id}`);
    },
  });
  const deleteMut = trpc.pipeline.remove.useMutation({
    onSuccess: async () => {
      await utils.pipeline.list.invalidate();
      setDeleteId(null);
    },
  });

  if (isLoading) return null;

  return (
    <div className="min-h-dvh">
      <AppHeader
        right={
          <Button size="sm" onClick={() => setOpen(true)} className="h-9 gap-1.5 font-medium">
            <Plus className="h-4 w-4" />
            新建复刻项目
          </Button>
        }
      />

      <main className="mx-auto max-w-[1440px] px-4 md:px-6 py-8 md:py-12">
        {/* Hero strip */}
        <div className="mb-10 border border-border bg-card/60 px-5 py-8 md:px-10 md:py-12 relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              background:
                "repeating-linear-gradient(90deg, hsl(224 43% 16% / 0.35) 0 1px, transparent 1px 72px)",
            }}
            aria-hidden
          />
          <p className="mono-label flex items-center gap-2">
            <Led tone="amber" pulse />
            Viral Replication Pipeline · 爆款复刻流水线
          </p>
          <h1 className="mt-4 max-w-3xl text-3xl md:text-5xl font-bold leading-tight tracking-tight">
            拆解爆款基因，
            <br />
            <span className="text-primary">流水线复刻</span>下一部。
          </h1>
          <p className="mt-4 max-w-2xl text-sm md:text-base text-muted-foreground">
            录入海外爆款短剧样本，标红投流数据最好的素材段 —— AI 拆解其钩子节奏与结构，
            换皮生成全新总纲、分集大纲与中英双语剧本。
          </p>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
            {PIPELINE_STAGES.map((s, i) => (
              <span key={s.key} className="mono-label text-[10px] flex items-center gap-1.5">
                <span className="text-primary">{String(i + 1).padStart(2, "0")}</span>
                {s.label}
              </span>
            ))}
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <h2 className="mono-label">Project Vault · 项目库</h2>
          <span className="mono-label text-[10px]">{rows?.length ?? 0} 个项目</span>
        </div>

        {error && <ErrorBox message={error.message} />}

        {loading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="panel h-40 animate-pulse" />
            ))}
          </div>
        ) : !rows?.length ? (
          <button
            onClick={() => setOpen(true)}
            className="flex w-full flex-col items-center gap-4 border border-dashed border-border px-6 py-16 text-center transition-colors hover:border-primary/60 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Film className="h-8 w-8 text-primary" />
            <div>
              <p className="font-medium">还没有复刻项目</p>
              <p className="mt-1 text-sm text-muted-foreground">
                点击创建第一个项目，从录入爆款样本开始
              </p>
            </div>
            <span className="mono-label border border-primary/50 px-3 py-1.5 text-[10px] text-primary">
              + 新建项目
            </span>
            <p className="mono-label text-[9px] leading-relaxed text-muted-foreground">
              录入标红样本 → AI 拆解 → 换皮方案 → 剧本产出 → 编审定稿
              <br />
              每一步完成后，点页面底部的「下一步」按钮进入下一阶段
            </p>
          </button>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((p) => (
              <div
                key={p.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/project/${p.id}`)}
                onKeyDown={(e) => e.key === "Enter" && navigate(`/project/${p.id}`)}
                className="panel group cursor-pointer p-5 transition-colors hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mono-label text-[9px]">PRJ-{String(p.id).padStart(4, "0")}</p>
                    <h3 className="mt-1.5 truncate text-lg font-semibold group-hover:text-primary transition-colors">
                      {p.title}
                    </h3>
                    {p.sourceTitle && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        复刻对象：{p.sourceTitle}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteId(p.id);
                    }}
                    aria-label="删除项目"
                    className="shrink-0 p-2 text-muted-foreground transition-colors hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* 五段流水线进度 */}
                <div className="mt-5 flex gap-1">
                  {PIPELINE_STAGES.map((s) => (
                    <div
                      key={s.key}
                      title={s.label}
                      className={`h-1 flex-1 ${
                        stageDone(p.progress, s.key) ? "bg-primary" : "bg-border"
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="mono-label text-[9px]">
                    入选 {p.progress.selectedCount} 方案 · 剧本包 {p.progress.packCount}
                  </span>
                  <span className="mono-label flex items-center gap-1 text-[9px] text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    进入工作台 <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 新建项目 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建复刻项目</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) createMut.mutate({ title: title.trim(), sourceTitle: sourceTitle.trim() || undefined });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="np-title">新短剧名称（暂定即可）</Label>
              <Input
                id="np-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例：狼人总裁的契约新娘"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-source">复刻对象（爆款剧名，选填）</Label>
              <Input
                id="np-source"
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
                placeholder="例：The Double Life of My Billionaire Husband"
              />
            </div>
            {createMut.error && <ErrorBox message={createMut.error.message} />}
            <DialogFooter>
              <Button type="submit" disabled={!title.trim() || createMut.isPending} className="w-full sm:w-auto">
                {createMut.isPending ? "创建中…" : "创建并进入工作台"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个项目？</AlertDialogTitle>
            <AlertDialogDescription>
              项目及其样本、拆解、总纲、大纲和剧本将全部删除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMut.mutate({ id: deleteId })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMut.isPending ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
