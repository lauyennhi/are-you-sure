// =====================================================
// AUS — Content Script
// FR-G-001 (Trigger), FR-G-003 (Modal Display / Shadow DOM)
// =====================================================

const MIN_WORDS = 15;
const MAX_WORDS = 500;
const FAB_DELAY_MS = 200;

let shadowHost, shadowRoot, fabEl, cardEl;
let fabTimer = null;
let currentSelectionText = "";
let currentSelectionRect = null;
let currentQueryHash = "";

// ---------------------------------------------------
// 1. Khởi tạo Shadow DOM root (cách ly CSS — FR-G-003)
// ---------------------------------------------------
function initShadowRoot() {
  if (shadowHost) return;

  shadowHost = document.createElement("div");
  shadowHost.id = "aus-shadow-host";
  Object.assign(shadowHost.style, {
    position: "absolute",
    top: "0",
    left: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
  });
  document.documentElement.appendChild(shadowHost);

  shadowRoot = shadowHost.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = getStyles();
  shadowRoot.appendChild(style);

  fabEl = document.createElement("div");
  fabEl.className = "aus-fab";
  fabEl.style.display = "none";
  fabEl.innerHTML = `<img src="${chrome.runtime.getURL("icons/icon24.png")}" width="14" height="14" alt="AUS"/>`;
  fabEl.style.pointerEvents = "auto";
  shadowRoot.appendChild(fabEl);

  cardEl = document.createElement("div");
  cardEl.className = "aus-card";
  cardEl.style.display = "none";
  cardEl.style.pointerEvents = "auto";
  shadowRoot.appendChild(cardEl);

  fabEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onFabClick();
  });
}

// ---------------------------------------------------
// 2. Phát hiện bôi đen văn bản (FR-G-001)
// ---------------------------------------------------
document.addEventListener("mouseup", () => {
  clearTimeout(fabTimer);
  fabTimer = setTimeout(handleSelection, FAB_DELAY_MS);
});

document.addEventListener("mousedown", (e) => {
  if (shadowHost && !shadowHost.contains(e.target)) {
    hideFab();
  }
});

function handleSelection() {
  const selection = window.getSelection();
  const text = selection.toString().trim();

  if (!text) {
    hideFab();
    return;
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) {
    hideFab();
    return;
  }

  initShadowRoot();

  const range = selection.getRangeAt(0);
  currentSelectionRect = range.getBoundingClientRect();
  currentSelectionText = text;

  showFab(currentSelectionRect);
}

function showFab(rect) {
  const top = rect.bottom + window.scrollY + 6;
  const left = rect.right + window.scrollX - 24;
  fabEl.style.top = `${top}px`;
  fabEl.style.left = `${left}px`;
  fabEl.style.display = "flex";
}

function hideFab() {
  if (fabEl) fabEl.style.display = "none";
}

// ---------------------------------------------------
// 3. Click FAB → gọi phân tích (FR-G-002)
// ---------------------------------------------------
async function onFabClick() {
  const rect = currentSelectionRect;
  const text = currentSelectionText;
  hideFab();
  showLoadingCard(rect);

  // Lấy 200 từ ngữ cảnh xung quanh (đơn giản hoá cho demo: dùng đoạn text cha)
  const contextText = getSurroundingContext(text);

  chrome.runtime.sendMessage(
    {
      type: "AUS_ANALYZE",
      selectedText: text,
      contextText,
      url: window.location.href,
    },
    (response) => {
      if (!response) {
        renderErrorCard("Không nhận được phản hồi từ hệ thống.");
        return;
      }
      if (!response.ok) {
        renderErrorCard(response.error || "Đã có lỗi xảy ra.");
        return;
      }
      renderResultCard(response.data);
    }
  );
}

function getSurroundingContext(selectedText) {
  const bodyText = document.body.innerText || "";
  const idx = bodyText.indexOf(selectedText);
  if (idx === -1) return "";
  const start = Math.max(0, idx - 400);
  const end = Math.min(bodyText.length, idx + selectedText.length + 400);
  return bodyText.slice(start, end);
}

// ---------------------------------------------------
// 4. Render UI: Loading (Trạng thái 2)
// ---------------------------------------------------
const QUOTES = [
  "Sự thật thường nằm ở giữa các góc nhìn...",
  "Một quan điểm không phải là một sự thật.",
  "Hãy hỏi: điều này dựa trên bằng chứng gì?",
];

