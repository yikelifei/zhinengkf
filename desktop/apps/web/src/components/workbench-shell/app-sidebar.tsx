"use client";

import { ChevronLeft, ChevronRight, Grid2X2, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_WORKBENCH_NAVIGATION } from "./navigation";
import styles from "./workbench-shell.module.css";
import type { AppSidebarProps, WorkbenchNavigationItem, WorkspaceSectionId } from "./types";

const MOBILE_NAVIGATION_ID = "workbench-mobile-navigation";

export function AppSidebar({
  activeSectionId,
  onSelect,
  groups = DEFAULT_WORKBENCH_NAVIGATION,
  brandLabel = "臻希智能客服",
  brandSubtitle = "运营管理中心",
  collapsed = false,
  onCollapsedChange,
}: AppSidebarProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const firstMobileItemRef = useRef<HTMLAnchorElement>(null);
  const primaryMobileItems = useMemo(
    () => groups.flatMap((group) => group.items)
      .filter((item) => item.mobilePriority !== undefined)
      .sort((left, right) => Number(left.mobilePriority) - Number(right.mobilePriority))
      .slice(0, 4),
    [groups],
  );

  useEffect(() => {
    if (!mobileNavigationOpen) return undefined;

    firstMobileItemRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavigationOpen(false);
        mobileTriggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        mobileDrawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href]:not([aria-disabled="true"]), button:not(:disabled)',
        ) || [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavigationOpen]);

  const selectSection = (sectionId: WorkspaceSectionId, closeMobileNavigation = false) => {
    onSelect?.(sectionId);
    if (closeMobileNavigation) {
      setMobileNavigationOpen(false);
      mobileTriggerRef.current?.focus();
    }
  };

  return (
    <aside className={styles.sidebar} data-collapsed={collapsed ? "true" : "false"} aria-label="工作台导航">
      <div className={styles.sidebarRail}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true"><Sparkles size={18} /></span>
          <span className={styles.brandCopy}>
            <strong>{brandLabel}</strong>
            <small>{brandSubtitle}</small>
          </span>
        </div>

        <nav id="workbench-desktop-navigation" className={styles.sidebarNav} aria-label="工作台主导航">
          {groups.map((group) => (
            <section className={styles.navGroup} key={group.id} aria-labelledby={`workbench-nav-${group.id}`}>
              <h2 id={`workbench-nav-${group.id}`}>{group.label}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <NavigationButton
                      item={item}
                      active={activeSectionId === item.id}
                      collapsed={collapsed}
                      onSelect={selectSection}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        {onCollapsedChange ? (
          <button
            type="button"
            className={styles.collapseButton}
            aria-label={collapsed ? "展开导航栏" : "收起导航栏"}
            aria-controls="workbench-desktop-navigation"
            aria-expanded={!collapsed}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
            <span>{collapsed ? "展开" : "收起导航"}</span>
          </button>
        ) : null}
      </div>

      <nav className={styles.mobileNav} aria-label="移动端工作台导航">
        {primaryMobileItems.map((item) => {
          const Icon = item.icon;
          const active = activeSectionId === item.id;
          return (
            <Link
              href={item.href}
              key={item.id}
              className={active ? styles.mobileNavActive : undefined}
              aria-current={active ? "page" : undefined}
              aria-disabled={item.disabled || undefined}
              onClick={(event) => {
                if (item.disabled) {
                  event.preventDefault();
                  return;
                }
                selectSection(item.id);
              }}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          ref={mobileTriggerRef}
          className={mobileNavigationOpen ? styles.mobileNavActive : undefined}
          aria-expanded={mobileNavigationOpen}
          aria-controls={MOBILE_NAVIGATION_ID}
          onClick={() => setMobileNavigationOpen((open) => !open)}
        >
          <Grid2X2 size={18} aria-hidden="true" />
          <span>全部功能</span>
        </button>
      </nav>

      {mobileNavigationOpen ? (
        <div className={styles.mobileDrawerLayer}>
          <button
            type="button"
            className={styles.mobileDrawerBackdrop}
            aria-label="关闭全部功能"
            onClick={() => {
              setMobileNavigationOpen(false);
              mobileTriggerRef.current?.focus();
            }}
          />
          <section
            ref={mobileDrawerRef}
            id={MOBILE_NAVIGATION_ID}
            className={styles.mobileDrawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workbench-mobile-navigation-title"
          >
            <header>
              <div>
                <strong id="workbench-mobile-navigation-title">全部功能</strong>
                <span>按业务分组快速前往</span>
              </div>
              <button
                type="button"
                aria-label="关闭全部功能"
                onClick={() => {
                  setMobileNavigationOpen(false);
                  mobileTriggerRef.current?.focus();
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className={styles.mobileDrawerGroups}>
              {groups.map((group, groupIndex) => (
                <section key={group.id} aria-labelledby={`workbench-mobile-${group.id}`}>
                  <h2 id={`workbench-mobile-${group.id}`}>{group.label}</h2>
                  <div>
                    {group.items.map((item, itemIndex) => {
                      const Icon = item.icon;
                      const active = activeSectionId === item.id;
                      return (
                        <Link
                          href={item.href}
                          key={item.id}
                          ref={groupIndex === 0 && itemIndex === 0 ? firstMobileItemRef : undefined}
                          className={active ? styles.mobileDrawerItemActive : undefined}
                          aria-current={active ? "page" : undefined}
                          aria-disabled={item.disabled || undefined}
                          onClick={(event) => {
                            if (item.disabled) {
                              event.preventDefault();
                              return;
                            }
                            selectSection(item.id, true);
                          }}
                        >
                          <Icon size={17} aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}

type NavigationButtonProps = {
  item: WorkbenchNavigationItem;
  active: boolean;
  collapsed: boolean;
  onSelect?: (sectionId: WorkspaceSectionId) => void;
};

function NavigationButton({ item, active, collapsed, onSelect }: NavigationButtonProps) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={active ? styles.navItemActive : undefined}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      data-section-id={item.id}
      aria-disabled={item.disabled || undefined}
      onClick={(event) => {
        if (item.disabled) {
          event.preventDefault();
          return;
        }
        onSelect?.(item.id);
      }}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{item.label}</span>
      {item.badge !== undefined ? (
        <b className={styles.navBadge} data-tone={item.badgeTone || "neutral"}>{item.badge}</b>
      ) : null}
    </Link>
  );
}
