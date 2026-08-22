"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { WorkbenchShell } from "../components/workbench-shell";
import { WORKBENCH_ROUTE_LIST, type WorkbenchRoute } from "./route-manifest";
import styles from "./modular-workbench-shell.module.css";

export type ModularWorkbenchShellProps = {
  route: WorkbenchRoute;
  children: ReactNode;
};

type CompanyProfile = {
  organization: { displayName: string };
  workspace: { displayName: string; ownership: "company" };
};

const EMBEDDED_COMPANY_FALLBACK: CompanyProfile = {
  organization: { displayName: "臻希礼业" },
  workspace: { displayName: "臻希礼业企业工作台", ownership: "company" },
};

export function ModularWorkbenchShell({ route, children }: ModularWorkbenchShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(EMBEDDED_COMPANY_FALLBACK);
  const moduleNavigationRef = useRef<HTMLElement | null>(null);
  const activeModuleLinkRef = useRef<HTMLAnchorElement | null>(null);
  const siblingRoutes = useMemo(
    () => WORKBENCH_ROUTE_LIST.filter((candidate) => (
      candidate.sectionId === route.sectionId && !candidate.href.includes("[")
      && candidate.showInModuleNav !== false
    )),
    [route.sectionId],
  );
  const hasModuleNavigation = siblingRoutes.length > 1 && route.sectionId !== "design-platform-config";

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/company-profile", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`company profile api ${response.status}`);
        return response.json() as Promise<CompanyProfile>;
      })
      .then((profile) => {
        if (profile?.workspace?.ownership !== "company" || !profile?.organization?.displayName) return;
        setCompanyProfile(profile);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const navigation = moduleNavigationRef.current;
    const activeLink = activeModuleLinkRef.current;
    if (!hasModuleNavigation || !navigation || !activeLink || navigation.scrollWidth <= navigation.clientWidth) return;
    const frame = window.requestAnimationFrame(() => {
      const centeredLeft = activeLink.offsetLeft - (navigation.clientWidth - activeLink.clientWidth) / 2;
      navigation.scrollTo({ left: Math.max(0, centeredLeft), behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasModuleNavigation, route.id]);

  return (
    <WorkbenchShell
      className={styles.shell}
      activeSectionId={route.sectionId}
      sidebar={{
        collapsed: sidebarCollapsed,
        onCollapsedChange: setSidebarCollapsed,
        brandLabel: companyProfile.organization.displayName,
        brandSubtitle: companyProfile.workspace.displayName,
      }}
      contentLabel={`${route.title}页面`}
    >
      <div
        className={styles.routeContent}
        data-route-id={route.id}
        data-has-module-navigation={hasModuleNavigation ? "true" : "false"}
      >
        {hasModuleNavigation ? (
          <nav ref={moduleNavigationRef} className={styles.moduleNavigation} aria-label={`${route.title}相关页面`}>
            {siblingRoutes.map((candidate) => {
              const active = candidate.id === route.id || route.href.startsWith(`${candidate.href}/[`);
              return (
                <Link
                  key={candidate.id}
                  ref={active ? activeModuleLinkRef : undefined}
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
