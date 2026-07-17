import { getWechatChannelStatus } from "../../lib/api";

export async function loadWechatChannelStatus() {
  const status = await getWechatChannelStatus();
  if (!status) throw new Error("未取得微信通道状态，请确认本机 API 已启动后重试。");
  return status;
}
