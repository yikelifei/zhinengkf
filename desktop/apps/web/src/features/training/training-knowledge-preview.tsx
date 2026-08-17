"use client";

import type { KnowledgeImportResult } from "../../lib/api";
import styles from "../governance-pages.module.css";

export function KnowledgePreview({
  result,
  onConfirm,
  busy,
}: {
  result: KnowledgeImportResult;
  onConfirm: () => void;
  busy: boolean;
}) {
  const acceptance = result.acceptance;
  const saved = result.saved;
  return (
    <section className={styles.panel} aria-labelledby="training-knowledge-preview-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="training-knowledge-preview-title">知识导入预览</h2>
          <p>可写入 {result.rows.length} 条，错误 {result.errors.length} 条。</p>
        </div>
      </header>
      <div className={styles.panelBody}>
        {acceptance ? (
          <div className={styles.recordGrid} aria-label="知识导入验收摘要" data-knowledge-import-acceptance-summary>
            <Metric label="可直接验收" value={acceptance.readyCount} />
            <Metric label="待复核" value={acceptance.needsReviewCount} />
            <Metric label="缺 Agent" value={acceptance.missingAgentCount} />
            <Metric label="缺标签" value={acceptance.missingTagsCount} />
            <Metric label="正文过短" value={acceptance.shortContentCount} />
            <Metric label="阻断项" value={acceptance.blocked ? acceptance.blockers.length || 1 : 0} />
          </div>
        ) : null}

        {saved ? (
          <div className={styles.recordGrid} aria-label="知识写入结果" data-knowledge-import-save-summary>
            <Metric label="已写入" value={saved.count} />
            <Metric label="跳过" value={saved.skipped?.length || 0} />
            <Metric label="写入失败" value={saved.failed ? 1 : 0} />
          </div>
        ) : null}

        {result.errors.length ? (
          <ul className={styles.recordList}>
            {result.errors.slice(0, 12).map((error, index) => (
              <li className={styles.record} key={`${error.line}-${index}`}>第 {error.line} 行：{error.message}</li>
            ))}
          </ul>
        ) : null}

        {acceptance?.nextActions.length ? (
          <ul className={styles.recordList} aria-label="知识导入下一步" data-knowledge-import-next-actions>
            {acceptance.nextActions.map((item) => <li className={styles.record} key={item}>{item}</li>)}
          </ul>
        ) : null}

        {acceptance?.blockers.length ? (
          <ul className={styles.recordList} aria-label="知识导入阻断项" data-knowledge-import-blockers>
            {acceptance.blockers.map((item) => <li className={styles.record} key={item}>{item}</li>)}
          </ul>
        ) : null}

        <div className={styles.recordList}>
          {result.rows.slice(0, 8).map((row) => (
            <article className={styles.record} key={`${row.title}-${row.content.slice(0, 12)}`}>
              <div className={styles.recordHeader}>
                <div>
                  <h3>{row.title}</h3>
                  <p>{(row.tags || []).join("、") || "待补齐场景标签"}</p>
                </div>
                <span className={styles.badge}>{row.qualityScore ?? 70}</span>
              </div>
            </article>
          ))}
        </div>

        <div className={styles.actionBar}>
          <p className={styles.helpText}>写入后进入知识库验收；低分、缺标签或缺 Agent 不会自动应用为 Agent 技能。</p>
          {saved ? (
            <p className={styles.helpText} data-knowledge-import-saved-next>已写入知识库，请进入知识库运营页复核；复核通过前不会自动应用为 Agent Skill。</p>
          ) : (
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="training-knowledge-save-request"
              onClick={onConfirm}
              disabled={busy || !result.ok || !result.rows.length}
            >
              确认写入知识库
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return <div className={styles.summaryCard}><span>{label}</span><strong>{typeof value === "number" ? value : "-"}</strong></div>;
}
