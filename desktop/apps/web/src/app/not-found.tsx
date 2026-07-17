import Link from "next/link";
import { WorkbenchRouteState } from "./route-state";

export default function NotFound() {
  return (
    <WorkbenchRouteState
      tone="not-found"
      title="没有找到这个工作页"
      description="该地址可能来自旧版本，或对应模块尚未接入稳定路由。"
      action={<Link href="/overview">返回运营总览</Link>}
    />
  );
}
