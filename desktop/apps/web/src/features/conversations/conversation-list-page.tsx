"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { ConversationsFeatureApi } from "./api";
import { ConversationPageState } from "./conversation-page-state";
import styles from "./conversation-pages.module.css";
import { useConversationsController } from "./use-conversations-controller";

export function ConversationListPage({ api }: { api?: ConversationsFeatureApi }) {
  const controller = useConversationsController(api, null, "list");
  if (controller.accessPhase === "loading") {
    return <ConversationPageState title="正在确认会话访问权限" detail="权限确认后才会读取会话列表。" />;
  }
  if (controller.accessPhase === "error") {
    return <ConversationPageState title="无法确认会话访问权限" detail={controller.accessError} tone="danger" actionLabel="重新检查" onAction={() => void controller.refreshWorkspace()} />;
  }
  if (controller.accessPhase === "denied") {
    return <ConversationPageState title="当前操作员不能查看会话" detail={controller.permissionDetail || "未授予 view_console。"} tone="warning" actionLabel="重新检查权限" onAction={() => void controller.refreshWorkspace()} />;
  }

  const inbox = controller.inbox;
  return (
    <section className={styles.page} aria-labelledby="conversation-list-title" aria-busy={inbox.loading || undefined}>
      <header className={styles.header}>
        <div>
          <h1 id="conversation-list-title">会话列表</h1>
          <p>这里只筛选和选择会话；回复、客户资料与分配分别进入独立页面。</p>
        </div>
        <button className={styles.button} type="button" data-action-id="conversations-list-refresh" aria-label="刷新会话列表" onClick={() => void controller.refreshWorkspace()} disabled={inbox.loading}>
          <RefreshCw size={16} aria-hidden="true" />刷新列表
        </button>
      </header>

      <section className={styles.panel} aria-label="会话筛选">
        <div className={styles.scopeTabs} role="group" aria-label="会话范围">
          {inbox.scopeOptions.map((option) => (
            <button
              className={styles.button}
              type="button"
              data-action-id={"conversations-list-scope-" + option.value}
              aria-label={"按" + option.label + "范围筛选会话"}
              aria-pressed={option.value === inbox.scope}
              onClick={() => controller.actions.onScopeChange(option.value)}
              key={option.value}
            >
              {option.label}（{option.count ?? 0}）
            </button>
          ))}
        </div>
        <div className={styles.filters}>
          <label>
            <span>搜索</span>
            <input type="search" value={inbox.search} placeholder={inbox.searchPlaceholder} onChange={(event) => controller.actions.onSearchChange(event.target.value)} />
          </label>
          <FilterSelect label="渠道" value={inbox.channel} options={inbox.channelOptions} onChange={controller.actions.onChannelChange} />
          <FilterSelect label="状态" value={inbox.status} options={inbox.statusOptions} onChange={controller.actions.onStatusChange} />
          <FilterSelect label="排序" value={inbox.sort} options={inbox.sortOptions} onChange={controller.actions.onSortChange} />
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="conversation-results-title">
        <h2 id="conversation-results-title">筛选结果（{inbox.total}）</h2>
        {inbox.error ? <div className={styles.notice + " " + styles.noticeError} role="alert">{inbox.error}</div> : null}
        {!inbox.loading && !inbox.error && !inbox.conversations.length ? (
          <div className={styles.state} role="status"><strong>{inbox.emptyTitle}</strong><p>{inbox.emptyDetail}</p></div>
        ) : null}
        <div className={styles.list}>
          {inbox.conversations.map((conversation) => (
            <Link className={styles.row} href={"/conversations/" + encodeURIComponent(conversation.id)} key={conversation.id}>
              <div className={styles.rowHeader}>
                <h2>{conversation.title}</h2>
                <span>{conversation.updatedAtLabel}</span>
              </div>
              <p>{conversation.preview}</p>
              <div className={styles.rowMeta}>
                <span className={styles.badge}>{conversation.channelLabel}</span>
                {conversation.subtitle ? <span>{conversation.subtitle}</span> : null}
                {conversation.stateLabel ? <span>{conversation.stateLabel}</span> : null}
                {conversation.unreadCount ? <span className={styles.unread}>{conversation.unreadCount} 条未读</span> : null}
              </div>
            </Link>
          ))}
        </div>
        <div className={styles.pagination}>
          <span>第 {inbox.page} / {inbox.pageCount} 页</span>
          <div className={styles.headerActions}>
            <button className={styles.button} type="button" data-action-id="conversations-list-previous-page" aria-label="上一页会话" disabled={inbox.page <= 1} onClick={() => controller.actions.onPageChange(inbox.page - 1)}>上一页</button>
            <button className={styles.button} type="button" data-action-id="conversations-list-next-page" aria-label="下一页会话" disabled={inbox.page >= inbox.pageCount} onClick={() => controller.actions.onPageChange(inbox.page + 1)}>下一页</button>
          </div>
        </div>
      </section>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
