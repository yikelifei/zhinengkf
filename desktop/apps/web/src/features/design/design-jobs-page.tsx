"use client";

import { Play, RefreshCw, SearchCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesignJob, DesignJobPreflightResult } from "../../lib/api";
import { identityExpectation } from "../../lib/api";
import { getVerifiedDesignJobs, pollDesignJob, preflightDesignJob, submitDesignJob } from "./api";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignEmpty, DesignNotice, DesignPageHeader, errorText, formatDesignDate } from "./design-ui";
import { designImagePreviewSrc } from "./model";

export type DesignJobsPageProps = {
  initialJobId?: string;
};

export function DesignJobsPage({ initialJobId = "" }: DesignJobsPageProps) {
  const [jobs, setJobs] = useState<DesignJob[]>([]);
  const [selectedId, setSelectedId] = useState(initialJobId);
  const [preflight, setPreflight] = useState<DesignJobPreflightResult | null>(null);
  const [busy, setBusy] = useState<"" | "refresh" | "preflight" | "submit" | "poll">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const selected = useMemo(() => jobs.find((job) => job.id === selectedId) || null, [jobs, selectedId]);

  const refreshJobs = useCallback(async () => {
    setBusy("refresh"); setError(""); setNotice("");
    try {
      const records = await getVerifiedDesignJobs();
      const initialJobExists = Boolean(initialJobId && records.some((job) => job.id === initialJobId));
      setJobs(records);
      setSelectedId((current) => {
        if (current && records.some((job) => job.id === current)) return current;
        return initialJobExists ? initialJobId : "";
      });
      if (initialJobId && !initialJobExists) setError(`未找到设计任务 ${initialJobId}，请返回任务列表重新选择。`);
    }
    catch (cause) { setJobs([]); setSelectedId(""); setError(errorText(cause, "设计任务读取失败")); }
    finally { setBusy(""); }
  }, [initialJobId]);
  useEffect(() => { void refreshJobs(); }, [refreshJobs]);

  function boundIdentity(job: DesignJob) {
    const expected = identityExpectation(job);
    return expected.expectedWechatAccountId && expected.expectedConversationId && expected.expectedCustomerId ? expected : null;
  }
  function replaceJob(job: DesignJob) { setJobs((current) => current.map((item) => item.id === job.id ? job : item)); }

  async function inspectPreflight() {
    if (!selected) return; const expected = boundIdentity(selected); if (!expected) { setError("任务缺少账号、会话或客户身份，已阻止预检和提交。"); return; }
    setBusy("preflight"); setError(""); setNotice(""); setPreflight(null);
    try { const result = await preflightDesignJob(selected.id, expected); setPreflight(result); if (!result.ok) setError("预检未通过，请先处理失败检查项。"); else setNotice("预检通过，可以在确认后正式提交。"); }
    catch (cause) { setError(errorText(cause, "设计任务预检失败")); }
    finally { setBusy(""); }
  }
  async function confirmSubmit() {
    if (!selected || !preflight?.ok || preflight.designJobId !== selected.id) return; const expected = boundIdentity(selected); if (!expected) return;
    setPendingConfirmation(false); setBusy("submit"); setError(""); setNotice("");
    try { const job = await submitDesignJob(selected.id, expected); replaceJob(job); setNotice(`任务 ${job.requestId} 已正式提交。`); setPreflight(null); }
    catch (cause) { setError(errorText(cause, "设计任务提交失败")); }
    finally { setBusy(""); }
  }
  async function pollSelected() {
    if (!selected) return; const expected = boundIdentity(selected); if (!expected) { setError("任务身份不完整，已阻止轮询。"); return; }
    setBusy("poll"); setError(""); setNotice("");
    try { const result = await pollDesignJob(selected.id, expected); replaceJob(result.job); setNotice(`远端状态：${result.remoteStatus}${result.autoRetried ? "；服务端已自动重试" : ""}`); }
    catch (cause) { setError(errorText(cause, "设计任务轮询失败")); }
    finally { setBusy(""); }
  }

  return (
    <section className={styles.page} aria-label="设计任务处理">
      <DesignPageHeader eyebrow="设计平台" title="设计任务" detail="只负责选择真实任务、预检、正式提交和状态轮询。" actions={<button type="button" data-action-id="design-jobs-refresh" aria-label="刷新设计任务" disabled={Boolean(busy)} onClick={() => void refreshJobs()}><RefreshCw size={16} aria-hidden="true" />刷新任务</button>} />
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}{notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      <div className={styles.masterDetail}>
        <section className={styles.card} aria-label="设计任务列表"><div className={styles.cardHeader}><div><h2>任务列表</h2><p>{jobs.length} 条可信记录</p></div></div>{busy === "refresh" ? <DesignEmpty title="正在读取设计任务" detail="已知内置降级记录会被拒绝。" busy /> : jobs.length ? <ul className={styles.selectionList}>{jobs.map((job) => <li key={job.id}><button type="button" className={job.id === selectedId ? styles.selected : ""} data-action-id={`design-jobs-select-${job.id}`} aria-label={`选择设计任务 ${job.requestId}`} aria-pressed={job.id === selectedId} onClick={() => { setSelectedId(job.id); setPreflight(null); setError(""); setNotice(""); }}><span><strong>{job.customer?.name || job.conversation?.title || job.requestId}</strong><small>{job.scene || "未标注场景"}</small></span><em>{job.status}</em></button></li>)}</ul> : <DesignEmpty title="没有可展示的真实任务" detail="若任务 API 不可用，本页不会展示内置样例。" />}</section>
        <section className={styles.card} aria-label="设计任务操作">{selected ? <><div className={styles.cardHeader}><div><h2>{selected.requestId}</h2><p>{selected.customer?.name || "客户未知"} · {formatDesignDate(selected.updatedAt)}</p></div><span className={styles.statusPill}>{selected.status}</span></div><dl className={styles.factGrid}><div><dt>场景</dt><dd>{selected.scene || "未填写"}</dd></div><div><dt>输出数量</dt><dd>{selected.outputCount}</dd></div><div><dt>总预算</dt><dd>{selected.budget.totalAmount ?? "—"}</dd></div><div><dt>图片</dt><dd>{selected.images?.length || 0}</dd></div></dl>{selected.images?.length ? <div className={styles.imageGallery} aria-label="设计候选图">{selected.images.map((image, index) => { const src = designImagePreviewSrc(selected, image); return <figure className={styles.imageTile} key={image.id || image.imageId || index}>{src ? <img src={src} alt={`设计候选图 ${index + 1}`} /> : <div className={styles.imageUnavailable}>本地预览不可用</div>}<figcaption>{image.imageId || image.id || `候选图 ${index + 1}`}</figcaption></figure>; })}</div> : <p className={styles.muted}>当前任务尚无候选图。</p>}<div className={styles.actionRow}><button type="button" data-action-id="design-jobs-preflight" aria-label="预检所选设计任务" disabled={Boolean(busy)} onClick={() => void inspectPreflight()}><SearchCheck size={16} aria-hidden="true" />预检</button><button type="button" data-action-id="design-jobs-poll" aria-label="轮询所选设计任务状态" disabled={Boolean(busy)} onClick={() => void pollSelected()}><RefreshCw size={16} aria-hidden="true" />轮询状态</button><button type="button" className={styles.primaryButton} data-action-id="design-jobs-submit-request" aria-label="准备正式提交设计任务" disabled={Boolean(busy) || !preflight?.ok || preflight.designJobId !== selected.id} onClick={() => setPendingConfirmation(true)}><Play size={16} aria-hidden="true" />正式提交</button></div>{preflight ? <div className={styles.preflight}><strong>预检 {preflight.ok ? "通过" : "未通过"}</strong><ul>{preflight.checks.map((check) => <li className={check.ok ? styles.ok : styles.bad} key={check.key}><span>{check.label}</span><small>{check.detail || "无明细"}</small></li>)}</ul></div> : null}</> : <DesignEmpty title="请选择一条设计任务" detail="所有写操作都绑定任务中的账号、会话和客户身份。" />}</section>
      </div>
      {pendingConfirmation && selected ? <DesignConfirmation title="确认正式提交这条设计任务？" detail={`任务 ${selected.requestId} 已通过预检。提交后会调用外部设计平台，身份将绑定到任务记录。`} confirmLabel="确认正式提交" confirmActionId="design-jobs-submit-confirm" cancelActionId="design-jobs-submit-cancel" busy={busy === "submit"} danger onCancel={() => setPendingConfirmation(false)} onConfirm={() => void confirmSubmit()} /> : null}
    </section>
  );
}
