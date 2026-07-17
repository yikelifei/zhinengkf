"use client";

import { AlertTriangle, CheckCircle2, PlayCircle, RefreshCw, Route, SearchCheck, ShieldAlert, X } from "lucide-react";
import type { RoutingFeatureApi } from "./api";
import { presentInboundProcess, presentRouteEvaluation } from "./model";
import styles from "./routing-feature-page.module.css";
import { useRoutingController } from "./use-routing-controller";

export type RoutingFeaturePageProps = {
  api?: RoutingFeatureApi;
  className?: string;
};

export function RoutingFeaturePage({ api, className = "" }: RoutingFeaturePageProps) {
  const controller = useRoutingController(api);

  if (controller.accessPhase === "loading") {
    return <RoutingState className={className} title="正在确认路由判断权限" detail="权限确认后才会读取真实会话。" busy />;
  }
  if (controller.accessPhase === "error") {
    return (
      <RoutingState
        className={className}
        title="无法确认路由判断权限"
        detail={controller.accessError}
        tone="danger"
        actionLabel="重新检查"
        actionId="routing-access-retry"
        onAction={() => void controller.refresh()}
      />
    );
  }
  if (controller.accessPhase === "denied") {
    return (
      <RoutingState
        className={className}
        title="当前操作员不能查看路由判断"
        detail={controller.permissionDetail || "权限策略采用默认拒绝，未授予 view_console。"}
        tone="warning"
        actionLabel="重新检查权限"
        actionId="routing-permission-retry"
        onAction={() => void controller.refresh()}
      />
    );
  }

  return (
    <section className={`${styles.page} ${className}`.trim()} aria-label="路由判断" data-feature="routing">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>消息分流</span>
          <h1>路由判断</h1>
          <p>只负责判断客户消息应进入哪个场景、价值层级和处理动作。</p>
        </div>
        <button
          type="button"
          className={styles.refreshButton}
          data-action-id="routing-refresh"
          aria-label="刷新可选会话"
          disabled={Boolean(controller.busy)}
          onClick={() => void controller.refresh()}
        >
          <RefreshCw size={16} aria-hidden="true" />刷新会话
        </button>
      </header>

      {controller.conversationsError ? <div className={styles.errorNotice} role="alert">{controller.conversationsError}</div> : null}
      {controller.actionError ? <div className={styles.errorNotice} role="alert">{controller.actionError}</div> : null}
      {controller.actionNotice ? <div className={styles.successNotice} role="status">{controller.actionNotice}</div> : null}

      <section className={styles.inputCard} aria-labelledby="routing-input-title">
        <div className={styles.sectionHeading}>
          <span>1</span>
          <div><h2 id="routing-input-title">选择会话并输入客户消息</h2><p>会话身份会随请求发送，系统不会默认使用第一个客户。</p></div>
        </div>
        <div className={styles.inputGrid}>
          <label>
            <span>客户会话</span>
            <select
              value={controller.selectedConversationId}
              aria-label="选择要判断的客户会话"
              disabled={Boolean(controller.busy) || Boolean(controller.conversationsError)}
              onChange={(event) => controller.setSelectedConversationId(event.target.value)}
            >
              <option value="">请选择客户会话</option>
              {controller.conversations.map((conversation) => (
                <option value={conversation.id} key={conversation.id}>
                  {conversation.customer?.name || conversation.title} · {conversation.wechatAccount?.displayName || conversation.wechatAccountId}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.messageField}>
            <span>客户消息</span>
            <textarea
              value={controller.messageText}
              maxLength={5000}
              rows={6}
              aria-label="输入要判断的客户消息"
              placeholder="粘贴或输入客户的原始消息"
              disabled={Boolean(controller.busy)}
              onChange={(event) => controller.setMessageText(event.target.value)}
            />
            <small>{controller.messageText.length}/5000</small>
          </label>
        </div>
      </section>

      <section className={styles.actionSection} aria-labelledby="routing-action-title">
        <div className={styles.sectionHeading}>
          <span>2</span>
          <div><h2 id="routing-action-title">选择执行方式</h2><p>两种操作的业务影响不同，请按真实目的选择。</p></div>
        </div>
        <div className={styles.actionGrid}>
          <article className={styles.evaluateCard}>
            <SearchCheck size={22} aria-hidden="true" />
            <div>
              <strong>仅评估</strong>
              <p>不会写入客户消息或触发后续业务流程，只返回路由判断结果。</p>
            </div>
            <button
              type="button"
              data-action-id="routing-evaluate-only"
              aria-label="仅评估路由，不处理客户消息"
              disabled={Boolean(controller.busy)}
              onClick={() => void controller.evaluateOnly()}
            >
              <SearchCheck size={16} aria-hidden="true" />
              {controller.busy === "evaluate" ? "评估中" : "仅评估路由"}
            </button>
          </article>
          <article className={styles.processCard}>
            <PlayCircle size={22} aria-hidden="true" />
            <div>
              <strong>处理客户消息</strong>
              <p>会写入客户消息，并可能创建任务、报价、订单或发送任务。</p>
              {!controller.canProcess ? <small>当前操作员没有回复会话权限，此操作已禁用。</small> : null}
            </div>
            <button
              type="button"
              data-action-id="routing-process-message"
              aria-label="处理客户消息并执行后端业务流程"
              disabled={Boolean(controller.busy) || !controller.canProcess}
              onClick={controller.requestProcessing}
            >
              <PlayCircle size={16} aria-hidden="true" />
              {controller.busy === "process" ? "处理中" : "处理客户消息"}
            </button>
          </article>
        </div>
      </section>

      {controller.processConfirmationOpen ? (
        <div
          className={styles.confirmation}
          role="region"
          aria-live="polite"
          aria-labelledby="routing-process-confirm-title"
          aria-describedby="routing-process-confirm-detail"
        >
          <AlertTriangle size={22} aria-hidden="true" />
          <div>
            <strong id="routing-process-confirm-title">确认执行“处理客户消息”？</strong>
            <p id="routing-process-confirm-detail">
              这不是预览：消息会写入所选会话，并由服务端执行路由计划。任务、报价、订单或发送队列等副作用以返回结果为准。
            </p>
          </div>
          <div className={styles.confirmationActions}>
            <button
              type="button"
              data-action-id="routing-process-cancel"
              aria-label="取消处理客户消息"
              onClick={() => controller.setProcessConfirmationOpen(false)}
            >
              <X size={15} aria-hidden="true" />取消
            </button>
            <button
              type="button"
              className={styles.dangerButton}
              data-action-id="routing-process-confirm"
              aria-label="确认处理客户消息"
              onClick={() => void controller.confirmProcessing()}
            >
              <PlayCircle size={15} aria-hidden="true" />确认执行
            </button>
          </div>
        </div>
      ) : null}

      {controller.route ? (
        <RouteResult
          route={controller.route}
          processResult={controller.processResult}
          resultKind={controller.resultKind}
        />
      ) : (
        <section className={styles.emptyResult} aria-label="路由判断结果" role="status">
          <Route size={24} aria-hidden="true" />
          <strong>尚未执行路由判断</strong>
          <p>完成会话与消息输入后，选择“仅评估”或“处理客户消息”。</p>
        </section>
      )}
    </section>
  );
}

function RouteResult({
  route,
  processResult,
  resultKind,
}: {
  route: NonNullable<ReturnType<typeof useRoutingController>["route"]>;
  processResult: ReturnType<typeof useRoutingController>["processResult"];
  resultKind: ReturnType<typeof useRoutingController>["resultKind"];
}) {
  const presentation = presentRouteEvaluation(route);
  const processed = processResult ? presentInboundProcess(processResult) : null;
  return (
    <section className={styles.resultCard} aria-labelledby="routing-result-title">
      <header className={styles.resultHeader}>
        <div>
          <span className={resultKind === "processed" ? styles.processedBadge : styles.evaluatedBadge}>
            {resultKind === "processed" ? "已执行处理" : "仅评估结果"}
          </span>
          <h2 id="routing-result-title">路由判断结果</h2>
        </div>
        <span className={styles.confidence}>置信度 {presentation.confidence}</span>
      </header>

      <dl className={styles.resultGrid}>
        <div><dt>场景</dt><dd><strong>{presentation.scene}</strong><span>{presentation.sceneDetail}</span></dd></div>
        <div><dt>价值</dt><dd><strong>{presentation.valueTier}</strong><span>{presentation.valueDetail}</span></dd></div>
        <div><dt>动作</dt><dd><strong>{presentation.action}</strong><span>{presentation.actionDetail}</span></dd></div>
        <div><dt>处理方</dt><dd><strong>{presentation.handler}</strong><span>{presentation.nextStep}</span></dd></div>
      </dl>

      <div className={styles.fieldSection}>
        <h3>待补字段</h3>
        {presentation.missingFields.length ? (
          <ul>{presentation.missingFields.map((field) => <li key={field}>{field}</li>)}</ul>
        ) : <p><CheckCircle2 size={15} aria-hidden="true" />当前路由结果未报告待补字段。</p>}
      </div>

      {presentation.riskFlags.length ? (
        <div className={styles.riskSection} role="note">
          <strong>风险标记</strong>
          <ul>{presentation.riskFlags.map((risk) => <li key={risk}>{risk}</li>)}</ul>
        </div>
      ) : null}

      {presentation.safeguards.length ? (
        <div className={styles.safeguards}><strong>安全约束</strong><ul>{presentation.safeguards.map((item) => <li key={item}>{item}</li>)}</ul></div>
      ) : null}

      {route.suggestedReply ? (
        <div className={styles.replyDraft}>
          <strong>建议回复（不会在本页自动发送）</strong>
          <p>{route.suggestedReply}</p>
        </div>
      ) : null}

      {processed ? (
        <section className={styles.processSummary} aria-labelledby="process-summary-title">
          <h3 id="process-summary-title">服务端处理回执</h3>
          <dl>
            <div><dt>消息记录</dt><dd>{processed.messageId}</dd></div>
            <div><dt>计划类型</dt><dd>{processed.planType}</dd></div>
            <div><dt>计划原因</dt><dd>{processed.reason}</dd></div>
          </dl>
          {processed.artifacts.length ? <ul>{processed.artifacts.map((artifact) => <li key={artifact}>{artifact}</li>)}</ul> : <p>服务端未返回新建任务、报价、订单或发送任务。</p>}
          {processed.missingFields.length ? <p>计划仍需补齐：{processed.missingFields.join("、")}</p> : null}
        </section>
      ) : null}
    </section>
  );
}

function RoutingState({
  className,
  title,
  detail,
  busy = false,
  tone = "neutral",
  actionLabel,
  actionId,
  onAction,
}: {
  className: string;
  title: string;
  detail: string;
  busy?: boolean;
  tone?: "neutral" | "warning" | "danger";
  actionLabel?: string;
  actionId?: string;
  onAction?: () => void;
}) {
  return (
    <section className={`${styles.page} ${className}`.trim()} aria-label="路由判断">
      <div className={`${styles.stateCard} ${styles[`state-${tone}`]}`} role={tone === "danger" ? "alert" : "status"} aria-busy={busy || undefined}>
        {tone === "neutral" ? <RefreshCw size={24} aria-hidden="true" /> : <ShieldAlert size={24} aria-hidden="true" />}
        <h1>{title}</h1><p>{detail}</p>
        {actionLabel && onAction ? <button type="button" data-action-id={actionId} aria-label={actionLabel} onClick={onAction}>{actionLabel}</button> : null}
      </div>
    </section>
  );
}
