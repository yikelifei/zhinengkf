export function authorizationCheckLabel(key: string) {
  return ({
    suite_id: "Suite ID",
    suite_secret: "Suite Secret",
    suite_token: "指令回调 Token",
    suite_encoding_aes_key: "指令回调 EncodingAESKey",
    encrypted_store_key: "授权凭证加密密钥",
    public_https_url: "公网 HTTPS 地址",
    suite_api_base_url: "服务商 API 地址",
    official_install_url: "企业微信官方安装页",
    suite_ticket: "Suite Ticket 推送",
    encrypted_store: "加密凭证存储",
  } as Record<string, string>)[key] || key;
}

export function flowStatusLabel(status: string) {
  return ({
    pending: "等待管理员扫码",
    exchanging: "正在确认授权",
    completed: "授权成功",
    failed: "授权失败",
    expired: "链接已过期",
  } as Record<string, string>)[status] || status;
}

export function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function readinessStatusLabel(status: string) {
  return ({ ready: "已就绪", blocked: "被阻断", missing: "缺少配置" } as Record<string, string>)[status] || "需检查";
}

export function checkLabel(key: string) {
  return ({
    corp_id: "企业 ID",
    customer_service_secret: "微信客服 Secret",
    callback_token: "回调 Token",
    encoding_aes_key: "EncodingAESKey",
    open_kfid: "客服账号 OpenKfid",
    public_callback_url: "公网回调 URL",
    official_api_base_url: "官方 API 基地址",
    official_send_adapter: "正式发送适配器",
    persistence: "账号映射持久化",
  } as Record<string, string>)[key] || key;
}
