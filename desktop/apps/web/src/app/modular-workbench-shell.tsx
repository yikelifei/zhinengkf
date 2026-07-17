"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { WorkbenchShell } from "../components/workbench-shell";
import { WORKBENCH_ROUTE_LIST, type WorkbenchRoute } from "./route-manifest";
import styles from "./modular-workbench-shell.module.css";

export type ModularWorkbenchShellProps = {
  route: WorkbenchRoute;
  children: ReactNode;
};

export function ModularWorkbenchShell({ route, children }: ModularWorkbenchShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const siblingRoutes = useMemo(
    () => WORKBENCH_ROUTE_LIST.filter((candidate) => (
      candidate.sectionId === route.sectionId && !candidate.href.includes("[")
      && candidate.showInModuleNav !== false
    )),
    [route.sectionId],
  );

  return (
    <WorkbenchShell
      className={styles.shell}
      activeSectionId={route.sectionId}
      sidebar={{
        collapsed: sidebarCollapsed,
        onCollapsedChange: setSidebarCollapsed,
      }}
      topbar={{ title: route.title }}
      contentLabel={`${route.title}页面`}
    >
      <div className={styles.routeContent} data-route-id={route.id}>
        {siblingRoutes.length > 1 ? (
          <nav className={styles.moduleNavigation} aria-label={`${route.title}相关页面`}>
            {siblingRoutes.map((candidate) => {
              const active = candidate.id === route.id || route.href.startsWith(`${candidate.href}/[`);
              return (
                <Link
                  key={candidate.id}
                  href={candidate.href}
                  aria-current={active ? "page" : undefined}
                  data-active={active ? "true" : "false"}
                >
                  {candidate.title}
                </Link>
              );
            })}
          </nav>
        ) : null}
        <div className={styles.featureContent}>{children}</div>
      </div>
    </WorkbenchShell>
  );
}
