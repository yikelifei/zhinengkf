import type { InboundProcessResult, RouteEvaluation } from "../../lib/api";

export type RoutePresentation = {
  scene: string;
  sceneDetail: string;
  valueTier: string;
  valueDetail: string;
  action: string;
  actionDetail: string;
  confidence: string;
  handler: string;
  missingFields: string[];
  riskFlags: string[];
  nextStep: string;
  safeguards: string[];
};

export function presentRouteEvaluation(route: RouteEvaluation): RoutePresentation {
  const policy = route.routingPolicy;
  const valueTier = route.isHighValue || policy?.valueTier === "high" ? "高价值" : "标准价值";
  const budgetParts = [
    numberLabel(route.budget?.totalAmount, "总预算", "元"),
    numberLabel(route.budget?.perUnitAmount, "单份预算", "元"),
    numberLabel(route.budget?.quantity, "数量", "份"),
  ].filter(Boolean);
  const action = actionPresentation(route.action);
  const sceneDetail = [
    route.agent?.name ? `处理专员：${route.agent.name}` : route.agentKey ? `处理键：${route.agentKey}` : "",
    route.sceneDecision?.reason || "",
  ].filter(Boolean).join("；");
  return {
    scene: route.scene || policy?.scene || "未识别场景",
    sceneDetail: sceneDetail || "路由服务未返回更多场景说明。",
    valueTier,
    valueDetail: budgetParts.join(" · ") || "未识别到明确预算或数量。",
    action: action.label,
    actionDetail: policy?.reason || action.detail,
    confidence: formatPercent(route.confidence),
    handler: handlerLabel(policy?.handler, policy?.manualRequired),
    missingFields: route.missingFields || [],
    riskFlags: route.riskFlags || [],
    nextStep: policy?.nextStep || route.sceneAudit?.nextStep || "等待人工确认路由结果。",
    safeguards: policy?.safeguards || [],
  };
}

export function presentInboundProcess(result: InboundProcessResult) {
  const artifacts = [
    result.sendTask ? `发送任务 ${result.sendTask.id}` : "",
    result.designJob ? `设计任务 ${result.designJob.id}` : "",
    result.quote ? `报价 ${result.quote.id}` : "",
    result.orderDraft ? `订单草稿 ${result.orderDraft.id}` : "",
    result.notification ? `人工提醒 ${result.notification.id}` : "",
  ].filter(Boolean);
  return {
    planType: result.plan.type,
    reason: result.plan.reason,
    artifacts,
    missingFields: result.plan.missingFields || [],
    messageId: result.message.id,
  };
}

function actionPresentation(action: RouteEvaluation["action"]) {
  if (action === "auto_agent") return { label: "交给自动专员", detail: "由匹配的业务专员继续处理。" };
  if (action === "collect_info") return { label: "先补齐信息", detail: "缺少关键字段，先向客户澄清。" };
  return { label: "转人工审核", detail: "当前结果需要人工判断后再继续。" };
}

function handlerLabel(handler?: string, manualRequired?: boolean) {
  if (manualRequired || handler === "human") return "人工处理";
  if (handler === "agent") return "自动专员";
  return "由动作策略决定";
}

function numberLabel(value: number | null | undefined, label: string, unit: string) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  return `${label} ${Number(value).toLocaleString("zh-CN")} ${unit}`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "不可用";
  const normalized = value > 1 ? value : value * 100;
  return `${Math.max(0, Math.min(100, normalized)).toFixed(0)}%`;
}
