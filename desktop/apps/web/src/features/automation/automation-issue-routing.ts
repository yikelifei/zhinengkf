export function automationIssueHref(key: string, detail = "") {
  const keyTarget = issueTarget(String(key || "").toLowerCase());
  return keyTarget || issueTarget(String(detail || "").toLowerCase()) || "/automation/runs";
}

function issueTarget(text: string) {
  if (/send|wechat|dispatch|ack/.test(text)) return "/send/blocked";
  if (/catalog|sku|product/.test(text)) return "/catalog/audit";
  if (/design|zhenxi|image/.test(text)) return "/design/settings";
  if (/provider|model|llm/.test(text)) return "/settings/ai-models";
  if (/delivery|release|database|recovery|staging/.test(text)) return "/settings/delivery-readiness";
  if (/agent|skill|training/.test(text)) return "/agents";
  if (/routing|route/.test(text)) return "/routing";
  if (/conversation|manual_lock|handoff/.test(text)) return "/conversations";
  return "";
}
