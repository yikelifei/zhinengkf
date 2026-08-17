(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 15000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(100);
    }
    throw new Error("Timed out waiting for catalog import readiness screenshot state");
  };
  const setTextAreaValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    element.focus();
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const click = (element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

  const rows = [
    "skuCode,name,type,category,costPrice,salePrice,stock,sceneTags,mainImagePath,dimensions,weightGram,supplier,leadTimeDays",
    "BOX-ACCEPT-1,\u771f\u5b9e\u9a8c\u6536\u793c\u76d2,gift_box,\u793c\u76d2,40,80,80,\u5458\u5de5\u798f\u5229|\u5ba2\u6237\u62dc\u8bbf,E:\\\\zhinengkefu\\\\desktop\\\\storage\\\\assets\\\\sku\\\\BOX-A\\\\1782471476421-BOX-A-demo.png,30*22*9,650,\u676d\u5dde\u793c\u76d2\u5382,5",
    "TEA-ACCEPT-1,\u771f\u5b9e\u9a8c\u6536\u8336\u793c,item,\u8336\u53f6,55,120,80,\u5458\u5de5\u798f\u5229|\u5ba2\u6237\u62dc\u8bbf,E:\\\\zhinengkefu\\\\desktop\\\\storage\\\\assets\\\\sku\\\\TEA-A\\\\1782471476440-TEA-A-demo.png,12*8*18,300,\u798f\u5efa\u8336\u4e1a\u4f9b\u5e94\u5546,3",
    "CARD-ACCEPT-1,\u771f\u5b9e\u9a8c\u6536\u8d3a\u5361,accessory,\u8d3a\u5361,3,12,200,\u5458\u5de5\u798f\u5229|\u5ba2\u6237\u62dc\u8bbf,E:\\\\zhinengkefu\\\\desktop\\\\storage\\\\assets\\\\sku\\\\CARD-A\\\\1782471476485-CARD-A-demo.png,10*15,20,\u672c\u5730\u5370\u5237\u5382,2",
  ];
  const textarea = await waitFor(() => document.querySelector("textarea"));
  setTextAreaValue(textarea, rows.join("\n"));
  const previewButton = await waitFor(() => document.querySelector('[data-action-id="catalog-import-preview"]'));
  click(previewButton);

  const imageCoverage = await waitFor(() => document.querySelector('[data-acceptance-id="catalog-import-image-coverage"]'), 20000);
  const bundleReadiness = await waitFor(() => document.querySelector('[data-acceptance-id="catalog-import-bundle-readiness"]'));
  const score = await waitFor(() => document.querySelector('[data-acceptance-id="catalog-import-commercial-score"]'));
  const summary = await waitFor(() => document.querySelector('[data-acceptance-id="catalog-import-readiness-summary"]'));
  if (!imageCoverage.innerText.includes("3 / 3")) {
    throw new Error(`catalog import image coverage was not ready: ${imageCoverage.innerText}`);
  }
  if (!bundleReadiness.innerText.trim()) throw new Error("catalog import bundle readiness was empty");
  if (!score.innerText.trim()) throw new Error("catalog import commercial score was empty");
  if (!summary.innerText.trim()) throw new Error("catalog import readiness summary was empty");

  window.__catalogImportReadinessScreenshotEval = {
    imageCoverage: imageCoverage.innerText,
    bundleReadiness: bundleReadiness.innerText,
    score: score.innerText,
    summary: summary.innerText,
  };
})();
