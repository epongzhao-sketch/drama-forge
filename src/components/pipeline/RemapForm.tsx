import { useState } from "react";
import { trpc } from "@/providers/trpc";
import type { AnalysisResult, RemapSettings } from "@contracts/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBox, Generating } from "@/components/chrome";
import { Sparkles, Save } from "lucide-react";

const GENRE_PRESETS = [
  "亿万富翁 / 契约婚姻",
  "狼人 / 禁忌之恋",
  "复仇逆袭 / 隐藏身份",
  "豪门恩怨 / 真假千金",
  "黑手党 / 危险爱情",
  "先婚后爱 / 闪婚",
  "吸血鬼 / 暗夜罗曼史",
  "职场 / 霸道CEO",
];

export function RemapForm({
  projectId,
  analysis,
  remap,
  hasBible,
  onSaved,
  onBible,
}: {
  projectId: number;
  analysis: AnalysisResult | null;
  remap: RemapSettings | null;
  hasBible: boolean;
  onSaved: () => void;
  onBible: () => void;
}) {
  const [form, setForm] = useState<RemapSettings>(
    remap ?? {
      newGenre: GENRE_PRESETS[0],
      protagonist: "",
      setting: "",
      audience: "18-45 岁女性，北美 / 东南亚市场",
      totalEpisodes: 60,
      episodeSeconds: 75,
      keepElements: [],
      extraNotes: "",
    },
  );
  const [customGenre, setCustomGenre] = useState("");

  const saveMut = trpc.pipeline.saveRemap.useMutation({ onSuccess: onSaved });
  const bibleMut = trpc.pipeline.generateBible.useMutation({ onSuccess: onBible });

  const set = <K extends keyof RemapSettings>(k: K, v: RemapSettings[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const effectiveGenre = customGenre.trim() || form.newGenre;

  const toggleKeep = (el: string) =>
    set(
      "keepElements",
      form.keepElements.includes(el)
        ? form.keepElements.filter((k) => k !== el)
        : [...form.keepElements, el],
    );

  const save = () =>
    saveMut.mutate({ projectId, settings: { ...form, newGenre: effectiveGenre } });

  const saveThenGenerate = async () => {
    await saveMut.mutateAsync({ projectId, settings: { ...form, newGenre: effectiveGenre } });
    bibleMut.mutate({ projectId });
  };

  return (
    <div className="space-y-5">
      {!analysis && (
        <p className="border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
          尚未完成 AI 拆解 —— 建议先完成上一步，这样可以把「可迁移爆款元素」直接勾选进复刻设定。
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>新题材方向</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {GENRE_PRESETS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  set("newGenre", g);
                  setCustomGenre("");
                }}
                className={`min-h-11 border px-2.5 py-2 text-left text-xs leading-snug transition-colors ${
                  !customGenre && form.newGenre === g
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/40"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <Input
            value={customGenre}
            onChange={(e) => setCustomGenre(e.target.value)}
            placeholder="或自定义题材方向…"
            className="mt-1.5"
          />
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rm-protagonist">主角设定</Label>
            <Textarea
              id="rm-protagonist"
              value={form.protagonist}
              onChange={(e) => set("protagonist", e.target.value)}
              placeholder="例：表面是卑微替身新娘，实际是失踪多年的财阀继承人…"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rm-setting">时代 / 背景</Label>
            <Input
              id="rm-setting"
              value={form.setting}
              onChange={(e) => set("setting", e.target.value)}
              placeholder="例：现代美国东海岸豪门"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rm-audience">目标受众</Label>
            <Input
              id="rm-audience"
              value={form.audience}
              onChange={(e) => set("audience", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rm-eps">总集数</Label>
              <Input
                id="rm-eps"
                type="number"
                min={1}
                max={120}
                value={form.totalEpisodes}
                onChange={(e) => set("totalEpisodes", Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rm-secs">单集时长（秒）</Label>
              <Input
                id="rm-secs"
                type="number"
                min={30}
                max={300}
                value={form.episodeSeconds}
                onChange={(e) => set("episodeSeconds", Math.max(30, Math.min(300, Number(e.target.value) || 75)))}
              />
            </div>
          </div>
        </div>
      </div>

      {analysis && analysis.transferableElements.length > 0 && (
        <div className="space-y-2">
          <Label>保留的爆款元素（来自拆解报告）</Label>
          <div className="flex flex-wrap gap-1.5">
            {analysis.transferableElements.map((el) => {
              const on = form.keepElements.includes(el);
              return (
                <button
                  key={el}
                  type="button"
                  onClick={() => toggleKeep(el)}
                  className={`min-h-11 border px-3 py-1.5 text-xs transition-colors ${
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {el}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="rm-notes">补充要求（选填）</Label>
        <Textarea
          id="rm-notes"
          value={form.extraNotes}
          onChange={(e) => set("extraNotes", e.target.value)}
          placeholder="例：节奏要比原作更快；前 3 集必须出大反转；加入一条悬疑暗线…"
          rows={2}
        />
      </div>

      {(saveMut.error || bibleMut.error) && (
        <ErrorBox message={(saveMut.error ?? bibleMut.error)?.message} />
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={save}
          disabled={saveMut.isPending || !effectiveGenre}
          className="h-11 gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {saveMut.isPending ? "保存中…" : "保存设定"}
        </Button>
        <Button
          onClick={saveThenGenerate}
          disabled={saveMut.isPending || bibleMut.isPending || !effectiveGenre}
          className="h-11 gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {bibleMut.isPending ? "生成中…" : hasBible ? "保存并重新生成总纲" : "保存并生成总纲"}
        </Button>
      </div>
      {bibleMut.isPending && <Generating text="正在生成总纲（Series Bible）…" />}
    </div>
  );
}
