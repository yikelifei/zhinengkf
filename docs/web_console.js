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
    return result;
  }

  async function createBackup() {
    const result = await api.post("/api/backups/create", { label: "web" });
    toast(`备份已生成：${result.file?.name || ""}`);
    return result;
  }

  function inferReportType(text) {
    if (text.includes("上线") || text.includes("缺口")) return "readiness";
    if (text.includes("验收")) return "acceptance";
    if (text.includes("运营") || text.includes("报表")) return "operation";
    if (text.includes("质检")) return "quality";
    if (text.includes("跟进")) return "followups";
    if (text.includes("话术") || text.includes("样本") || text.includes("真人")) return "reply_style";
    if (text.includes("报价")) return "quote_readiness";
    if (text.includes("订单") || text.includes("交付")) return "order_handoff";
    if (text.includes("隐私")) return "privacy_audit";
    if (text.includes("SLA")) return "sla";
    return "";
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".btn");
    if (!button) return;

    const text = button.textContent.trim();
    if (text.includes("立即备份")) {
      event.preventDefault();
      try {
        await createBackup();
        await refreshLiveStatus();
      } catch (err) {
        toast(err.message);
      }
      return;
    }

    if (!text.includes("导出") && !text.includes("生成")) return;
    const reportType = inferReportType(text);
    if (!reportType) return;

    event.preventDefault();
    try {
      await generateReport(reportType);
    } catch (err) {
      toast(err.message);
    }
  });

  refreshLiveStatus();
  setInterval(refreshLiveStatus, 30000);
})();
