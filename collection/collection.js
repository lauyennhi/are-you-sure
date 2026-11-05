const listEl = document.getElementById("list");
const qEl = document.getElementById("q");
let items = [];
const open = new Set();

const esc = (s) => {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
};
const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? u : "");

async function load() {
  const { aus_collection = [] } = await chrome.storage.local.get("aus_collection");
  items = aus_collection;
  render();
  const id = location.hash.slice(1);
  if (id) document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.add("hl");
}

function detailHtml(it) {
  const a = it.analysis, p = it.perspectives;
  let h = "";
  if (a) {
    h += `<h4>Luận điểm</h4><p>${esc(a.core_claim)}</p><p>${esc(a.summary)}</p>`;
    if (a.biases?.length) h += `<h4>Thiên kiến</h4>` + a.biases.map((b) => `<p><b>${esc(b.name)}</b> — ${esc(b.explanation)}</p>`).join("");
  }
  if (p) {
    if (p.rebuttal) h += `<h4>Phản biện</h4><p>${esc(p.rebuttal)}</p>`;
    if (p.expert_perspectives?.length) {
      h += `<h4>Góc nhìn chuyên môn</h4>` + p.expert_perspectives.map((e) =>
        `<p><b>[${esc(e.domain)}] ${esc(e.title)}</b><br>${esc(e.content)}${
          e.sources?.length ? `<br><small>Nguồn: ${e.sources.map((s) => safeUrl(s.url) ? `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>` : esc(s.name)).join("; ")}</small>` : ""}</p>`).join("");
    }
  }
  if (it.chat?.length) {
    h += `<h4>Cuộc phản biện cùng AI</h4>` + it.chat.map((m) => `<p><b>${m.role === "user" ? "Bạn" : "AI"}:</b> ${esc(m.text)}</p>`).join("");
  }
  h += `<h4>Ghi chú của bạn</h4><textarea data-note="${esc(it.id)}" placeholder="Viết suy nghĩ của bạn...">${esc(it.note)}</textarea>`;
  return h;
}

function render() {
  const q = qEl.value.trim().toLowerCase();
  const shown = items.filter((it) => !q || JSON.stringify(it).toLowerCase().includes(q));
  if (!shown.length) {
    listEl.innerHTML = `<div class="empty">${items.length ? "Không có kết quả phù hợp." : "Chưa có gì trong bộ sưu tập.<br>Bôi đen một đoạn văn, xem góc nhìn khác rồi bấm “Lưu vào bộ sưu tập”."}</div>`;
    return;
  }
  listEl.innerHTML = shown.map((it) => {
    const a = it.analysis;
    return `<article class="card" data-id="${esc(it.id)}">
      <div class="meta"><span>${new Date(it.savedAt).toLocaleString("vi-VN")}</span>
        ${safeUrl(it.url) ? `<a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">${esc(it.pageTitle || it.url)} ↗</a>` : ""}</div>
      <blockquote>${esc(it.selectedText.length > 280 ? it.selectedText.slice(0, 280) + "…" : it.selectedText)}</blockquote>
      ${a ? `<div class="stats"><span class="pill p">${a.opposition_percent}% đối lập</span><span class="pill">Phân cực ${a.polarization.score}%</span><span class="pill">Bong bóng ${a.filter_bubble.score}%</span><span class="pill">Buồng vang ${a.echo_chamber.score}%</span></div>` : ""}
      <div class="actions"><button data-toggle="${esc(it.id)}">${open.has(it.id) ? "Thu gọn" : "Xem chi tiết"}</button>
        <button class="danger" data-del="${esc(it.id)}">Xoá</button></div>
      ${open.has(it.id) ? `<div class="detail">${detailHtml(it)}</div>` : ""}
    </article>`;
  }).join("");
}

listEl.addEventListener("click", async (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.toggle) {
    open.has(t.dataset.toggle) ? open.delete(t.dataset.toggle) : open.add(t.dataset.toggle);
    render();
  } else if (t.dataset.del) {
    if (!confirm("Xoá mục này khỏi bộ sưu tập?")) return;
    items = items.filter((i) => i.id !== t.dataset.del);
    await chrome.storage.local.set({ aus_collection: items });
    render();
  }
});

listEl.addEventListener("change", async (e) => {
  const id = e.target.dataset?.note;
  if (!id) return;
  const it = items.find((i) => i.id === id);
  if (it) { it.note = e.target.value; await chrome.storage.local.set({ aus_collection: items }); }
});

qEl.addEventListener("input", render);

document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `aus-collection-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

load();
