(async () => {
  const { ausTheme } = await chrome.storage.sync.get("ausTheme");
  if (ausTheme && ausTheme !== "auto") document.documentElement.dataset.theme = ausTheme;
  chrome.storage.onChanged.addListener((c, a) => {
    if (a === "sync" && c.ausTheme) {
      const v = c.ausTheme.newValue;
      v && v !== "auto" ? (document.documentElement.dataset.theme = v) : delete document.documentElement.dataset.theme;
    }
  });
})();
