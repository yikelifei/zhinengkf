(function () {
  "use strict";

  const api = {
    async get(path) {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(res.statusText || "请求失败");
      return res.json();
    },
    async post(path, body) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || data.message || res.statusText);
      return data;
    }
  };

  function toast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 1800);
  }

  function setHealth(text, warn = false) {
    const badge = document.getElementById("healthBadge");
    if (!badge) return;
    badge.innerHTML = `<i class="dot ${warn ? "warn" : ""}"></i>${text}`;
  }

  function setButtonBusy(button, busy) {
    if (!button) return;
    button.classList.toggle("is-loading", busy);
    button.toggleAttribute("disabled", busy);
    button.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function setSidebarStatus(status, readiness) {
    const el = document.querySelector(".sidebar-status");
    if (!el || !status) return;
    const backendText = status.backend?.running ? "运行中" : "未启动";
    const readinessText = readiness?.passed ? "可试运行" : "待处理";
    el.innerHTML = [
      `当前模型：${status.primary_provider || "-"} / ${status.primary_model || "-"}`,
      `微信后台：${backendText}`,
      `自动回复：${status.backend?.running ? "已开启" : "待启动"}`,
      `上线检查：${readinessText}`,
      `待人工：${status.needs_human || 0} 条`
    ].join("<br />");
  }

  async function refreshLiveStatus() {
    try {
      const [status, readiness] = await Promise.all([
        api.get("/api/status"),
        api.get("/api/reports/readiness")
      ]);
      const warningCount = Number(readiness.blockers || 0) + Number(readiness.warnings || 0);
      setHealth(warningCount ? `已连接 · ${warningCount} 个上线项` : "全通道正常 · 已连接真实数据", warningCount > 0);
      setSidebarStatus(status, readiness);
    } catch (err) {
      setHealth("Web Console 未连接后端", true);
    }
  }

  async function generateReport(type) {
    const result = await api.post("/api/reports/generate", { type });
    toast(`${result.label || "报告"}已生成`);
    await refreshReportsList();
    return result;
  }

  async function createBackup() {
    const result = await api.post("/api/backups/create", { label: "web" });
    toast(`备份已生成：${result.file?.name || ""}`);
    return result;
  }

  function inferReportType(text) {
    if (text.includes("高价值") || text.includes("高意向")) return "high_value_leads";
    if (text.includes("上线") || text.includes("缺口")) return "readiness";
    if (text.includes("验收")) return "acceptance";
    if (text.includes("运营") || text.includes("报表")) return "operation";
    if (text.includes("质检")) return "quality";
    if (text.includes("跟进")) return "followups";
    if (text.includes("话术") || text.includes("样本") || text.includes("真人")) return "reply_style";
    if (text.includes("报价")) return "quote_readiness";
    if (text.includes("订单") || text.includes("交付")) return "order_handoff";
    if (text.includes("人工接管") || text.includes("接管队列")) return "handoff";
    if (text.includes("护栏") || text.includes("安全")) return "answer_guard";
    if (text.includes("非工作时间")) return "business_hours";
    if (text.includes("优化待办")) return "improvement_backlog";
    if (text.includes("隐私")) return "privacy_audit";
    if (text.includes("SLA")) return "sla";
    if (text.includes("审计")) return "audit";
    if (text.includes("场景")) return "scenarios";
    return "";
  }

  function injectWorkbenchStyles() {
    if (document.getElementById("liveWorkbenchStyles")) return;
    const style = document.createElement("style");
    style.id = "liveWorkbenchStyles";
    style.textContent = `
      .live-workbench {
        display: grid;
        gap: 14px;
      }
      .live-workbench .panel {
        box-shadow: 0 8px 24px rgba(0,0,0,.06);
      }
      .workbench-actions {
        display: grid;
        grid-template-columns: repeat(4, minmax(150px, 1fr));
        gap: 10px;
      }
      .workbench-actions .btn {
        width: 100%;
        justify-content: center;
      }
      .live-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(220px, 1fr));
        gap: 14px;
      }
      .live-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 14px;
        display: grid;
        gap: 10px;
        min-height: 154px;
      }
      .live-card strong {
        display: block;
        font-size: 24px;
      }
      .live-card label {
        color: var(--muted);
        font-size: 12px;
      }
      .live-card p {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.55;
      }
      .live-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .live-table th,
      .live-table td {
        border-bottom: 1px solid var(--line);
        padding: 9px 10px;
        text-align: left;
        vertical-align: top;
      }
      .live-table th {
        color: var(--muted);
        font-weight: 700;
        background: var(--panel-soft);
      }
      .live-table tr:last-child td {
        border-bottom: 0;
      }
      .live-empty {
        color: var(--muted);
        padding: 14px;
        border: 1px dashed var(--line);
        border-radius: 8px;
        background: var(--panel-soft);
      }
      .report-links {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .report-links a {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 6px 10px;
        color: var(--text);
        background: var(--panel-soft);
        text-decoration: none;
        font-size: 12px;
      }
      @media (max-width: 1100px) {
        .live-grid,
        .workbench-actions {
          grid-template-columns: repeat(2, minmax(180px, 1fr));
        }
      }
      @media (max-width: 720px) {
        .live-grid,
        .workbench-actions {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function metricCard(label, value, detail) {
    return `<article class="live-card"><label>${escapeHtml(label)}</label><strong>${escapeHtml(String(value))}</strong><p>${escapeHtml(detail || "")}</p></article>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderTopRows(items, columns, emptyText) {
    if (!items || !items.length) return `<div class="live-empty">${escapeHtml(emptyText)}</div>`;
    return `
      <table class="live-table">
        <thead><tr>${columns.map((item) => `<th>${escapeHtml(item.label)}</th>`).join("")}</tr></thead>
        <tbody>
          ${items.map((row) => `
            <tr>
              ${columns.map((item) => `<td>${escapeHtml(item.value(row) || "-")}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderWorkbenchShell() {
    return `
      <section class="live-workbench" id="liveWorkbench">
        <section class="panel">
          <div class="panel-head">
            <div class="panel-title">今日必办工作台</div>
            <div class="top-actions">
              <button class="btn" data-smart-action="refresh">刷新</button>
              <button class="btn primary" data-smart-action="backend-start">启动客服</button>
              <button class="btn" data-smart-action="backend-stop">停止客服</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="workbench-actions">
              <button class="btn primary" data-report-type="high_value_leads">生成高价值客户</button>
              <button class="btn" data-report-type="followups">生成跟进任务</button>
              <button class="btn" data-report-type="quote_readiness">生成报价清单</button>
              <button class="btn" data-report-type="improvement_backlog">生成知识缺口</button>
              <button class="btn" data-report-type="handoff">导出人工接管</button>
              <button class="btn" data-report-type="quality">生成质检报告</button>
              <button class="btn" data-report-type="readiness">上线检查</button>
              <button class="btn" data-smart-action="backup">立即备份</button>
            </div>
          </div>
        </section>
        <section class="live-grid" id="liveMetrics"></section>
        <section class="panel">
          <div class="panel-head"><div class="panel-title">高价值客户 Top 10</div><button class="btn" data-report-type="high_value_leads">导出高价值客户</button></div>
          <div class="panel-body" id="highValueList"><div class="live-empty">正在加载...</div></div>
        </section>
        <section class="panel">
          <div class="panel-head"><div class="panel-title">今日跟进与人工接管</div><button class="btn" data-report-type="followups">导出跟进任务</button></div>
          <div class="panel-body" id="urgentTaskList"><div class="live-empty">正在加载...</div></div>
        </section>
        <section class="panel">
          <div class="panel-head"><div class="panel-title">最近生成文件</div><button class="btn" data-smart-action="refresh-reports">刷新文件</button></div>
          <div class="panel-body"><div class="report-links" id="reportLinks"></div></div>
        </section>
      </section>
    `;
  }

  function isOverviewPage() {
    const overviewButton = document.querySelector('.nav button[data-page="overview"]');
    return !overviewButton || overviewButton.classList.contains("active");
  }

  function ensureWorkbench() {
    injectWorkbenchStyles();
    if (!isOverviewPage()) {
      document.getElementById("liveWorkbench")?.remove();
      return;
    }
    const content = document.querySelector(".content");
    if (!content || document.getElementById("liveWorkbench")) return;
    const holder = document.createElement("div");
    holder.innerHTML = renderWorkbenchShell();
    const head = content.querySelector(".page-head");
    if (head?.nextSibling) {
      content.insertBefore(holder.firstElementChild, head.nextSibling);
    } else {
      content.prepend(holder.firstElementChild);
    }
    refreshWorkbench();
  }

  async function refreshWorkbench() {
    const workbench = document.getElementById("liveWorkbench");
    if (!workbench) return;
    try {
      const [status, highValue, followups, handoff, quote, backlog, readiness] = await Promise.all([
        api.get("/api/status"),
        api.get("/api/high-value-leads?limit=50"),
        api.get("/api/followup-tasks?limit=10"),
        api.get("/api/handoff-queue?limit=10"),
        api.get("/api/quote-readiness?limit=50"),
        api.get("/api/improvement-backlog?days=7&limit=50"),
        api.get("/api/reports/readiness")
      ]);

      const quoteReady = Number(quote.ready || 0);
      const taskCount = followups.tasks?.length || 0;
      const handoffCount = handoff.items?.length || 0;
      const blockerCount = Number(readiness.blockers || 0);
      document.getElementById("liveMetrics").innerHTML = [
        metricCard("高价值客户", highValue.high_value || 0, "按意向分、预计金额、阶段和字段完整度筛选。"),
        metricCard("待人工接管", handoffCount, "投诉、退款、发票、付款异常和人工锁定优先处理。"),
        metricCard("可报价客户", quoteReady, `报价字段准备率 ${Math.round((quote.ready_rate || 0) * 100)}%。`),
        metricCard("今日跟进任务", taskCount, "优先补联系方式、数量、预算、日期和城市。"),
        metricCard("知识/流程待办", backlog.items?.length || 0, "来自知识缺口、AI 兜底和人工转接沉淀。"),
        metricCard("上线阻塞项", blockerCount, status.backend?.running ? "后台客服运行中。" : "后台客服未启动。")
      ].join("");

      document.getElementById("highValueList").innerHTML = renderTopRows(
        highValue.items?.slice(0, 10),
        [
          { label: "客户", value: (row) => row.customer },
          { label: "优先级", value: (row) => row.priority_score },
          { label: "预计金额", value: (row) => row.estimated_deal_value ? `${Math.round(row.estimated_deal_value)}元` : "-" },
          { label: "原因", value: (row) => (row.reasons || []).join("、") },
          { label: "建议动作", value: (row) => row.suggested_action }
        ],
        "暂无达到阈值的高价值客户。"
      );

      const urgentRows = [
        ...(handoff.items || []).map((item) => ({ type: "待人工", ...item })),
        ...(followups.tasks || []).map((item) => ({ type: "跟进", ...item }))
      ].slice(0, 12);
      document.getElementById("urgentTaskList").innerHTML = renderTopRows(
        urgentRows,
        [
          { label: "类型", value: (row) => row.type },
          { label: "客户", value: (row) => row.customer || row.friend_name || row.session_id },
          { label: "阶段", value: (row) => row.stage_label || row.stage || row.status },
          { label: "原因", value: (row) => Array.isArray(row.reasons) ? row.reasons.join("、") : (row.reason || row.manual_lock_reason || "-") },
          { label: "动作", value: (row) => row.suggested_action || row.next_action || "优先人工处理。" }
        ],
        "暂无待人工或跟进任务。"
      );

      await refreshReportsList();
    } catch (err) {
      const liveMetrics = document.getElementById("liveMetrics");
      if (liveMetrics) liveMetrics.innerHTML = metricCard("工作台加载失败", "!", err.message);
    }
  }

  async function refreshReportsList() {
    const target = document.getElementById("reportLinks");
    if (!target) return;
    try {
      const data = await api.get("/api/reports/files?limit=8");
      const files = data.files || [];
      target.innerHTML = files.length
        ? files.map((file) => `<a href="${escapeHtml(file.url)}" target="_blank" rel="noopener">${escapeHtml(file.name)}</a>`).join("")
        : `<span class="live-empty">暂无报告文件。</span>`;
    } catch (err) {
      target.innerHTML = `<span class="live-empty">${escapeHtml(err.message)}</span>`;
    }
  }

  async function callBackend(action) {
    const path = action === "backend-start" ? "/api/backend/start" : "/api/backend/stop";
    const result = await api.post(path, {});
    toast(result.message || "后台状态已更新");
    await refreshLiveStatus();
    await refreshWorkbench();
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".btn");
    if (!button) return;

    const text = button.textContent.trim();
    const smartAction = button.dataset.smartAction;
    if (smartAction) {
      event.preventDefault();
      setButtonBusy(button, true);
      try {
        if (smartAction === "refresh") {
          await refreshLiveStatus();
          await refreshWorkbench();
          toast("工作台已刷新");
        } else if (smartAction === "refresh-reports") {
          await refreshReportsList();
          toast("文件列表已刷新");
        } else if (smartAction === "backup") {
          await createBackup();
          await refreshReportsList();
        } else if (smartAction === "backend-start" || smartAction === "backend-stop") {
          await callBackend(smartAction);
        }
      } catch (err) {
        toast(err.message);
      } finally {
        setButtonBusy(button, false);
      }
      return;
    }

    const explicitReportType = button.dataset.reportType;
    if (explicitReportType) {
      event.preventDefault();
      setButtonBusy(button, true);
      try {
        await generateReport(explicitReportType);
        await refreshWorkbench();
      } catch (err) {
        toast(err.message);
      } finally {
        setButtonBusy(button, false);
      }
      return;
    }

    if (text.includes("立即备份")) {
      event.preventDefault();
      setButtonBusy(button, true);
      try {
        await createBackup();
        await refreshLiveStatus();
      } catch (err) {
        toast(err.message);
      } finally {
        setButtonBusy(button, false);
      }
      return;
    }

    if (!text.includes("导出") && !text.includes("生成")) return;
    const reportType = inferReportType(text);
    if (!reportType) return;

    event.preventDefault();
    setButtonBusy(button, true);
    try {
      await generateReport(reportType);
    } catch (err) {
      toast(err.message);
    } finally {
      setButtonBusy(button, false);
    }
  });

  refreshLiveStatus();
  ensureWorkbench();
  setInterval(refreshLiveStatus, 30000);
  setInterval(() => {
    if (document.getElementById("liveWorkbench")) refreshWorkbench();
  }, 60000);
  new MutationObserver(() => ensureWorkbench()).observe(document.body, { childList: true, subtree: true });
})();
