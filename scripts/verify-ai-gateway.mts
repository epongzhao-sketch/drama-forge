// 验证 AI 网关配置：走应用自己的 listModels() 代码路径（含 .env 兜底加载）
// 用法：npx tsx ./scripts/verify-ai-gateway.mts
import { listModels } from "../api/ai/client";

const { models, defaultModelId } = await listModels();
console.log("可用模型:", models.map((m) => m.id).join(", "));
console.log("默认模型（应用实际会使用）:", defaultModelId);
if (!defaultModelId) {
  console.error("FAIL: 未拿到默认模型");
  process.exit(1);
}
console.log("PASS: 网关凭证有效");
