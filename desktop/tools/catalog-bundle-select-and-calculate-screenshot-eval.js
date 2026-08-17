(async () => {
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const clickAction = (actionId) => {
    const element = document.querySelector(`[data-action-id="${actionId}"]`);
    if (!element) throw new Error(`missing action: ${actionId}`);
    element.scrollIntoView({ block: "center" });
    element.click();
  };
  const setInputValue = (input, value) => {
    if (!input) throw new Error(`missing input for value: ${value}`);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("HTMLInputElement value setter was not available");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const inputs = [...document.querySelectorAll("input")];
  setInputValue(inputs[0], "vip gift bundle");
  setInputValue(inputs[1], "50");
  setInputValue(inputs[2], "200");
  setInputValue(inputs[3], "10000");
  setInputValue(inputs[4], "6");
  await wait(250);

  clickAction("catalog-bundles-toggle-image-BOX-A");
  await wait(250);
  clickAction("catalog-bundles-toggle-image-TEA-A");
  await wait(250);
  clickAction("catalog-bundles-recommend");

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const text = document.body?.innerText || "";
    if (text.includes("BOX-A") && text.includes("TEA-A")) break;
    await wait(250);
  }
  const handoff = document.querySelector('[aria-label="保存客户搭品方案"]');
  if (!handoff) throw new Error("bundle design handoff was not rendered after calculation");
  handoff.scrollIntoView({ block: "center" });
})();
