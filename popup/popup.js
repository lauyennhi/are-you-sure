const apiKeyInput = document.getElementById("apiKey");
const statusEl = document.getElementById("status");
const cacheCountEl = document.getElementById("cacheCount");
const feedbackCountEl = document.getElementById("feedbackCount");

async function loadSettings() {
  const { geminiApiKey } = await chrome.storage.sync.get("geminiApiKey");
  if (geminiApiKey) apiKeyInput.value = geminiApiKey;
  refreshStats();
}

async function refreshStats() {
  const local = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(local).filter((k) => k.startsWith("cache_"));
  const feedbackLogs = local["feedback_logs"] || [];
  cacheCountEl.textContent = `Cache: ${cacheKeys.length} mục đã lưu`;
  feedbackCountEl.textContent = `Feedback logs: ${feedbackLogs.length} phản hồi`;
}

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({ geminiApiKey: apiKeyInput.value.trim() });
  statusEl.textContent = "Đã lưu ✓";
  setTimeout(() => (statusEl.textContent = ""), 2000);
});

document.getElementById("clearCache").addEventListener("click", async () => {
  const local = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(local).filter((k) => k.startsWith("cache_"));
  await chrome.storage.local.remove(cacheKeys);
  refreshStats();
});

loadSettings();
