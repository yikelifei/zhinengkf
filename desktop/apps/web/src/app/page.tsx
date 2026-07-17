"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getWorkbenchRouteFromLegacyHash } from "./route-manifest";
import { WorkbenchRouteState } from "./route-state";

export default function LegacyHashRedirectPage() {
  const router = useRouter();
  const [target, setTarget] = useState("/overview");

  useEffect(() => {
    const nextTarget = getWorkbenchRouteFromLegacyHash(window.location.hash).href;
    setTarget(nextTarget);
    router.replace(nextTarget);
  }, [router]);

  return (
    <WorkbenchRouteState
      tone="loading"
      title="正在打开对应工作页"
      description="旧书签仍然可用，系统会把原来的功能锚点转换为稳定 URL。"
      action={<Link href={target}>立即继续</Link>}
    />
  );
}
