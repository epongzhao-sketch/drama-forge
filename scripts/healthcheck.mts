// 线上站点一键体检：npm run healthcheck
// 只读公开端点，不触碰数据库。任一检查失败以非零码退出。
// 目标站点必须经 SITE_URL 指定：线上地址只写在本地 .env，不进仓库。
const SITE = process.env.SITE_URL ?? "";
if (!SITE) {
  console.error("未设置 SITE_URL：请先把线上站点地址写入本地 .env（SITE_URL=https://…）。");
  process.exit(1);
}
const APP_ID = process.env.APP_ID ?? "";

type Check = { name: string; run: () => Promise<void> };

const browserHeaders = { Accept: "text/html,application/xhtml+xml" };

const checks: Check[] = [
  {
    name: "首页可访问 (GET /)",
    run: async () => {
      const r = await fetch(`${SITE}/`, { headers: browserHeaders });
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      if (!html.includes("爆剧复刻舱")) throw new Error("首页内容不含应用标识");
    },
  },
  {
    name: "SPA 路由回退 (GET /login)",
    run: async () => {
      const r = await fetch(`${SITE}/login`, { headers: browserHeaders });
      if (r.status !== 200) throw new Error(`HTTP ${r.status} —— SPA 回退失效`);
    },
  },
  {
    name: "tRPC 存活 (pipeline ping)",
    run: async () => {
      const r = await fetch(`${SITE}/api/trpc/ping?input=%7B%22json%22%3Anull%7D`);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { result?: { data?: { json?: { ok?: boolean } } } };
      if (!j.result?.data?.json?.ok) throw new Error("ping 响应异常");
    },
  },
  {
    name: "鉴权守卫在线 (auth.me 未登录应 401)",
    run: async () => {
      const r = await fetch(`${SITE}/api/trpc/auth.me?input=%7B%22json%22%3Anull%7D`);
      if (r.status !== 401) throw new Error(`HTTP ${r.status} —— 鉴权守卫异常（应为 401）`);
    },
  },
  {
    name: "OAuth 跳转生成 (authorize 302 → kimi.com)",
    run: async () => {
      if (!APP_ID) throw new Error("本地 .env 缺 APP_ID，跳过此项");
      const cb = `${SITE}/api/oauth/callback`;
      const url =
        `https://auth.kimi.com/api/oauth/authorize?client_id=${APP_ID}` +
        `&redirect_uri=${encodeURIComponent(cb)}&response_type=code&scope=profile` +
        `&state=${Buffer.from(cb).toString("base64")}`;
      const r = await fetch(url, { redirect: "manual" });
      const loc = r.headers.get("location") ?? "";
      if (r.status !== 302 || !loc.includes("kimi.com/authorize")) {
        throw new Error(`HTTP ${r.status}, redirect: ${loc || "（无）"}`);
      }
    },
  },
];

let failed = 0;
for (const c of checks) {
  const t0 = Date.now();
  try {
    await c.run();
    console.log(`PASS  ${c.name}  (${Date.now() - t0}ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${c.name}  —— ${(e as Error).message}`);
  }
}
console.log(failed ? `\n${failed}/${checks.length} 项失败，站点异常！` : `\n全部 ${checks.length} 项通过，站点正常。`);
process.exit(failed ? 1 : 0);
