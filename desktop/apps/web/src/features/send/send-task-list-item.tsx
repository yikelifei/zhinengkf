import Link from "next/link";
import type { SendTask } from "../../lib/api";
import { sendStatusLabel, taskCustomerLabel, taskMessagePreview } from "./send-policy";
import styles from "./send-pages.module.css";

export function SendTaskListItem({ task, href }: { task: SendTask; href: string }) {
  return (
    <article className={styles.taskListItem}>
      <div>
        <h3>{task.conversation?.title || task.conversationId || "未绑定会话"}</h3>
        <p>{taskCustomerLabel(task)} · {taskMessagePreview(task)}</p>
        <small>任务 ID：{task.id}</small>
      </div>
      <div className={styles.taskListItemActions}>
        <span className={styles.statusBadge}>{sendStatusLabel(task.status)}</span>
        <Link className={styles.primaryLink} href={href}>打开任务</Link>
      </div>
    </article>
  );
}
