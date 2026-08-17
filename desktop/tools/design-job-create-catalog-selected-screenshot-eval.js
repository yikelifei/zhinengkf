(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 12000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(100);
    }
    throw new Error("Timed out waiting for design job catalog selected screenshot state");
  };
  const click = (element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

  const toggleButtons = await waitFor(() => {
    const buttons = Array.from(document.querySelectorAll('[data-action-id^="design-job-create-toggle-catalog-sku-"]'))
      .filter((button) => !button.disabled);
    return buttons.length ? buttons : null;
  });
  for (const button of toggleButtons.slice(0, 2)) click(button);
  await waitFor(() => Number(document.querySelector("[data-selected-sku-count]")?.dataset.selectedSkuCount || 0) >= 1);

  const recommendButton = await waitFor(() => document.querySelector('[data-action-id="design-job-create-recommend-bundle"]'));
  click(recommendButton);
  const preview = await waitFor(() => document.querySelector('[aria-label="推荐组合商品图片"]'));
  preview.scrollIntoView({ block: "center", inline: "nearest" });
})();
