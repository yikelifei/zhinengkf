"use client";

import styles from "./conversation-workbench.module.css";
import { ConversationContextPane } from "./conversation-context-pane";
import { ConversationInboxPane } from "./conversation-inbox-pane";
import { ConversationThreadPane } from "./conversation-thread-pane";
import type { ConversationWorkbenchProps } from "./types";

export function ConversationWorkbench({
  inbox,
  thread,
  context,
  activePane,
  inboxCollapsed = false,
  actions,
  className = "",
}: ConversationWorkbenchProps) {
  return (
    <section
      className={`${styles.workbench} ${className}`.trim()}
      data-active-pane={activePane}
      data-inbox-collapsed={inboxCollapsed ? "true" : "false"}
      aria-label="会话管理工作台"
    >
      <ConversationInboxPane inbox={inbox} actions={actions} />
      <ConversationThreadPane thread={thread} actions={actions} />
      <ConversationContextPane context={context} actions={actions} />
    </section>
  );
}
