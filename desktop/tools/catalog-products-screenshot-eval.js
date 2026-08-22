(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 10000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(100);
    }
    throw new Error("Timed out waiting for catalog products screenshot state");
  };

  await waitFor(() => document.querySelector('[aria-label="\u5546\u54c1\u67e5\u8be2\u7ed3\u679c"]'));
  const categorySections = Array.from(document.querySelectorAll('[aria-label^="\u5206\u7c7b "]'));
  if (!categorySections.length) throw new Error("catalog products did not render category sections");

  const categoryQuickNav = document.querySelector('[aria-label="\u6309\u5206\u7c7b\u5feb\u901f\u5b9a\u4f4d"]');
  if (!categoryQuickNav) throw new Error("catalog products did not render category quick navigation");
  const categoryQuickButtons = Array.from(categoryQuickNav.querySelectorAll('[data-action-id^="catalog-category-jump-"]'));
  if (categoryQuickButtons.length < 2) throw new Error(`catalog category quick navigation was too sparse: ${categoryQuickButtons.length}`);

  const productTiles = Array.from(document.querySelectorAll('[data-action-id^="catalog-products-open-"]'));
  if (!productTiles.length) throw new Error("catalog products did not render product tiles");

  const imageStates = productTiles
    .map((tile) => tile.querySelector("[data-image-state]")?.getAttribute("data-image-state"))
    .filter(Boolean);
  if (imageStates.length < productTiles.length) {
    throw new Error(`catalog product tile images were not rendered for every tile: ${imageStates.length}/${productTiles.length}`);
  }

  const statusLabels = productTiles
    .map((tile) => tile.querySelector("[data-image-status]")?.getAttribute("data-image-status"))
    .filter(Boolean);
  if (statusLabels.length < productTiles.length) {
    throw new Error(`catalog product image status labels were not rendered for every tile: ${statusLabels.length}/${productTiles.length}`);
  }

  const stateSet = new Set(imageStates);
  const labelSet = new Set(statusLabels);
  if (!["ready", "loading", "missing", "invalid", "failed"].some((state) => stateSet.has(state))) {
    throw new Error(`catalog product image states were not meaningful: ${imageStates.join(",")}`);
  }
  if (!["ready", "missing", "invalid"].some((state) => labelSet.has(state))) {
    throw new Error(`catalog product image status labels were not meaningful: ${statusLabels.join(",")}`);
  }

  window.__catalogProductsScreenshotEval = {
    categories: categorySections.length,
    categoryQuickButtons: categoryQuickButtons.length,
    productTiles: productTiles.length,
    imageStates,
    statusLabels,
  };
})();
