// 登录白名单（开源后防止陌生人使用线上实例的关键闸门，OAuth 回调签发 session 时
// 校验一次，authenticateRequest 每次请求再校验一次，配置变更即时生效）：
// 1. ALLOWED_UNION_IDS（逗号分隔）非空 → 只放行列表内 unionId（配置时把 owner 一并列入）；
// 2. 未配白名单但设了 OWNER_UNION_ID → 仅 owner 可登录（线上单租户默认）；
// 3. 两者都未设 → 不限（自托管默认值）。
// 每次调用实时读 process.env（不经过 lib/env.ts 的模块级快照），保证改配置后无需重启进程语义可测。
export function isLoginAllowed(unionId: string): boolean {
  const allowlist = (process.env.ALLOWED_UNION_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length > 0) {
    return allowlist.includes(unionId);
  }
  const owner = process.env.OWNER_UNION_ID ?? "";
  return owner === "" || unionId === owner;
}
