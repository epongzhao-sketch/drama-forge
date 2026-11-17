// 访问白名单分支逻辑自检（不连数据库）：npx tsx -r dotenv/config ./scripts/verify-access-gate.mts
// isLoginAllowed 每次调用实时读 process.env，因此同进程内改环境变量即可覆盖三分支。
import assert from "node:assert/strict";

const OWNER = "owner-union-id";

type Case = {
  patch: Record<string, string>;
  unionId: string;
  expect: boolean;
  note: string;
};

const cases: Case[] = [
  // 场景 1：显式白名单以列表为唯一依据
  { patch: { ALLOWED_UNION_IDS: `a, ${OWNER}` }, unionId: "a", expect: true, note: "白名单内放行" },
  { patch: { ALLOWED_UNION_IDS: "a,b" }, unionId: "stranger", expect: false, note: "白名单外拒绝" },
  { patch: { ALLOWED_UNION_IDS: "a" }, unionId: OWNER, expect: false, note: "owner 不在列同样拒绝（列表是唯一依据）" },
  { patch: { ALLOWED_UNION_IDS: " a ,, b ," }, unionId: "b", expect: true, note: "逗号/空格/空项容忍" },
  // 场景 2：无白名单、有 owner → 仅 owner
  { patch: { ALLOWED_UNION_IDS: "" }, unionId: OWNER, expect: true, note: "owner 放行" },
  { patch: { ALLOWED_UNION_IDS: "" }, unionId: "stranger", expect: false, note: "陌生人拒绝（线上单租户默认）" },
  // 场景 3：两者皆空 → 不限
  { patch: { ALLOWED_UNION_IDS: "", OWNER_UNION_ID: "" }, unionId: "stranger", expect: true, note: "自托管默认不限" },
];

let failed = 0;
for (const [i, c] of cases.entries()) {
  process.env.OWNER_UNION_ID = OWNER; // 每个场景的基准，再叠加 patch
  for (const [k, v] of Object.entries(c.patch)) process.env[k] = v;
  const { isLoginAllowed } = await import("../api/lib/access.js");
  const got = isLoginAllowed(c.unionId);
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  case ${i}: ${c.note}（got ${got}, expect ${c.expect}）`);
}
assert.equal(failed, 0, `${failed} 个用例失败`);
console.log(`\n全部 ${cases.length} 个用例通过：isLoginAllowed 三分支语义正确。`);
