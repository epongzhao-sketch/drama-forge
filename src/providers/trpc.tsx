import { createTRPCReact } from "@trpc/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  links: [
    // 流式批量链接：响应是 jsonl 流，配合服务端 jsonl.pingMs 的心跳保活，
    // 防止 AI 长任务被反向代理闲置超时掐断（空响应体 → JSON 解析报错）。
    httpBatchStreamLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
