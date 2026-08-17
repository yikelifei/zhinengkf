"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  downloadKnowledgeImportTemplate,
  getAgents,
  importChatTranscript,
  importKnowledgeText,
  previewKnowledgeImportText,
  type Agent,
  type IdentityFilters,
  type KnowledgeImportResult,
} from "../../lib/api";
import {
  completeClientOperation,
  reserveClientOperation,
  type PendingClientOperation,
} from "../../lib/client-operation-key";
import styles from "../governance-pages.module.css";
import { TrainingIdentityScopeNotice, trainingHref } from "./training-identity-navigation";
import { KnowledgePreview } from "./training-knowledge-preview";
import { readPptxKnowledgeFile } from "./pptx-knowledge";

export type TrainingImportPageProps = {
  identityFilters?: IdentityFilters;
};

export function TrainingImportPage({ identityFilters }: TrainingImportPageProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [importMode, setImportMode] = useState<"chat" | "knowledge">("chat");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [channel, setChannel] = useState("");
  const [agentId, setAgentId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [knowledgeText, setKnowledgeText] = useState("");
  const [knowledgeFileName, setKnowledgeFileName] = useState("");
  const [knowledgePreview, setKnowledgePreview] = useState<KnowledgeImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [pendingKnowledgeConfirmation, setPendingKnowledgeConfirmation] = useState(false);
  const refreshSequence = useRef(0);
  const pendingImportOperation = useRef<PendingClientOperation | null>(null);
  const pendingKnowledgePreviewOperation = useRef<PendingClientOperation | null>(null);
  const pendingKnowledgeOperation = useRef<PendingClientOperation | null>(null);

  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    agentId: identityFilters?.agentId,
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.agentId, identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    setAgentsLoaded(false);
    try {
      const nextAgents = await getAgents(stableIdentityFilters);
      if (sequence !== refreshSequence.current) return;
      setAgents(nextAgents);
      setAgentsLoaded(true);
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setAgents([]);
      setError(caught instanceof Error ? caught.message : "训练导入页未取得智能体选项，请检查服务后重试。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (stableIdentityFilters.agentId) setAgentId(stableIdentityFilters.agentId);
  }, [stableIdentityFilters.agentId]);

  const handleKnowledgeFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    setError("");
    setNotice("");
    setKnowledgePreview(null);
    setPendingKnowledgeConfirmation(false);
    if (!["csv", "tsv", "json", "pptx"].includes(extension)) {
      setError("当前支持导入 CSV、TSV、JSON 或 PPTX 知识文件。");
      input.value = "";
      return;
    }
    const maximumBytes = extension === "pptx" ? 20 * 1024 * 1024 : 2 * 1024 * 1024;
    if (file.size > maximumBytes) {
      setError(extension === "pptx" ? "PPTX 超过 20MB，请先压缩或拆分后再导入。" : "知识文件超过 2MB，请先拆分后再导入。");
      input.value = "";
      return;
    }
    setBusy(true);
    try {
      const text = extension === "pptx" ? await readPptxKnowledgeFile(file) : await file.text();
      if (text.trim().length < 20) {
        setError("文件内容过短，未读取到可预览的真实 SOP 或知识正文。");
        return;
      }
      setKnowledgeText(text);
      setKnowledgeFileName(file.name);
      if (!source.trim()) setSource(file.name);
      setNotice(`已读取本地文件：${file.name}，请继续预览校验后再写入知识库。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "本地知识文件读取失败。");
    } finally {
      input.value = "";
      setBusy(false);
    }
  }, [source]);

  const requestImport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (transcript.trim().length < 10) {
      setError("聊天记录内容过短，未提交导入。");
      return;
    }
    setPendingConfirmation(true);
  };

  const previewKnowledgeImport = useCallback(async () => {
    setError("");
    setNotice("");
    setPendingKnowledgeConfirmation(false);
    if (knowledgeText.trim().length < 20) {
      setError("知识库导入内容过短，请粘贴真实 SOP、话术或纠错沉淀。");
      return;
    }
    const requestPayload = {
      source: source.trim() || "manual_knowledge_import",
      customerId: stableIdentityFilters.customerId,
      conversationId: stableIdentityFilters.conversationId,
      wechatAccountId: stableIdentityFilters.wechatAccountId,
      text: knowledgeText,
    };
    const operation = reserveClientOperation("knowledge-import-preview", requestPayload, pendingKnowledgePreviewOperation.current);
    pendingKnowledgePreviewOperation.current = operation;
    setBusy(true);
    try {
      const result = await previewKnowledgeImportText(knowledgeText, {
        operationKey: operation.key,
        source: requestPayload.source,
        customerId: requestPayload.customerId,
        conversationId: requestPayload.conversationId,
        wechatAccountId: requestPayload.wechatAccountId,
      });
      pendingKnowledgePreviewOperation.current = completeClientOperation(pendingKnowledgePreviewOperation.current, operation.key);
      setKnowledgePreview(result);
      if (result.ok) setNotice(`知识预览完成：可导入 ${result.rows.length} 条，待复核 ${result.acceptance?.needsReviewCount ?? 0} 条。`);
      else setError("知识导入预览存在阻断项，不能直接写入知识库。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "知识导入预览失败。");
    } finally {
      setBusy(false);
    }
  }, [knowledgeText, source, stableIdentityFilters]);

  const downloadKnowledgeTemplate = useCallback(async () => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const template = await downloadKnowledgeImportTemplate();
      const bytes = Uint8Array.from(atob(template.dataBase64), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: template.mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = template.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("已生成知识导入模板，请按模板补齐真实 SOP 后再预览。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "知识导入模板下载失败。");
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmImport = useCallback(async () => {
    const text = transcript.trim();
    if (text.length < 10) {
      setError("待导入内容已经变化，请重新核对。");
      setPendingConfirmation(false);
      return;
    }
    const requestPayload = {
      name: name.trim() || undefined,
      source: source.trim() || undefined,
      channel: channel.trim() || undefined,
      agentId: agentId || undefined,
      customerId: stableIdentityFilters.customerId,
      conversationId: stableIdentityFilters.conversationId,
      wechatAccountId: stableIdentityFilters.wechatAccountId,
      text,
    };
    const operation = reserveClientOperation("training-import", requestPayload, pendingImportOperation.current);
    pendingImportOperation.current = operation;
    setBusy(true);
    setError("");
    try {
      const result = await importChatTranscript({ operationKey: operation.key, ...requestPayload });
      pendingImportOperation.current = completeClientOperation(pendingImportOperation.current, operation.key);
      setTranscript("");
      setPendingConfirmation(false);
      setNotice(`导入完成：解析 ${result.messageCount} 条消息，生成 ${result.pairCount} 组训练对话。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "聊天记录导入失败，服务端未确认结果。");
    } finally {
      setBusy(false);
    }
  }, [agentId, channel, name, source, stableIdentityFilters, transcript]);

  const confirmKnowledgeImport = useCallback(async () => {
    if (!knowledgePreview?.ok || !knowledgePreview.rows.length) {
      setError("请先完成可通过的知识导入预览。");
      setPendingKnowledgeConfirmation(false);
      return;
    }
    const requestPayload = {
      source: source.trim() || "manual_knowledge_import",
      customerId: stableIdentityFilters.customerId,
      conversationId: stableIdentityFilters.conversationId,
      wechatAccountId: stableIdentityFilters.wechatAccountId,
      text: knowledgeText,
    };
    const operation = reserveClientOperation("knowledge-import", requestPayload, pendingKnowledgeOperation.current);
    pendingKnowledgeOperation.current = operation;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await importKnowledgeText({ operationKey: operation.key, ...requestPayload });
      pendingKnowledgeOperation.current = completeClientOperation(pendingKnowledgeOperation.current, operation.key);
      setPendingKnowledgeConfirmation(false);
      setKnowledgePreview(result);
      setNotice(`知识库写入完成：${result.saved?.count ?? 0} 条；低分或缺标签条目仍需在训练流程复核。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "知识库写入失败，服务端未确认结果。");
    } finally {
      setBusy(false);
    }
  }, [knowledgePreview, knowledgeText, source, stableIdentityFilters]);

  return (
    <section className={styles.page} aria-labelledby="training-import-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Training</span>
          <h1 id="training-import-title">训练资料导入</h1>
          <p className={styles.description}>导入真实聊天、运营 SOP 和纠错沉淀；预览通过后才写入，复核与技能应用在独立页面完成。</p>
        </div>
        <div className={styles.buttonRow}>
          <Link className={styles.button} href={trainingHref("/training/import/history", stableIdentityFilters)}>查看导入历史</Link>
          <button type="button" className={styles.button} data-action-id="training-import-refresh" onClick={() => void refresh()} disabled={busy}>刷新选项</button>
        </div>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}
      <TrainingIdentityScopeNotice identityFilters={stableIdentityFilters} />

      <div className={styles.buttonRow} role="group" aria-label="训练资料导入类型">
        <button type="button" className={importMode === "chat" ? styles.primaryButton : styles.button} data-action-id="training-import-mode-chat" onClick={() => setImportMode("chat")} disabled={busy}>聊天记录</button>
        <button type="button" className={importMode === "knowledge" ? styles.primaryButton : styles.button} data-action-id="training-import-mode-knowledge" onClick={() => setImportMode("knowledge")} disabled={busy}>运营 SOP / 知识</button>
      </div>

      {importMode === "knowledge" ? (
        <section className={styles.panel} aria-labelledby="training-knowledge-import-title">
          <header className={styles.panelHeader}>
            <div>
              <h2 id="training-knowledge-import-title">知识库真实资料导入</h2>
              <p>这里只写入知识条目，不声明模型已训练完成，也不会自动应用为 Agent 技能。</p>
            </div>
            <button type="button" className={styles.button} data-action-id="training-knowledge-template" onClick={() => void downloadKnowledgeTemplate()} disabled={busy}>下载模板</button>
          </header>
          <div className={styles.panelBody}>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>资料来源</span>
                <input className={styles.input} value={source} onChange={(event) => setSource(event.target.value)} placeholder="例如：2026-07 售前 SOP 表" />
              </label>
              <label className={styles.field}>
                <span>本地文件</span>
                <input
                  className={styles.input}
                  type="file"
                  accept=".csv,.tsv,.json,.pptx,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  data-action-id="training-knowledge-file"
                  onChange={(event) => void handleKnowledgeFileChange(event)}
                  disabled={busy}
                />
                <small className={styles.helpText}>{knowledgeFileName ? `已读取：${knowledgeFileName}` : "CSV / TSV / JSON 最大 2MB；PPTX 最大 20MB"}</small>
              </label>
              <label className={`${styles.field} ${styles.wideField}`}>
                <span>知识资料正文</span>
                <textarea
                  className={styles.textarea}
                  value={knowledgeText}
                  onChange={(event) => {
                    setKnowledgeText(event.target.value);
                    setKnowledgeFileName("");
                    setKnowledgePreview(null);
                    setPendingKnowledgeConfirmation(false);
                  }}
                  placeholder={'知识标题,知识正文,Agent Key,场景标签,资料来源,质量分\n报价与预算确认 SOP,"客户问价格时先确认用途、数量、预算和交付时间。",pre_sales,"报价、预算","客服主管 SOP",92'}
                />
              </label>
            </div>
            <div className={styles.actionBar}>
              <p className={styles.helpText}>缺标题、缺正文、正文过短会阻断；缺 Agent、缺标签、低分会标记待补齐或待复核。</p>
              <button type="button" className={styles.primaryButton} data-action-id="training-knowledge-preview" onClick={() => void previewKnowledgeImport()} disabled={busy || knowledgeText.trim().length < 20}>预览校验</button>
            </div>
            {knowledgePreview ? <KnowledgePreview result={knowledgePreview} onConfirm={() => setPendingKnowledgeConfirmation(true)} busy={busy} /> : null}
          </div>
        </section>
      ) : (
        <section className={styles.panel} aria-labelledby="training-import-form-title">
          <header className={styles.panelHeader}><div><h2 id="training-import-form-title">导入内容</h2><p>来源字段用于后续审计，不会改变身份绑定。</p></div></header>
          <form className={styles.panelBody} onSubmit={requestImport}>
            <div className={styles.formGrid}>
              <label className={styles.field}><span>记录名称</span><input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} placeholder="可选，便于查找" /></label>
              <label className={styles.field}><span>来源</span><input className={styles.input} value={source} onChange={(event) => setSource(event.target.value)} placeholder="可选，如导出文件名" /></label>
              <label className={styles.field}><span>渠道</span><input className={styles.input} value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="可选，如企业微信客服" /></label>
              <label className={styles.field}>
                <span>目标智能体</span>
                <select className={styles.select} value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                  <option value="">由服务端按场景识别</option>
                  {agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name} · {agent.scene}</option>)}
                </select>
                <small className={styles.helpText}>{agentsLoaded
                  ? agents.length ? `已读取 ${agents.length} 个智能体选项。` : "读取成功，当前没有已配置的智能体。"
                  : "智能体选项尚未成功读取，当前状态未确认。"}</small>
              </label>
              <label className={`${styles.field} ${styles.wideField}`}>
                <span>聊天记录正文</span>
                <textarea className={styles.textarea} value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="粘贴需要解析的真实聊天记录" required />
              </label>
            </div>
            <div className={styles.actionBar}>
              <p className={styles.helpText}>提交后仅生成待复核数据，不会在本页直接将样本用于训练。</p>
              <button type="submit" className={styles.primaryButton} data-action-id="training-import-request" disabled={busy || transcript.trim().length < 10}>核对并导入</button>
            </div>
          </form>
        </section>
      )}

      {pendingConfirmation ? (
        <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="training-import-confirm-title">
          <strong id="training-import-confirm-title">确认导入聊天记录</strong>
          <p>将向服务端提交 {transcript.trim().length} 个字符，并由服务端生成可追溯的导入记录与待复核样本。</p>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.primaryButton} data-action-id="training-import-confirm" onClick={() => void confirmImport()} disabled={busy}>确认导入</button>
            <button type="button" className={styles.button} data-action-id="training-import-cancel" onClick={() => setPendingConfirmation(false)} disabled={busy}>返回检查</button>
          </div>
        </section>
      ) : null}

      {pendingKnowledgeConfirmation && knowledgePreview ? (
        <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="training-knowledge-confirm-title">
          <strong id="training-knowledge-confirm-title">确认写入知识库</strong>
          <p>将写入 {knowledgePreview.rows.length} 条知识；缺真实运营资料的条目仍会显示为待补齐，不会自动变成已训练技能。</p>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.primaryButton} data-action-id="training-knowledge-confirm" onClick={() => void confirmKnowledgeImport()} disabled={busy}>确认写入</button>
            <button type="button" className={styles.button} data-action-id="training-knowledge-cancel" onClick={() => setPendingKnowledgeConfirmation(false)} disabled={busy}>返回检查</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
