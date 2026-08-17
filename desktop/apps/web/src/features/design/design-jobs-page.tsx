"use client";

import { Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { designCommerceState } from "./design-commerce-state";
import styles from "./design-pages.module.css";
import { DesignEmpty, DesignNotice, DesignPageHeader, formatDesignDate } from "./design-ui";
import { useDesignJobs } from "./use-design-job";

export function DesignJobsPage() {
  const { records, loading, loaded, error, refresh } = useDesignJobs();
  return (
    <section className={styles.page} aria-label="设计任务列表">
      <DesignPageHeader
        eyebrow="设计平台"
        title="设计任务列表"
        detail="本页只负责查看和打开真实任务；预检提交与远端状态同步分别在独立页面执行。"
        actions={(
          <>
            <Link href="/design/jobs/new" data-action-id="design-jobs-open-create"><Plus size={16} aria-hidden="true" />新建设计任务</Link>
            <button type="button" data-action-id="design-jobs-refresh" aria-label="刷新设计任务列表" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新列表</button>
          </>
        )}
      />
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}
      <article className={styles.card} aria-label="设计任务查询结果">
        <div className={styles.cardHeader}><div><h2>全部任务</h2><p>{loaded ? `${records.length} 条可信记录` : "读取未确认"}</p></div></div>
        {loading && !loaded ? <DesignEmpty title="正在读取设计任务" detail="已知内置降级记录会被拒绝。" busy /> : loaded && records.length ? (
          <ul className={styles.selectionList}>
            {records.map((job) => {
              const state = designCommerceState(job);
              return <li key={job.id}>
                <Link href={`/design/jobs/${encodeURIComponent(job.id)}`} data-action-id={`design-jobs-open-${job.id}`} aria-label={`查看设计任务 ${job.requestId}`}>
                  <span><strong>{job.customer?.name || job.conversation?.title || job.requestId}</strong><small>{job.scene || "未标注场景"} · 下一步：{state.recommendation} · {formatDesignDate(job.updatedAt)}</small></span>
                  <em>{state.statusLabel}</em>
                </Link>
              </li>;
            })}
          </ul>
        ) : loaded ? <DesignEmpty title="读取成功，当前没有设计任务" detail="任务 API 已返回可信空结果。" /> : <DesignEmpty title="设计任务状态未确认" detail="任务列表尚未成功读取，不能据此认定没有任务。" />}
      </article>
    </section>
  );
}
