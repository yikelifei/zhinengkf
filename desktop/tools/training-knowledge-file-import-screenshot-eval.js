(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 15000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(100);
    }
    throw new Error("Timed out waiting for knowledge file import UI");
  };
  const click = (element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

  const modeButton = await waitFor(() => document.querySelector('[data-action-id="training-import-mode-knowledge"]'));
  click(modeButton);
  const panel = await waitFor(() => document.querySelector("#training-knowledge-import-title")?.closest("section"));
  const fileInput = await waitFor(() => panel.querySelector('[data-action-id="training-knowledge-file"]'));
  const textarea = await waitFor(() => panel.querySelector("textarea"));
  const previewButton = await waitFor(() => panel.querySelector('[data-action-id="training-knowledge-preview"]'));
  if (fileInput.type !== "file") throw new Error("knowledge import file input is not a file control");
  if (!fileInput.accept.includes(".csv") || !fileInput.accept.includes(".tsv") || !fileInput.accept.includes(".json")) {
    throw new Error(`knowledge import file input does not accept the supported file types: ${fileInput.accept}`);
  }
  if (!textarea.placeholder.includes("知识标题")) throw new Error("knowledge textarea did not keep the template placeholder");
  if (!previewButton.textContent.includes("预览校验")) throw new Error("knowledge import still must go through preview validation");
  fileInput.scrollIntoView({ block: "center", inline: "nearest" });
  window.__trainingKnowledgeFileImportScreenshotEval = {
    fileInput: true,
    accept: fileInput.accept,
  };
})();
