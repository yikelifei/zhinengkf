import { createHash } from "node:crypto";

export type RoutingCorrectionPayload = {
  agentKey?: string;
  scene?: string;
  reviewer?: string;
  note?: string;
  idealReply?: string;
};

export function routingCorrectionRequestKey(routeEvaluationId: string, payload: RoutingCorrectionPayload = {}) {
  const canonical = JSON.stringify({
    routeEvaluationId: String(routeEvaluationId || "").trim(),
    agentKey: String(payload.agentKey || "").trim(),
    scene: String(payload.scene || "").trim(),
    reviewer: String(payload.reviewer || "").trim(),
    note: String(payload.note || "").trim(),
    idealReply: String(payload.idealReply || "").trim(),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
