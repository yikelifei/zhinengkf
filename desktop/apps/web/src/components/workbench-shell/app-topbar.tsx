"use client";

import { RefreshCw, Search } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import styles from "./workbench-shell.module.css";
import type { AppTopbarProps } from "./types";

export function AppTopbar({
  title,
  searchValue,
  searchPlaceholder = "搜索客户、会话、订单或功能",
  onSearchChange,
  onSearchSubmit,
  onRefresh,
  busy = false,
  healthItems = [],
  onOpenHealth,
  actions,
}: AppTopbarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [internalSearchValue, setInternalSearchValue] = useState(searchValue || "");
  const searchEnabled = Boolean(onSearchChange || onSearchSubmit);

  useEffect(() => {
    if (searchValue !== undefined) setInternalSearchValue(searchValue);
  }, [searchValue]);

  useEffect(() => {
    if (!searchEnabled) return undefined;
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']");
      if (editing || event.isComposing || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, [searchEnabled]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearchSubmit?.(internalSearchValue);
  };

  const healthContent = healthItems.length ? (
    <>
      <span className={styles.healthLabel}>通道状态</span>
      {healthItems.map((item) => (
        <span className={styles.healthItem} key={item.id} data-tone={item.tone}>
          <i aria-hidden="true" />
          <span>{item.label}</span>
          {item.count !== undefined ? <b>{item.count}</b> : null}
        </span>
      ))}
      {onOpenHealth ? <span className={styles.healthDetail}>详情</span> : null}
    </>
  ) : null;

  return (
    <header className={styles.topbar}>
      <h1>{title}</h1>
      <div className={styles.topbarTools}>
        {searchEnabled ? (
          <form className={styles.topbarSearch} role="search" onSubmit={submitSearch}>
            <Search size={15} aria-hidden="true" />
            <label className={styles.srOnly} htmlFor="workbench-global-search">全局搜索</label>
            <input
              id="workbench-global-search"
              ref={searchInputRef}
              type="search"
              value={internalSearchValue}
              placeholder={searchPlaceholder}
              aria-keyshortcuts="Control+K Meta+K"
              onChange={(event) => {
                setInternalSearchValue(event.target.value);
                onSearchChange?.(event.target.value);
              }}
            />
            <kbd>Ctrl K</kbd>
          </form>
        ) : null}
        {onRefresh ? (
          <button type="button" className={styles.iconButton} aria-label="刷新工作台" onClick={onRefresh} disabled={busy}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        ) : null}
        {healthContent ? (
          onOpenHealth ? (
            <button type="button" className={styles.healthSummary} onClick={onOpenHealth}>{healthContent}</button>
          ) : (
            <div className={styles.healthSummary} aria-label="通道状态">{healthContent}</div>
          )
        ) : null}
        {actions ? <div className={styles.topbarActions}>{actions}</div> : null}
      </div>
    </header>
  );
}
