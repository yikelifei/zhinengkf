(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 12000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await wait(150);
    }
    throw new Error("training import history screenshot target was not ready");
  };

  await waitFor(() => document.querySelector("#training-import-history-title"));
  await waitFor(() => document.body.innerText.includes("bad-sop-preview-screenshot"));
  const text = document.body.innerText;
  const hasFailedBatch = text.includes("bad-sop-preview-screenshot") && text.includes("失败");
  const hasRetry = Boolean(document.querySelector('[data-action-id^="training-knowledge-import-retry-"]'));
  if (!hasFailedBatch || !hasRetry) {
    throw new Error("knowledge import failure batch or retry action was not visible");
  }
  document.querySelector("#training-knowledge-import-history-title")?.scrollIntoView({ block: "start" });
  await wait(300);
  return { hasFailedBatch, hasRetry };
})();
