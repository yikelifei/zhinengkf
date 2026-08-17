(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 10000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(100);
    }
    throw new Error("Timed out waiting for selected catalog bundle screenshot state");
  };
  const setValue = (element, value) => {
    if (!element) return;
    element.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const click = (element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

  await waitFor(() => document.querySelector('[data-action-id="catalog-bundles-recommend"]'));
  const allInputs = () => Array.from(document.querySelectorAll("input"));
  const sceneInput = await waitFor(() => allInputs().find((input) => {
    const label = input.closest("label")?.innerText || "";
    return input.placeholder.includes("\u5458\u5de5") || label.includes("\u573a\u666f");
  }));
  const numberInputs = allInputs().filter((input) => input.type === "number");
  setValue(sceneInput, "\u5458\u5de5\u798f\u5229");
  setValue(numberInputs[0], "50");
  setValue(numberInputs[1], "200");
  setValue(numberInputs[2], "10000");
  setValue(numberInputs[3], "6");

  const candidateButtons = await waitFor(() => {
    const buttons = Array.from(document.querySelectorAll('[data-action-id^="catalog-bundles-toggle-image-"]'));
    return buttons.length ? buttons : null;
  }, 12000);
  const candidateImageStates = candidateButtons.map((button) => button.querySelector("[data-image-state]")?.getAttribute("data-image-state"));
  if (candidateImageStates.some((state) => state === "missing" || state === "invalid")) {
    throw new Error(`catalog bundle candidate pool contains non-renderable image states: ${candidateImageStates.join(",")}`);
  }
  const giftBoxButton = candidateButtons.find((button) => button.innerText.includes("gift_box")) || candidateButtons[0];
  const itemButton = candidateButtons.find((button) => !button.innerText.includes("gift_box") && button !== giftBoxButton);
  if (giftBoxButton) click(giftBoxButton);
  if (itemButton) click(itemButton);
  await waitFor(() => document.querySelectorAll('[data-action-id^="catalog-bundles-remove-image-"]').length >= (itemButton ? 2 : 1));
  const selectedImageStates = Array.from(document.querySelectorAll('[aria-label="\u5df2\u9009\u56fe\u7247\u642d\u914d"] [data-image-state]')).map((node) => node.getAttribute("data-image-state"));
  if (selectedImageStates.length < (itemButton ? 2 : 1)) {
    throw new Error(`selected bundle images were not visible: ${selectedImageStates.length}`);
  }
  if (selectedImageStates.some((state) => state === "missing" || state === "invalid")) {
    throw new Error(`selected bundle contains non-renderable image states: ${selectedImageStates.join(",")}`);
  }

  const recommendButton = document.querySelector('[data-action-id="catalog-bundles-recommend"]');
  click(recommendButton);
  await waitFor(() => Array.from(document.querySelectorAll("h2")).some((heading) => {
    const rect = heading.getBoundingClientRect();
    return heading.innerText.trim() === "\u63a8\u8350\u7ed3\u679c" && rect.width > 0 && rect.height > 0;
  }), 10000);
  const resultImageStates = Array.from(document.querySelectorAll('[aria-label="\u793c\u76d2\u7ec4\u5408\u7ed3\u679c"] [data-image-state]')).map((node) => node.getAttribute("data-image-state"));
  if (!resultImageStates.length) throw new Error("catalog bundle result did not render product images");
  window.__catalogBundleSelectedScreenshotEval = {
    candidateImageStates,
    selectedImageStates,
    resultImageStates,
  };
})();
