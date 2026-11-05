const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.sync.get(["geminiApiKey", "geminiModel", "ausEnabled", "disabledSites"]);
  $("apiKey").value = s.geminiApiKey || "";
  $("model").value = s.geminiModel || "";
  $("enabled").checked = s.ausEnabled !== false;
  renderMuted(s.disabledSites || []);
  refreshStats();
}

function renderMuted(sites) {
  $("muted").innerHTML = sites.length
    ? "Đã tắt ở: " + sites.map((d) => `<span>${d.replace(/[<>&"]/g, "")}<b data-d="${d.replace(/[<>&"]/g, "")}" title="Bật lại">✕</b></span>`).join("")
    : "";
}

async function refreshStats() {
  const local = await chrome.storage.local.get(null);
  $("collectionCount").textContent = `Bộ sưu tập: ${(local.aus_collection || []).length} mục`;
  $("cacheCount").textContent = `Cache: ${Object.keys(local).filter((k) => k.startsWith("cache_")).length} mục`;
}

$("enabled").addEventListener("change", () => chrome.storage.sync.set({ ausEnabled: $("enabled").checked }));

$("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({ geminiApiKey: $("apiKey").value.trim(), geminiModel: $("model").value.trim() });
  $("status").textContent = "Đã lưu ✓";
  setTimeout(() => ($("status").textContent = ""), 2000);
});

$("muted").addEventListener("click", async (e) => {
  const d = e.target.dataset?.d;
  if (!d) return;
  const { disabledSites = [] } = await chrome.storage.sync.get("disabledSites");
  const next = disabledSites.filter((x) => x !== d);
  await chrome.storage.sync.set({ disabledSites: next });
  renderMuted(next);
});

$("openCollection").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("collection/collection.html") }));

$("clearCache").addEventListener("click", async () => {
  const local = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(local).filter((k) => k.startsWith("cache_")));
  refreshStats();
});

load();
