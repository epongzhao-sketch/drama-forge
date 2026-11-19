import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";

const STORAGE_KEY = "df-active-provider";

/**
 * 当前选用的 AI 服务商：选择保存在 localStorage（每浏览器一份），
 * 每次 AI 任务提交时随请求带上 providerId，服务端据此路由到对应服务商（密钥只在服务端）。
 */
export function useAiProvider() {
  const { data: providers } = trpc.ai.providers.useQuery();
  const [picked, setPicked] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? "");

  const activeId =
    providers?.find((p) => p.id === picked)?.id ?? providers?.[0]?.id ?? "";

  useEffect(() => {
    if (activeId && activeId !== localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, activeId);
    }
  }, [activeId]);

  return { providers: providers ?? [], activeId, setPicked };
}
