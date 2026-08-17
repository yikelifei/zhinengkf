(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 8000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(100);
    }
    throw new Error("Timed out waiting for catalog bundle screenshot state");
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
  await waitFor(() => sceneInput.value === "\u5458\u5de5\u798f\u5229");
  const button = document.querySelector('[data-action-id="catalog-bundles-recommend"]');
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  await waitFor(() => Array.from(document.querySelectorAll("h2")).some((heading) => {
    const rect = heading.getBoundingClientRect();
    return heading.innerText.trim() === "\u63a8\u8350\u7ed3\u679c" && rect.width > 0 && rect.height > 0;
  }), 10000);
})();
