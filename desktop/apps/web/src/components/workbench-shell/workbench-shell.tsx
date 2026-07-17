import { AppSidebar } from "./app-sidebar";
import { AppTopbar } from "./app-topbar";
import styles from "./workbench-shell.module.css";
import type { WorkbenchShellProps } from "./types";

export function WorkbenchShell({
  className,
  activeSectionId,
  onSelectSection,
  children,
  navigationGroups,
  sidebar,
  topbar,
  contentLabel = "工作台内容",
}: WorkbenchShellProps) {
  return (
    <div className={[styles.shellFrame, className].filter(Boolean).join(" ")}>
      <AppSidebar
        {...sidebar}
        activeSectionId={activeSectionId}
        onSelect={onSelectSection}
        groups={navigationGroups}
      />
      <div className={styles.mainColumn} data-has-topbar={topbar ? "true" : "false"}>
        {topbar ? <AppTopbar {...topbar} /> : null}
        <main className={styles.shellContent} aria-label={contentLabel}>
          {children}
        </main>
      </div>
    </div>
  );
}
