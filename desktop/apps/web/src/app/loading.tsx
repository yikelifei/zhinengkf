import { WorkbenchRouteState } from "./route-state";

export default function Loading() {
  return (
    <WorkbenchRouteState
      tone="loading"
      title="正在加载工作页"
      description="正在准备当前模块和它所需的真实业务状态。"
    />
  );
}
