import {
  ArrowLeft,
  ChevronDown,
  CircleCheck,
  Clock3,
  ListChecks,
  Pencil,
  Plus,
  Tag,
  UserRoundCheck,
} from "lucide-react";
import styles from "./conversation-workbench.module.css";
import type { ConversationWorkbenchActions, ConversationWorkbenchContext } from "./types";
import { WorkbenchAvatar, WorkbenchToneTag } from "./workbench-primitives";

type ConversationContextPaneProps = {
  context: ConversationWorkbenchContext | null;
  actions: ConversationWorkbenchActions;
};

export function ConversationContextPane({ context, actions }: ConversationContextPaneProps) {
  if (!context) {
    return (
      <aside className={styles.contextPane} aria-label="客户与会话运营信息">
        <div className={styles.contextEmpty} role="status">
          <UserRoundCheck size={24} aria-hidden="true" />
          <strong>尚未选择客户</strong>
          <span>选择会话后可查看客户资料、分配与 SLA。</span>
          <button type="button" onClick={() => actions.onPaneChange("inbox")}>打开会话列表</button>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.contextPane} aria-label="客户与会话运营信息">
      <div className={styles.contextMobileHeader}>
        <button type="button" onClick={() => actions.onPaneChange("thread")}>
          <ArrowLeft size={16} aria-hidden="true" />返回会话
        </button>
        <strong>会话详情</strong>
      </div>

      <section className={styles.contextSection} aria-labelledby="customer-profile-heading">
        <SectionHeader id="customer-profile-heading" title="客户资料" actionLabel="编辑" onAction={actions.onEditCustomer} />
        <div className={styles.customerIdentity}>
          <WorkbenchAvatar avatar={context.customer.avatar} size="large" />
          <div>
            <strong>{context.customer.name}</strong>
            {context.customer.wechatId ? <span>微信昵称：{context.customer.wechatId}</span> : null}
            {context.customer.region ? <span>地区：{context.customer.region}</span> : null}
            {context.customer.source ? <span>来源：{context.customer.source}</span> : null}
          </div>
          {context.customer.relationLabel ? <WorkbenchToneTag tone={context.customer.relationTone}>{context.customer.relationLabel}</WorkbenchToneTag> : null}
        </div>
      </section>

      <section className={styles.contextSection} aria-labelledby="customer-tags-heading">
        <SectionHeader id="customer-tags-heading" title="客户标签" actionLabel="添加标签" onAction={actions.onAddTag} icon="plus" />
        <div className={styles.customerTags}>
          {context.tags.length ? context.tags.map((tag) => <span key={tag}><Tag size={11} aria-hidden="true" />{tag}</span>) : <small>暂无标签</small>}
        </div>
      </section>

      <section className={styles.contextSection} aria-labelledby="customer-notes-heading">
        <SectionHeader id="customer-notes-heading" title="备注" actionLabel={context.notes ? "编辑" : "添加"} onAction={actions.onEditNotes} icon={context.notes ? "edit" : "plus"} />
        {context.notes ? <p className={styles.customerNotes}>{context.noteDateLabel ? `${context.noteDateLabel}：` : ""}{context.notes}</p> : <p className={styles.contextMuted}>暂无客户备注。</p>}
      </section>

      <section className={styles.contextSection} aria-labelledby="current-task-heading">
        <SectionHeader
          id="current-task-heading"
          title="当前设计任务"
          actionLabel={context.task && actions.onOpenTask ? "查看详情" : undefined}
          onAction={context.task && actions.onOpenTask ? () => actions.onOpenTask?.(context.task!.id) : undefined}
        />
        {context.task ? (
          <article className={styles.taskSummary}>
            <div><strong>{context.task.title}</strong><WorkbenchToneTag tone={context.task.stateTone}>{context.task.stateLabel}</WorkbenchToneTag></div>
            {context.task.taskNumber ? <span>任务编号：{context.task.taskNumber}</span> : null}
            {context.task.createdAtLabel ? <span>创建时间：{context.task.createdAtLabel}</span> : null}
            {context.task.requirements?.length ? <span>需求：{context.task.requirements.join("、")}</span> : null}
            {context.task.dueAtLabel ? <span>预计交付：{context.task.dueAtLabel}</span> : null}
          </article>
        ) : <p className={styles.contextMuted}>当前会话没有关联设计任务。</p>}
      </section>

      <section className={styles.contextSection} aria-labelledby="assignment-heading">
        <SectionHeader id="assignment-heading" title="会话分配" actionLabel="修改" onAction={actions.onEditAssignment} />
        <dl className={styles.detailList}>
          <div><dt>当前接待</dt><dd>{context.assignment.assignee}<WorkbenchToneTag tone={context.assignment.statusTone}>{context.assignment.statusLabel}</WorkbenchToneTag></dd></div>
          {context.assignment.team ? <div><dt>团队</dt><dd>{context.assignment.team}</dd></div> : null}
          {context.assignment.joinedAtLabel ? <div><dt>接入时间</dt><dd>{context.assignment.joinedAtLabel}</dd></div> : null}
        </dl>
        <div className={styles.assignmentActions}>
          <button type="button" onClick={actions.onTransfer}><UserRoundCheck size={14} aria-hidden="true" />转接会话</button>
          {actions.onEndConversation ? <button type="button" className={styles.dangerButton} onClick={actions.onEndConversation}>结束会话</button> : null}
        </div>
      </section>

      <section className={styles.contextSection} aria-labelledby="sla-heading">
        <SectionHeader id="sla-heading" title="分配与 SLA" />
        <div className={styles.slaStatusLine}>
          <WorkbenchToneTag tone={context.sla.stateTone}><Clock3 size={12} aria-hidden="true" />{context.sla.stateLabel}</WorkbenchToneTag>
          {context.sla.freshnessLabel ? <WorkbenchToneTag tone={context.sla.freshnessTone}>{context.sla.freshnessLabel}</WorkbenchToneTag> : null}
        </div>
        <dl className={styles.detailList}>
          {context.sla.priorityLabel ? <div><dt>优先级</dt><dd>{context.sla.priorityLabel}</dd></div> : null}
          {context.sla.lifecycleLabel ? <div><dt>处理状态</dt><dd>{context.sla.lifecycleLabel}</dd></div> : null}
          {context.sla.firstResponseLabel ? <div><dt>首次回复</dt><dd>{context.sla.firstResponseLabel}</dd></div> : null}
          {context.sla.deadlineLabel ? <div><dt>处理截止</dt><dd>{context.sla.deadlineLabel}</dd></div> : null}
        </dl>
      </section>

      {context.operationsSlot ? <div className={styles.operationsSlot}>{context.operationsSlot}</div> : null}

      <section className={styles.contextSection} aria-labelledby="safety-identity-heading">
        <SectionHeader id="safety-identity-heading" title="身份与发送校验" actionLabel="收起" onAction={actions.onToggleSafety} icon="collapse" />
        <dl className={styles.detailList}>
          <div><dt>接入账号</dt><dd>{context.safetyIdentity.accountLabel}{context.safetyIdentity.accountStateLabel ? <WorkbenchToneTag tone="success">{context.safetyIdentity.accountStateLabel}</WorkbenchToneTag> : null}</dd></div>
          <div><dt>会话类型</dt><dd>{context.safetyIdentity.channelLabel}</dd></div>
          {context.safetyIdentity.windowLabel ? <div><dt>当前窗口</dt><dd>{context.safetyIdentity.windowLabel}</dd></div> : null}
          {context.safetyIdentity.recentMessageLabel ? <div><dt>最近消息</dt><dd>{context.safetyIdentity.recentMessageLabel}</dd></div> : null}
          {context.safetyIdentity.bridgeLabel ? <div><dt>桥接状态</dt><dd><WorkbenchToneTag tone={context.safetyIdentity.bridgeTone}>{context.safetyIdentity.bridgeLabel}</WorkbenchToneTag></dd></div> : null}
        </dl>
      </section>

      {context.quickActions.length && actions.onQuickAction ? (
        <section className={styles.contextSection} aria-labelledby="quick-actions-heading">
          <SectionHeader id="quick-actions-heading" title="快捷操作" />
          <div className={styles.quickActions}>
            {context.quickActions.map((action) => (
              <button type="button" className={styles[`quick-${action.tone || "neutral"}`]} onClick={() => actions.onQuickAction?.(action.id)} disabled={action.disabled} key={action.id}>
                <ListChecks size={14} aria-hidden="true" />{action.label}<ChevronDown size={13} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </aside>
  );
}

function SectionHeader({
  id,
  title,
  actionLabel,
  onAction,
  icon,
}: {
  id: string;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: "plus" | "edit" | "collapse";
}) {
  return (
    <header className={styles.contextSectionHeader}>
      <h3 id={id}>{title}</h3>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>
          {icon === "plus" ? <Plus size={13} aria-hidden="true" /> : icon === "edit" ? <Pencil size={12} aria-hidden="true" /> : icon === "collapse" ? <ChevronDown size={13} aria-hidden="true" /> : <CircleCheck size={12} aria-hidden="true" />}
          {actionLabel}
        </button>
      ) : null}
    </header>
  );
}
