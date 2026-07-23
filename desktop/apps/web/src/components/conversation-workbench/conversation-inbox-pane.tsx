import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  Filter,
  MessageCircle,
  Search,
} from "lucide-react";
import styles from "./conversation-workbench.module.css";
import type { ConversationWorkbenchActions, ConversationWorkbenchInbox } from "./types";
import { WorkbenchAvatar, WorkbenchToneTag } from "./workbench-primitives";

type ConversationInboxPaneProps = {
  inbox: ConversationWorkbenchInbox;
  actions: ConversationWorkbenchActions;
};

export function ConversationInboxPane({ inbox, actions }: ConversationInboxPaneProps) {
  const pages = visiblePages(inbox.page, inbox.pageCount);

  return (
    <aside className={styles.inboxPane} aria-label="会话筛选与列表">
      <header className={styles.inboxHeader}>
        <div>
          <h2>{inbox.title}</h2>
          <span>{inbox.total} 个会话</span>
        </div>
        <button type="button" className={styles.iconButton} onClick={actions.onToggleInbox} aria-label="收起会话列表">
          <ChevronsLeft size={17} aria-hidden="true" />
        </button>
      </header>

      <div className={styles.scopeTabs} role="group" aria-label="会话处理状态">
        {inbox.scopeOptions.map((option) => {
          const active = option.value === inbox.scope;
          return (
            <button
              type="button"
              className={active ? styles.activeScope : undefined}
              aria-pressed={active}
              key={option.value}
              onClick={() => actions.onScopeChange(option.value)}
            >
              {option.label}{option.count !== undefined ? `(${option.count})` : ""}
            </button>
          );
        })}
      </div>

      <div className={styles.searchRow}>
        <label className={styles.searchBox}>
          <span className={styles.srOnly}>搜索客户或会话内容</span>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={inbox.search}
            placeholder={inbox.searchPlaceholder || "搜索客户或会话内容"}
            onChange={(event) => actions.onSearchChange(event.target.value)}
          />
        </label>
        {actions.onOpenFilter ? (
          <button type="button" className={styles.filterButton} onClick={actions.onOpenFilter} aria-label="打开高级筛选">
            <Filter size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className={styles.filterRow}>
        <FilterSelect label="渠道" value={inbox.channel} options={inbox.channelOptions} onChange={actions.onChannelChange} />
        <FilterSelect label="状态" value={inbox.status} options={inbox.statusOptions} onChange={actions.onStatusChange} />
        <FilterSelect label="排序" value={inbox.sort} options={inbox.sortOptions} onChange={actions.onSortChange} />
      </div>

      <div className={styles.conversationList} aria-busy={inbox.loading || undefined}>
        {inbox.error ? <div className={styles.errorState} role="alert">{inbox.error}</div> : null}
        {inbox.loading ? <div className={styles.loadingState} role="status">正在读取会话…</div> : null}
        {!inbox.loading && !inbox.error && inbox.conversations.length ? inbox.conversations.map((conversation) => {
          const selected = conversation.id === inbox.selectedConversationId;
          return (
            <button
              type="button"
              className={`${styles.conversationRow} ${selected ? styles.selectedConversation : ""}`.trim()}
              aria-pressed={selected}
              key={conversation.id}
              onClick={() => actions.onSelectConversation(conversation.id)}
            >
              <WorkbenchAvatar avatar={conversation.avatar} />
              <span className={styles.conversationCopy}>
                <span className={styles.conversationTitleLine}>
                  <strong>{conversation.title}</strong>
                  <time>{conversation.updatedAtLabel}</time>
                </span>
                <span className={styles.conversationMetaLine}>
                  <WorkbenchToneTag tone={conversation.channelTone}>
                    <MessageCircle size={12} aria-hidden="true" />{conversation.channelLabel}
                  </WorkbenchToneTag>
                  {conversation.subtitle ? <small>{conversation.subtitle}</small> : null}
                </span>
                <span className={styles.conversationPreview}>{conversation.preview}</span>
              </span>
              <span className={styles.conversationState}>
                {conversation.unreadCount ? <mark aria-label={`${conversation.unreadCount} 条未读`}>{conversation.unreadCount}</mark> : null}
                {conversation.stateLabel ? <em className={styles[`text-${conversation.stateTone || "neutral"}`]}>{conversation.stateLabel}</em> : null}
              </span>
            </button>
          );
        }) : null}
        {!inbox.loading && !inbox.error && !inbox.conversations.length ? (
          <div className={styles.emptyState} role="status">
            <MessageCircle size={22} aria-hidden="true" />
            <strong>{inbox.emptyTitle || "没有符合条件的会话"}</strong>
            <span>{inbox.emptyDetail || "调整筛选条件后重试。"}</span>
          </div>
        ) : null}
      </div>

      <footer className={styles.inboxFooter}>
        <span>共 {inbox.total} 条</span>
        <nav className={styles.pagination} aria-label="会话列表分页">
          <button type="button" onClick={() => actions.onPageChange(Math.max(1, inbox.page - 1))} disabled={inbox.page <= 1} aria-label="上一页">
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          {pages.map((page) => (
            <button
              type="button"
              className={page === inbox.page ? styles.activePage : undefined}
              aria-current={page === inbox.page ? "page" : undefined}
              key={page}
              onClick={() => actions.onPageChange(page)}
            >
              {page}
            </button>
          ))}
          <button type="button" onClick={() => actions.onPageChange(Math.min(inbox.pageCount, inbox.page + 1))} disabled={inbox.page >= inbox.pageCount} aria-label="下一页">
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </nav>
        <label className={styles.pageSize}>
          <span className={styles.srOnly}>每页条数</span>
          <select value={inbox.pageSize} onChange={(event) => actions.onPageSizeChange(Number(event.target.value))}>
            {(inbox.pageSizeOptions || [10, 20, 50]).map((size) => <option value={size} key={size}>{size} 条/页</option>)}
          </select>
        </label>
      </footer>
    </aside>
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
  options: ConversationWorkbenchInbox["channelOptions"];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className={styles.srOnly}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function visiblePages(page: number, pageCount: number) {
  if (pageCount <= 3) return Array.from({ length: Math.max(pageCount, 1) }, (_, index) => index + 1);
  const start = Math.min(Math.max(1, page - 1), pageCount - 2);
  return [start, start + 1, start + 2];
}
