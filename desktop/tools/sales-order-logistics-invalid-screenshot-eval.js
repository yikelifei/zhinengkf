(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 8000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(100);
    }
    throw new Error("Timed out waiting for sales order logistics invalid screenshot state");
  };
  const setInputValue = (selector, value) => {
    const input = document.querySelector(selector);
    if (!input) throw new Error(`missing input: ${selector}`);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("HTMLInputElement value setter was not available");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  await waitFor(() => document.querySelector('[data-action-id="sales-order-edit-tracking-no"]'));
  setInputValue('[data-action-id="sales-order-edit-tracking-no"]', "abc");
  setInputValue('[data-action-id="sales-order-edit-delivered-at"]', "2026-01-01 10:00");
  const deliverButton = await waitFor(() => document.querySelector('[data-action-id="sales-order-fulfillment-deliver"]'));
  const saveButton = await waitFor(() => document.querySelector('[data-action-id="sales-order-edit-save-request"]'));
  deliverButton.scrollIntoView({ block: "center" });
  await waitFor(() => {
    const text = document.body.innerText;
    return text.includes("\u771f\u5b9e\u7269\u6d41\u5355\u53f7") && text.includes("\u7b7e\u6536\u65f6\u95f4\u683c\u5f0f\u4e0d\u6b63\u786e");
  });
  if (!deliverButton.disabled) throw new Error("delivery completion action must stay disabled for invalid logistics facts");
  if (!saveButton.disabled) throw new Error("order fulfillment save must stay disabled for invalid logistics facts");
  return {
    invalidLogisticsVisible: true,
    deliverDisabled: true,
    saveDisabled: true,
  };
})();
