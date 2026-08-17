(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 12000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(100);
    }
    throw new Error("Timed out waiting for design asset selected state");
  };

  const selectedButton = await waitFor(() =>
    document.querySelector('[data-action-id="design-job-create-use-customer-asset"][aria-pressed="true"]'));
  const selectedItem = selectedButton.closest("li");
  if (!selectedItem || selectedItem.getAttribute("data-selected") !== "true") {
    throw new Error("selected customer asset row is not highlighted");
  }

  const customerReferenceInput = await waitFor(() =>
    Array.from(document.querySelectorAll("input")).find((input) =>
      String(input.value || "").includes("storage") &&
      String(input.value || "").includes("assets") &&
      String(input.value || "").includes("customer")));
  if (!customerReferenceInput.value.includes("customer_demo_1")) {
    throw new Error(`selected customer asset is not bound to the expected customer: ${customerReferenceInput.value}`);
  }

  const image = selectedItem.querySelector("img");
  if (!image || image.getBoundingClientRect().width <= 0 || image.getBoundingClientRect().height <= 0) {
    throw new Error("selected customer asset image preview is not visible");
  }
  selectedItem.scrollIntoView({ block: "center", inline: "nearest" });
  window.__designAssetToJobSelectedScreenshotEval = {
    selected: true,
    assetPath: customerReferenceInput.value,
  };
})();
