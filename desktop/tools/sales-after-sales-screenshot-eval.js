(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const byAction = (id) => document.querySelector(`[data-action-id="${id}"]`);
  const setValue = (id, value) => {
    const element = byAction(id);
    if (!element) throw new Error(`missing ${id}`);
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const waitForText = async (text, timeoutMs = 12000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (document.body.innerText.includes(text)) return;
      await sleep(250);
    }
    throw new Error(`timed out waiting for text: ${text}`);
  };
  const waitForEnabled = async (id, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const element = byAction(id);
      if (element && !element.disabled) return element;
      await sleep(200);
    }
    throw new Error(`timed out waiting for enabled control: ${id}`);
  };

  await waitForText("售后/退款/补发处理");
  const marker = Date.now();
  setValue("sales-after-sales-create-type", "replacement");
  setValue("sales-after-sales-create-reason", `验收补发 case ${marker}：客户反馈礼盒外包装压痕，需要补发外盒。`);
  setValue("sales-after-sales-create-evidence", `acceptance-photo-${marker}.png`);
  setValue("sales-after-sales-create-desired", "补发外盒并同步物流单号");
  (await waitForEnabled("sales-after-sales-create-submit")).click();
  await waitForText("已创建");

  setValue("sales-after-sales-resolve-type", "replacement");
  setValue("sales-after-sales-resolve-carrier", "SF Express");
  setValue("sales-after-sales-resolve-tracking", `SF${marker}`);
  setValue("sales-after-sales-resolve-note", `验收补发已安排，补发物流 SF${marker}。`);
  (await waitForEnabled("sales-after-sales-resolve-submit")).click();
  await waitForText("已记录处理结论");
  await waitForText(`SF${marker}`);

  const list = byAction("sales-after-sales-case-list");
  if (!list) throw new Error("after-sales case list did not render");
  list.scrollIntoView({ block: "start" });
})();
