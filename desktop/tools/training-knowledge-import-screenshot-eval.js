(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 15000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(100);
    }
    throw new Error("Timed out waiting for training knowledge import screenshot state");
  };
  const click = (element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  const setValue = (element, value) => {
    element.focus();
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const modeButton = await waitFor(() => document.querySelector('[data-action-id="training-import-mode-knowledge"]'));
  click(modeButton);
  const panel = await waitFor(() => document.querySelector("#training-knowledge-import-title")?.closest("section"));
  const sourceInput = await waitFor(() => panel.querySelector("input"));
  const textarea = await waitFor(() => panel.querySelector("textarea"));
  const source = `acceptance-knowledge-${Date.now()}`;
  setValue(sourceInput, source);
  setValue(textarea, [
    "知识标题,知识正文,Agent Key,场景标签,资料来源,质量分",
    `"发货异常 SOP","客户催发货时先核对订单生产状态、承运商、预计发出时间；缺物流单号必须进入人工复核。",pre_sales,"发货、物流、售后","${source}",88`,
  ].join("\n"));

  const previewButton = await waitFor(() => document.querySelector('[data-action-id="training-knowledge-preview"]:not(:disabled)'));
  click(previewButton);
  await waitFor(() => document.querySelector("[data-knowledge-import-acceptance-summary]"));
  const saveButton = await waitFor(() => document.querySelector('[data-action-id="training-knowledge-save-request"]:not(:disabled)'));
  click(saveButton);
  const confirmButton = await waitFor(() => document.querySelector('[data-action-id="training-knowledge-confirm"]:not(:disabled)'));
  click(confirmButton);
  const saveSummary = await waitFor(() => document.querySelector("[data-knowledge-import-save-summary]"));
  const savedNext = await waitFor(() => document.querySelector("[data-knowledge-import-saved-next]"));
  const summaryText = saveSummary.textContent || "";
  if (!summaryText.includes("已写入") || !summaryText.includes("1")) {
    throw new Error(`knowledge save summary did not show one saved row: ${summaryText}`);
  }
  if (!(savedNext.textContent || "").includes("复核")) {
    throw new Error("knowledge saved next-step copy did not mention review");
  }
  saveSummary.scrollIntoView({ block: "center", inline: "nearest" });
  window.__trainingKnowledgeImportScreenshotEval = { source, saved: true };
})();
