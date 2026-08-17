(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 20000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await wait(200);
    }
    throw new Error("design settings screenshot target was not ready");
  };
  const target = await waitFor(() => (
    document.querySelector('[data-action-id="design-settings-use-zhenxi-local-http-127-0-0-1-31870"]') ||
    document.querySelector('[data-action-id="design-settings-save-request"]')
  ));
  target.scrollIntoView({ block: "center", inline: "nearest" });
  await wait(500);
  return { ready: true };
})();
