import { Brush, CheckCircle2, ChevronRight, FileText, GraduationCap, PackageSearch, Send, ShoppingCart } from "lucide-react";
import Link from "next/link";
import type { ConversationWorkbenchWorkflowAction } from "./types";
import styles from "./conversation-workflow-rail.module.css";

type ConversationWorkflowRailProps = {
  actions: ConversationWorkbenchWorkflowAction[];
};

const icons = {
  bundle: PackageSearch,
  design: Brush,
  quote: FileText,
  order: ShoppingCart,
  review: CheckCircle2,
  send: Send,
  training: GraduationCap,
};

export function ConversationWorkflowRail({ actions }: ConversationWorkflowRailProps) {
  if (!actions.length) return null;
  return (
    <nav className={styles.workflowRail} aria-label="会话业务流程">
      {actions.map((action) => {
        const Icon = icons[action.icon];
        return (
          <Link
            className={styles.workflowLink}
            data-action-id={`conversations.workflow-${action.id}.open`}
            href={action.href}
            key={action.id}
            aria-label={action.label}
          >
            <Icon size={15} aria-hidden="true" />
            <span>
              <strong>{action.label}</strong>
              <small>{action.detail}</small>
            </span>
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        );
      })}
    </nav>
  );
}
