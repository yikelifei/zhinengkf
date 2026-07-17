"use client";

import { WorkbenchRouteState } from "./route-state";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <WorkbenchRouteState
      tone="error"
      title="当前工作页加载失败"
      description="业务操作没有被自动重试。请先重试页面；仍失败时再检查本地 API 和运行日志。"
      action={<button type="button" onClick={reset}>重试页面</button>}
    />
  );
}