function showLoadingCard(rect) {
  positionCard(rect);
  const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  cardEl.innerHTML = `
    <div class="aus-header">
      <div class="aus-brand">
        <img src="${chrome.runtime.getURL("icons/icon24.png")}" width="20" height="20"/>
        <span>Are you sure?</span>
      </div>
      <span class="aus-close" data-action="close">✕</span>
    </div>
    <div class="aus-loading">
      <div class="skeleton"></div>
      <div class="skeleton" style="width:80%"></div>
      <div class="skeleton" style="width:55%"></div>
      <p class="aus-quote">"${quote}"</p>
    </div>
  `;
  cardEl.style.display = "block";
  bindCloseButton();
}

// ---------------------------------------------------
// 5. Render UI: Verdict Card (Trạng thái 3)
// ---------------------------------------------------
function renderResultCard(data) {
  const score = data.objectivity_score ?? 3;
  const bars = Array.from({ length: 5 }, (_, i) =>
    `<span class="bar ${i < Math.round(score) ? "filled" : ""}"></span>`
  ).join("");

  cardEl.innerHTML = `
    <div class="aus-header">
      <div class="aus-brand">
        <img src="${chrome.runtime.getURL("icons/icon24.png")}" width="20" height="20"/>
        <span>Are you sure?</span>
      </div>
      <span class="aus-close" data-action="close">✕</span>
    </div>

    <div class="aus-body">
      <div class="aus-badge">⚠ Cần thận trọng${data.fallacy_detected ? ` — ${escapeHtml(data.fallacy_detected)}` : ""}</div>
      <p class="aus-claim">"${escapeHtml(data.core_claim || "")}"</p>

      <div class="aus-tabs">
        <button class="aus-tab active" data-tab="current">Góc nhìn hiện tại</button>
        <button class="aus-tab" data-tab="dialectic">Góc nhìn biện chứng</button>
      </div>

      <div class="aus-panel" data-panel="current">
        <div class="aus-bullet"><span class="dot muted"></span><p>${escapeHtml(data.core_claim || "")}</p></div>
      </div>
      <div class="aus-panel" data-panel="dialectic" style="display:none">
        ${(data.counter_perspectives || [])
          .map(
            (cp) =>
              `<div class="aus-bullet"><span class="dot accent"></span><p><strong>${escapeHtml(cp.perspective)}</strong><br/><span class="reason">${escapeHtml(cp.reasoning)}</span></p></div>`
          )
          .join("")}
      </div>

      <div class="aus-footer-row">
        <div class="aus-score">${bars}<span>Độ khách quan ${score.toFixed(1)}/5</span></div>
        ${data._demo_mode ? '<span class="aus-demo-tag">Chế độ demo</span>' : ""}
      </div>
    </div>

    <div class="aus-actions">
      <button data-action="copy">⧉ Copy phân tích</button>
      <button data-action="feedback-biased">⚑ Báo cáo lỗi</button>
    </div>
  `;

  bindCardEvents(data);
}

function renderErrorCard(message) {
  cardEl.innerHTML = `
    <div class="aus-header">
      <div class="aus-brand"><span>Are you sure?</span></div>
      <span class="aus-close" data-action="close">✕</span>
    </div>
    <div class="aus-body">
      <p class="aus-error">⚠ ${escapeHtml(message)}</p>
    </div>
  `;
  bindCloseButton();
}

function positionCard(rect) {
  const top = rect.bottom + window.scrollY + 10;
  let left = rect.left + window.scrollX;
  const cardWidth = 340;
  if (left + cardWidth > window.innerWidth + window.scrollX) {
    left = window.innerWidth + window.scrollX - cardWidth - 16;
  }
  cardEl.style.top = `${top}px`;
  cardEl.style.left = `${left}px`;
}

function bindCloseButton() {
  cardEl.querySelector('[data-action="close"]')?.addEventListener("click", () => {
    cardEl.style.display = "none";
  });
}

