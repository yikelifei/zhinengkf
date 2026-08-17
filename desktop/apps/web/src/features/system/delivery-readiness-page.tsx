"use client";
import { FileCheck2, RefreshCw, ShieldAlert } from "lucide-react";
import { type DeliveryEvidenceReport, type DeliveryLocalDeliveryVerdict, type DeliveryReadiness, type DeliveryReadinessBlocker } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { SummaryCard } from "./delivery-readiness-summary-card";
import { deliveryEvidenceFreshnessLabel, formatDeliveryEvidenceTime } from "./delivery-readiness-freshness";
import { useDeliveryReadiness } from "./use-delivery-readiness";
export function DeliveryReadinessPage() {
  const { readiness, busy, error, readState, refresh } = useDeliveryReadiness();
  return (
    <section className={styles.page} aria-labelledby="delivery-readiness-page-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Delivery</span>
          <h1 id="delivery-readiness-page-title">交付验收</h1>
          <p className={styles.description}>只读汇总完成度审计、产品验收、发布门禁、预发布、恢复、Windows 和 handoff 证据。</p>
        </div>
        <button
          type="button"
          className={styles.button}
          data-action-id="delivery-readiness-refresh"
          onClick={() => void refresh()}
          disabled={busy}
        >
          <RefreshCw size={16} aria-hidden="true" />
          刷新交付状态
        </button>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {readState === "stale" ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">最新刷新失败，当前仅保留上次成功读取的交付报告；不得据此继续发布，请刷新成功后再判断。</div> : null}

      {readiness ? (
        <>
          <section className={styles.panel} aria-labelledby="delivery-summary-title">
            <header className={styles.panelHeader}>
              <div>
                <h2 id="delivery-summary-title">交付判断</h2>
                <p>当前状态来自离线报告清单，不会执行命令、联网或写入外部系统。</p>
              </div>
              <span className={`${styles.badge} ${readState === "ready" ? statusTone(readiness.status) : styles.toneWarning}`}>{readState === "ready" ? statusLabel(readiness.status) : "旧报告 / 待刷新"}</span>
            </header>
            <div className={styles.panelBody}>
              <div className={styles.summaryGrid}>
                <SummaryCard label="完成度 PASS" value={String(readiness.projectAudit.counts.pass)} />
                <SummaryCard label="完成度 BLOCKED" value={String(readiness.projectAudit.counts.blocked)} />
                <SummaryCard label="验收通过" value={String(readiness.acceptance.summary.passed)} />
                <SummaryCard label="验收失败" value={String(readiness.acceptance.summary.failed)} />
                <SummaryCard label="证据报告" value={String(readiness.evidenceReports.filter((item) => item.available).length)} />
                <SummaryCard label="证据 FAIL" value={String(readiness.evidenceReports.reduce((total, item) => total + item.counts.fail, 0))} />
                <SummaryCard label="证据时效" value={deliveryEvidenceFreshnessLabel(readiness.freshness)} />
              </div>
              <div className={`${styles.notice} ${readiness.status === "failed" ? styles.noticeError : styles.noticeInfo}`}>
                <strong>下一步</strong>
                <p>{readiness.nextAction}</p>
              </div>
              <div className={`${styles.notice} ${styles.noticeWarning}`} role="note">
                <strong>仅供开发 / 发布工作区执行</strong>
                <p>
                  下列命令用于生成随版本交付的验收证据，不能在本运营页或生产服务器直接执行。
                  当前按 {readiness.commandEnvironment?.shell === "windows" ? "Windows" : "Linux / macOS"} 命令格式展示。
                </p>
              </div>
              {readiness.recommendedCommands.length ? (
                <div className={styles.recordList} aria-label="开发或发布工作区建议命令">
                  {readiness.recommendedCommands.map((item) => (
                    <article className={styles.record} key={item.command}>
                      <header className={styles.recordHeader}>
                        <div>
                          <h3>{item.label}</h3>
                          <p>{item.reason}</p>
                        </div>
                      </header>
                      <pre className={styles.codeBlock}>{item.command}</pre>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <LocalDeliveryVerdictPanel verdict={readiness.localDelivery} />
          <ReleaseCandidateScopePanel scope={readiness.releaseCandidateScope} />
          <section className={styles.panel} aria-labelledby="delivery-reports-title">
            <header className={styles.panelHeader}>
              <div>
                <h2 id="delivery-reports-title">证据报告</h2>
                <p>报告路径保持仓库相对路径，便于交付时复查对应 JSON/Markdown 证据。</p>
              </div>
              <span className={`${styles.badge} ${readiness.networkCalls ? styles.toneError : styles.toneOk}`}>
                只读
              </span>
            </header>
            <div className={styles.panelBody}>
              <dl className={styles.definitionList}>
                <div>
                  <dt>项目完成度</dt>
                  <dd>{readiness.projectAudit.available ? readiness.projectAudit.status : "未生成"}</dd>
                </div>
                <div>
                  <dt>产品验收报告</dt>
                  <dd>{readiness.acceptance.available ? readiness.acceptance.runId : "未生成"}</dd>
                </div>
                <div>
                  <dt>产品模式</dt>
                  <dd>{productModeLabel(readiness.productMode)}</dd>
                </div>
                <div>
                  <dt>交付 handoff</dt>
                  <dd>{readiness.evidenceReports.find((item) => item.id === "delivery_handoff")?.status || "未生成"}</dd>
                </div>
                <div>
                  <dt>冻结计划</dt>
                  <dd>{readiness.evidenceReports.find((item) => item.id === "release_freeze_plan")?.status || "未生成"}</dd>
                </div>
                <div>
                  <dt>发布门禁</dt>
                  <dd>{readiness.evidenceReports.find((item) => item.id === "release_gate")?.status || "未生成"}</dd>
                </div>
                <div>
                  <dt>Windows 预检</dt>
                  <dd>{readiness.evidenceReports.find((item) => item.id === "windows_package")?.status || "未生成"}</dd>
                </div>
              </dl>
              <pre className={styles.codeBlock}>{[
                readiness.projectAudit.reportPath && `completion=${readiness.projectAudit.reportPath}`,
                readiness.acceptance.reportPath && `acceptance=${readiness.acceptance.reportPath}`,
                ...readiness.evidenceReports.map((item) => item.reportPath && `${item.id}=${item.reportPath}`),
              ].filter(Boolean).join("\n") || "暂无可复查报告路径"}</pre>
              <div className={styles.recordList} aria-label="交付证据报告">
                {readiness.evidenceReports.map((report) => <EvidenceReportRecord key={report.id} report={report} />)}
              </div>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="delivery-blockers-title">
            <header className={styles.panelHeader}>
              <div>
                <h2 id="delivery-blockers-title">阻塞项</h2>
                <p>外部阻塞不会算作代码失败，但上线前必须有负责人和验收记录。</p>
              </div>
              <span className={`${styles.badge} ${readiness.blockers.length ? styles.toneWarning : styles.toneOk}`}>
                {readiness.blockers.length ? `${readiness.blockers.length} 项` : "无阻塞"}
              </span>
            </header>
            <div className={styles.panelBody}>
              {readiness.blockers.length ? (
                <div className={styles.recordList}>
                  {readiness.blockers.map((blocker) => <BlockerRecord key={`${blocker.source}:${blocker.id}`} blocker={blocker} />)}
                </div>
              ) : (
                <div className={styles.empty}>
                  <FileCheck2 size={22} aria-hidden="true" />
                  <span>当前报告没有失败或阻塞项。</span>
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <section className={styles.panel} aria-label="交付验收状态不可用">
          <div className={styles.empty}>尚未取得交付验收报告，不能据此判定项目可上线。</div>
        </section>
      )}
    </section>
  );
}

function LocalDeliveryVerdictPanel({ verdict }: { verdict: DeliveryLocalDeliveryVerdict }) {
  return (
    <section className={styles.panel} aria-labelledby="local-delivery-verdict-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="local-delivery-verdict-title">本地交付判定</h2>
          <p>把仓库代码失败、本地证据未闭环和签名/备案/真实联调等外部阻断分开显示。</p>
        </div>
        <span className={`${styles.badge} ${localDeliveryTone(verdict.state)}`}>{verdict.label}</span>
      </header>
      <div className={styles.panelBody}>
        <div className={styles.summaryGrid}>
          <SummaryCard label="代码失败" value={String(verdict.localCodeDefectCount)} />
          <SummaryCard label="本地证据阻塞" value={String(verdict.localEvidenceBlockerCount)} />
          <SummaryCard label="外部阻断" value={String(verdict.externalBlockerCount)} />
          <SummaryCard label="允许正式发布" value={verdict.productionReleaseAllowed ? "是" : "否"} />
        </div>
        <div className={`${styles.notice} ${verdict.state === "local_failed" ? styles.noticeError : verdict.localEvidenceReady ? styles.noticeInfo : styles.noticeWarning}`}>
          <strong>{verdict.label}</strong>
          <p>{verdict.summary}</p>
        </div>
        {verdict.externalBlockerIds.length ? (
          <pre className={styles.codeBlock}>{verdict.externalBlockerIds.join("\n")}</pre>
        ) : null}
      </div>
    </section>
  );
}

function ReleaseCandidateScopePanel({ scope }: { scope: DeliveryReadiness["releaseCandidateScope"] }) {
  const highRiskGroups = scope.groups.filter((group) => group.risk === "high").length;
  return (
    <section className={styles.panel} aria-labelledby="release-candidate-scope-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="release-candidate-scope-title">发布候选范围</h2>
          <p>来自交付 handoff 的 git 状态分组，用于冻结上线候选范围。</p>
        </div>
        <span className={`${styles.badge} ${scopeTone(scope)}`}>
          {scopeLabel(scope)}
        </span>
      </header>
      <div className={styles.panelBody}>
        <div className={styles.summaryGrid}>
          <SummaryCard label="候选改动" value={String(scope.statusEntryCount)} />
          <SummaryCard label="已修改" value={String(scope.modifiedCount)} />
          <SummaryCard label="未跟踪" value={String(scope.untrackedCount)} />
          <SummaryCard label="高风险组" value={String(highRiskGroups)} />
        </div>
        {!scope.available ? (
          <div className={`${styles.notice} ${styles.noticeWarning}`}>
            <strong>范围未生成</strong>
            <p>{scope.reportPath ? "handoff 报告缺少发布候选范围。" : "尚未生成 handoff 报告。"}</p>
          </div>
        ) : (
          <>
            {scope.riskNotes.length ? (
              <div className={`${styles.notice} ${scope.requiresCleanReleaseWorkspace ? styles.noticeWarning : styles.noticeInfo}`}>
                <strong>风险提示</strong>
                <p>{scope.riskNotes.join(" ")}</p>
              </div>
            ) : null}
            <div className={styles.recordList} aria-label="发布候选范围分组">
              {scope.groups.map((group) => (
                <article className={styles.record} key={group.id}>
                  <header className={styles.recordHeader}>
                    <div>
                      <h3>{group.label}</h3>
                      <p>{group.count} 个文件，{group.modified} 个已修改，{group.untracked} 个未跟踪。</p>
                    </div>
                    <span className={`${styles.badge} ${riskTone(group.risk)}`}>{riskLabel(group.risk)}</span>
                  </header>
                  <pre className={styles.codeBlock}>{group.paths.join("\n") || "无路径样本"}</pre>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function EvidenceReportRecord({ report }: { report: DeliveryEvidenceReport }) {
  return (
    <article className={styles.record}>
      <header className={styles.recordHeader}>
        <div>
          <h3>{report.label}</h3>
          <p>{report.summary || (report.available ? "报告未提供摘要。" : "报告未生成。")}</p>
        </div>
        <span className={`${styles.badge} ${reportStatusTone(report.status, report.available)}`}>
          {reportStatusLabel(report.status, report.available)}
        </span>
      </header>
      <div className={styles.recordMeta}>
        <span>{report.mode || "offline"}</span>
        <span>生成于 {formatDeliveryEvidenceTime(report.generatedAt)}</span>
        <span>PASS {report.counts.pass}</span>
        <span>BLOCKED {report.counts.blocked}</span>
        <span>FAIL {report.counts.fail}</span>
      </div>
      <pre className={styles.codeBlock}>{report.reportPath || `开发 / 发布工作区生成：${report.command}`}</pre>
    </article>
  );
}

function BlockerRecord({ blocker }: { blocker: DeliveryReadinessBlocker }) {
  return (
    <article className={styles.record}>
      <header className={styles.recordHeader}>
        <div>
          <h3>{blocker.title}</h3>
          <p>{blocker.summary || "报告未提供补充说明。"}</p>
        </div>
        <span className={`${styles.badge} ${blocker.status === "failed" ? styles.toneError : styles.toneWarning}`}>
          {blocker.status === "failed" ? "失败" : "阻塞"}
        </span>
      </header>
      <div className={styles.recordMeta}>
        <span>{blocker.source}</span>
        <span>{blocker.external ? "外部条件" : "内部处理"}</span>
        <span>{phaseLabel(blocker.phase)}</span>
        <span>{blocker.ownerHint}</span>
        <span>{blocker.id}</span>
      </div>
      {blocker.actionItems?.length ? (
        <ol className={styles.compactList} aria-label="阻塞项处理步骤">
          {blocker.actionItems.map((item) => <li key={item}>{item}</li>)}
        </ol>
      ) : null}
      {blocker.command ? <pre className={styles.codeBlock}>{`开发 / 发布工作区执行：${blocker.command}`}</pre> : null}
      {blocker.external ? (
        <div className={`${styles.notice} ${styles.noticeWarning}`}>
          <ShieldAlert size={16} aria-hidden="true" />
          <p>需要备案、签名、真实账号、真实回调或独立环境等外部条件后才能关闭。</p>
        </div>
      ) : null}
    </article>
  );
}

function statusLabel(status: DeliveryReadiness["status"]) {
  return {
    ready: "可交付",
    blocked: "外部阻塞",
    failed: "存在失败",
    unknown: "证据不足",
  }[status];
}

function statusTone(status: DeliveryReadiness["status"]) {
  return {
    ready: styles.toneOk,
    blocked: styles.toneWarning,
    failed: styles.toneError,
    unknown: styles.toneMuted,
  }[status];
}

function localDeliveryTone(state: DeliveryLocalDeliveryVerdict["state"]) {
  if (state === "local_verified") return styles.toneOk;
  if (state === "local_verified_external_blocked") return styles.toneWarning;
  if (state === "local_failed") return styles.toneError;
  return styles.toneMuted;
}

function reportStatusLabel(status: string, available: boolean) {
  if (!available) return "未生成";
  if (status === "PASS") return "通过";
  if (status === "FAIL") return "失败";
  if (status === "BLOCKED") return "阻塞";
  return status || "未知";
}

function reportStatusTone(status: string, available: boolean) {
  if (!available) return styles.toneMuted;
  if (status === "PASS") return styles.toneOk;
  if (status === "FAIL") return styles.toneError;
  if (status === "BLOCKED") return styles.toneWarning;
  return styles.toneMuted;
}

function phaseLabel(phase: DeliveryReadinessBlocker["phase"]) {
  return {
    during_icp: "备案期间可准备",
    after_icp: "备案后验证",
    release_gate: "发布门禁",
  }[phase] || phase;
}

function productModeLabel(mode: string) {
  return mode === "enterprise_wechat_only" ? "仅企业微信" : mode || "未声明";
}

function scopeLabel(scope: DeliveryReadiness["releaseCandidateScope"]) {
  if (!scope.available) return "未生成";
  return scope.requiresCleanReleaseWorkspace ? "需冻结" : "已干净";
}

function scopeTone(scope: DeliveryReadiness["releaseCandidateScope"]) {
  if (!scope.available) return styles.toneMuted;
  return scope.requiresCleanReleaseWorkspace ? styles.toneWarning : styles.toneOk;
}

function riskLabel(risk: string) {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "中风险";
  if (risk === "low") return "低风险";
  return risk || "未知";
}

function riskTone(risk: string) {
  if (risk === "high") return styles.toneError;
  if (risk === "medium") return styles.toneWarning;
  if (risk === "low") return styles.toneMuted;
  return styles.toneMuted;
}
