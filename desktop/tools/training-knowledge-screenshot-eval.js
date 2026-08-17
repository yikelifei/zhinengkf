(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 12000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await wait(150);
    }
    throw new Error("training knowledge screenshot target was not ready");
  };
  const click = (element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

  const toggle = await waitFor(() => document.querySelector('[data-action-id^="training-knowledge-toggle-"]'));
  click(toggle);
  const editor = await waitFor(() => document.querySelector('[data-action-id^="training.knowledge.edit.content."]'));

  const noteBox = Array.from(document.querySelectorAll("textarea"))
    .find((textarea) => !textarea.getAttribute("data-action-id"));
  if (noteBox) {
    noteBox.value = "Local acceptance check for knowledge readiness.";
    noteBox.dispatchEvent(new Event("input", { bubbles: true }));
    noteBox.dispatchEvent(new Event("change", { bubbles: true }));
  }

  editor.scrollIntoView({ block: "center", inline: "nearest" });
  await wait(300);
  return {
    expanded: Boolean(editor),
    readyButton: Boolean(document.querySelector('[data-action-id^="training.knowledge.ready."]')),
  };
})();