function bindCardEvents(data) {
  bindCloseButton();

  cardEl.querySelectorAll(".aus-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      cardEl.querySelectorAll(".aus-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      cardEl.querySelectorAll(".aus-panel").forEach((panel) => {
        panel.style.display = panel.dataset.panel === target ? "block" : "none";
      });
    });
  });

  cardEl.querySelector('[data-action="copy"]')?.addEventListener("click", () => {
    const text = `${data.core_claim}\n\n${(data.counter_perspectives || [])
      .map((cp) => `- ${cp.perspective} (${cp.reasoning})`)
      .join("\n")}`;
    navigator.clipboard.writeText(text);
    sendFeedback("HELPFUL");
  });

  cardEl.querySelector('[data-action="feedback-biased"]')?.addEventListener("click", () => {
    sendFeedback("BIASED");
    alert("Cảm ơn phản hồi! AUS sẽ dùng dữ liệu này để cải thiện độ chính xác.");
  });
}

async function sendFeedback(rating) {
  chrome.runtime.sendMessage({
    type: "AUS_FEEDBACK",
    queryHash: currentQueryHash,
    rating,
    domain: window.location.hostname,
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------------------------------------------------
// 6. CSS (đóng gói trong Shadow DOM — không rò ra ngoài)
// ---------------------------------------------------
function getStyles() {
  return `
    :host { all: initial; }
    .aus-fab {
      position: absolute; width: 24px; height: 24px; border-radius: 50%;
      background: #141414; align-items: center; justify-content: center;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25); cursor: pointer;
      font-family: Arial, sans-serif;
    }
    .aus-card {
      position: absolute; width: 340px; background: #FFFFFF; border-radius: 16px;
      border: 1px solid #E4E2DA; box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      font-family: Arial, sans-serif; overflow: hidden;
    }
    .aus-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid #E4E2DA;
    }
    .aus-brand { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: bold; color: #141414; }
    .aus-close { cursor: pointer; color: #8B8A82; font-size: 13px; }
    .aus-loading { padding: 16px; }
    .skeleton { height: 10px; background: #F0EFEA; border-radius: 4px; margin-bottom: 8px; }
    .aus-quote { font-size: 12px; font-style: italic; color: #8B8A82; text-align: center; margin-top: 10px; }
    .aus-body { padding: 14px 14px 4px; }
    .aus-badge {
      display: inline-block; background: #FAEEDA; color: #854F0B; font-size: 11px;
      font-weight: bold; padding: 4px 10px; border-radius: 20px; margin-bottom: 10px;
    }
    .aus-claim { font-size: 12px; font-style: italic; color: #5F5E5A; margin: 0 0 14px; line-height: 1.5; }
    .aus-tabs { display: flex; background: #F2F4F7; border-radius: 10px; padding: 3px; gap: 2px; margin-bottom: 12px; }
    .aus-tab {
      flex: 1; border: none; background: transparent; border-radius: 8px; padding: 6px 0;
      font-size: 11px; font-weight: bold; color: #5F5E5A; cursor: pointer;
    }
    .aus-tab.active { background: #FFFFFF; color: #141414; }
    .aus-bullet { display: flex; gap: 8px; margin-bottom: 10px; }
    .aus-bullet p { font-size: 12px; line-height: 1.5; color: #141414; margin: 0; }
    .aus-bullet .reason { color: #8B8A82; font-size: 11px; }
    .dot { width: 5px; height: 5px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
    .dot.muted { background: #8B8A82; }
    .dot.accent { background: #185FA5; }
    .aus-footer-row {
      display: flex; align-items: center; justify-content: space-between;
      border-top: 1px solid #E4E2DA; padding: 10px 0; margin-top: 6px;
    }
    .aus-score { display: flex; align-items: center; gap: 6px; font-size: 10px; color: #8B8A82; }
    .bar { width: 4px; height: 12px; border-radius: 2px; background: #E4E2DA; display: inline-block; }
    .bar.filled { background: #EF9F27; }
    .aus-demo-tag { font-size: 10px; color: #185FA5; font-style: italic; }
    .aus-actions { display: flex; gap: 8px; padding: 10px 14px 14px; }
    .aus-actions button {
      flex: 1; font-size: 11px; padding: 8px 0; border-radius: 8px; border: 1px solid #E4E2DA;
      background: #FFFFFF; cursor: pointer; color: #141414;
    }
    .aus-actions button:hover { background: #F2F4F7; }
    .aus-error { font-size: 12px; color: #B3261E; }
  `;
}
