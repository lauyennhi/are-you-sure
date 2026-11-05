// =====================================================
// AUS — Content Script
// Bôi đen → bong bóng giữa màn hình (kéo giãn / click để vỡ)
//        → Dashboard phân tích → Góc nhìn khác → Phản biện cùng AI → Lưu bộ sưu tập
// Giao diện cách ly bằng Shadow DOM, 3 màu: Forest Green / Sand Beige / Electric Purple
// =====================================================

const MIN_WORDS = 12;
const MAX_WORDS = 500;
const TRIGGER_DELAY_MS = 250;

let host, root, layerEl;
let triggerTimer = null;
let enabled = true;
let disabledSites = [];

// Trạng thái phiên phân tích hiện tại
let session = null; // { text, context, comments, analysis, perspectives, chat, queryHash, saved, id }

chrome.storage.sync.get(["ausEnabled", "disabledSites"]).then((s) => {
  enabled = s.ausEnabled !== false;
  disabledSites = s.disabledSites || [];
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.ausEnabled) enabled = changes.ausEnabled.newValue !== false;
  if (changes.disabledSites) disabledSites = changes.disabledSites.newValue || [];
});

// ---------------------------------------------------
// 1. Shadow DOM
// ---------------------------------------------------
function initRoot() {
  if (host) return;
  host = document.createElement("div");
  host.id = "aus-shadow-host";
  Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "2147483647", pointerEvents: "none" });
  document.documentElement.appendChild(host);
  root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = getStyles();
  root.appendChild(style);
  layerEl = document.createElement("div");
  layerEl.className = "layer";
  root.appendChild(layerEl);
}

const icon = () => chrome.runtime.getURL("icons/icon24.png");
const $ = (sel, el = layerEl) => el.querySelector(sel);

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

// Markdown tối giản cho chat: **đậm**, "- " gạch đầu dòng, xuống dòng
function renderChatText(s) {
  const lines = escapeHtml(s).split("\n");
  let html = "", inList = false;
  for (const line of lines) {
    const m = line.match(/^\s*[-*•]\s+(.*)/);
    if (m) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${m[1]}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim()) html += `<p>${line}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

function send(msg) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) return reject(new Error("Extension vừa được cập nhật — hãy tải lại trang (F5)."));
        if (!res) return reject(new Error("Không nhận được phản hồi từ hệ thống."));
        if (!res.ok) return reject(new Error(res.error || "Đã có lỗi xảy ra."));
        resolve(res);
      });
    } catch {
      reject(new Error("Extension vừa được cập nhật — hãy tải lại trang (F5)."));
    }
  });
}

// ---------------------------------------------------
// 2. Phát hiện bôi đen
// ---------------------------------------------------
function inOurUI(node) {
  return host && node && (node === host || host.contains(node));
}

document.addEventListener("mouseup", (e) => {
  if (inOurUI(e.target)) return;
  clearTimeout(triggerTimer);
  triggerTimer = setTimeout(handleSelection, TRIGGER_DELAY_MS);
});

document.addEventListener("keyup", (e) => {
  if (e.key === "Escape") return closeAll();
  if (e.shiftKey && /Arrow|Home|End/.test(e.key)) {
    clearTimeout(triggerTimer);
    triggerTimer = setTimeout(handleSelection, 500);
  }
});

function handleSelection() {
  if (!enabled || disabledSites.includes(location.hostname)) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  if (inOurUI(sel.anchorNode)) return;
  const text = sel.toString().trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS || words > MAX_WORDS) return;
  // Đang xem dashboard cho đúng đoạn này → không bật lại bong bóng
  if (session && session.text === text && $(".dash")) return;

  const range = sel.getRangeAt(0);
  const anchorEl = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;

  initRoot();
  session = {
    text,
    context: getSurroundingContext(text, anchorEl),
    comments: collectComments(anchorEl, text),
    analysis: null,
    perspectives: null,
    chat: [],
    queryHash: "",
    saved: false,
    id: null,
  };
  showBubble();
}

function getSurroundingContext(text, anchorEl) {
  const container = anchorEl?.closest?.('[role="article"], article, main, section') || document.body;
  const body = container.innerText || "";
  const idx = body.indexOf(text.slice(0, 80));
  if (idx === -1) return "";
  return body.slice(Math.max(0, idx - 400), Math.min(body.length, idx + text.length + 400));
}

// Thu thập bình luận hiển thị trên trang (Facebook dùng role=article lồng nhau; trang khác dùng class/id có "comment")
function collectComments(anchorEl, selectedText) {
  const out = new Set();
  const add = (el) => {
    const t = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (t.length >= 20 && t.length <= 600 && !selectedText.includes(t.slice(0, 60))) out.add(t);
  };
  try {
    const post = anchorEl?.closest?.('[role="article"]');
    if (post) {
      const top = post.parentElement?.closest?.('[role="article"]') || post;
      top.querySelectorAll('[role="article"]').forEach((el) => { if (el !== post) add(el); });
    }
    if (out.size < 3) {
      const scope = anchorEl?.closest?.("article, main, body") || document.body;
      scope
        .querySelectorAll('[class*="comment" i]:not(:has([class*="comment" i])), [id*="comment" i]:not(:has([id*="comment" i])), [data-testid*="comment" i]')
        .forEach((el) => { if (out.size < 20 && !el.contains(anchorEl)) add(el); });
    }
  } catch { /* selector không hỗ trợ — bỏ qua */ }
  return [...out].slice(0, 15);
}

// ---------------------------------------------------
// 3. Bong bóng (popup giữa màn hình)
// ---------------------------------------------------
function showBubble() {
  layerEl.innerHTML = `
    <div class="scrim"></div>
    <div class="bubble-wrap" role="dialog" aria-label="Are you sure?">
      <div class="bubble-skin"><i class="shine"></i><i class="shine2"></i></div>
      <div class="bubble-content">
        <img src="${icon()}" width="26" height="26" alt=""/>
        <h2>Bạn có muốn xem<br/>góc nhìn khác không?</h2>
        <p>Giữ &amp; kéo để kéo giãn · Chạm vào bong bóng để làm vỡ</p>
        <div class="btn-row">
          <button class="btn ghost" data-act="skip">Bỏ qua</button>
          <button class="btn primary" data-act="view">Xem góc nhìn khác</button>
        </div>
      </div>
    </div>`;
  const wrap = $(".bubble-wrap");
  const skin = $(".bubble-skin");

  $('[data-act="skip"]').addEventListener("click", (e) => { e.stopPropagation(); closeAll(); });
  $('[data-act="view"]').addEventListener("click", (e) => { e.stopPropagation(); popBubble(); });
  $(".scrim").addEventListener("click", closeAll);

  // Kéo giãn bằng pointer; thả → bật lại như lò xo; click không kéo → vỡ
  let start = null, moved = 0;
  wrap.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    start = { x: e.clientX, y: e.clientY };
    moved = 0;
    skin.style.transition = "none";
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    moved = Math.max(moved, Math.hypot(dx, dy));
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const pull = Math.min(Math.max(Math.abs(dx), Math.abs(dy)) / 240, 0.7);
    const sx = horizontal ? 1 + pull : 1 - pull * 0.35;
    const sy = horizontal ? 1 - pull * 0.35 : 1 + pull;
    skin.style.transform = `translate(${dx * 0.18}px, ${dy * 0.18}px) scale(${sx}, ${sy})`;
  });
  const release = () => {
    if (!start) return;
    start = null;
    if (moved < 6) { popBubble(); return; }
    skin.style.transition = "transform .7s cubic-bezier(.34,1.9,.5,1)";
    skin.style.transform = "translate(0,0) scale(1,1)";
  };
  wrap.addEventListener("pointerup", release);
  wrap.addEventListener("pointercancel", release);
}

function popBubble() {
  const wrap = $(".bubble-wrap");
  if (!wrap || wrap.classList.contains("burst")) return;
  wrap.classList.add("burst");
  const rect = wrap.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  for (let i = 0; i < 18; i++) {
    const p = document.createElement("i");
    p.className = "drop";
    const ang = (Math.PI * 2 * i) / 18 + Math.random() * 0.4;
    const dist = 140 + Math.random() * 120;
    const size = 8 + Math.random() * 18;
    Object.assign(p.style, {
      left: `${cx}px`, top: `${cy}px`, width: `${size}px`, height: `${size}px`,
      "--dx": `${Math.cos(ang) * dist}px`, "--dy": `${Math.sin(ang) * dist}px`,
    });
    layerEl.appendChild(p);
    setTimeout(() => p.remove(), 800);
  }
  setTimeout(showDashboard, 380);
}

function closeAll() {
  if (layerEl) layerEl.innerHTML = "";
  session = null;
  window.getSelection()?.removeAllRanges?.();
}

// ---------------------------------------------------
// 4. Dashboard
// ---------------------------------------------------
function shell(bodyHtml, withTabs) {
  return `
    <div class="scrim"></div>
    <div class="dash" role="dialog" aria-label="Are you sure? — phân tích">
      <div class="dash-head">
        <div class="brand"><img src="${icon()}" width="20" height="20" alt=""/><span>Are you sure?</span></div>
        <div class="head-actions">
          <button class="icon-btn" data-act="collection" title="Mở bộ sưu tập">▤ Bộ sưu tập</button>
          <button class="icon-btn" data-act="close" title="Đóng (Esc)">✕</button>
        </div>
      </div>
      ${withTabs ? `
      <div class="tabs">
        <button class="tab ${withTabs === "analysis" ? "active" : ""}" data-tab="analysis">Phân tích</button>
        <button class="tab ${withTabs === "perspectives" ? "active" : ""}" data-tab="perspectives">Góc nhìn khác</button>
        <button class="tab ${withTabs === "chat" ? "active" : ""}" data-tab="chat">Phản biện cùng AI</button>
      </div>` : ""}
      <div class="dash-body">${bodyHtml}</div>
      ${withTabs ? `<div class="dash-foot">
        <button class="btn ghost small" data-act="save">${session?.saved ? "✓ Đã lưu vào bộ sưu tập" : "＋ Lưu vào bộ sưu tập"}</button>
        <button class="btn ghost small" data-act="copy">⧉ Sao chép</button>
        <button class="btn ghost small" data-act="report">⚑ Báo sai</button>
        <button class="btn ghost small" data-act="mute" title="Tắt AUS trên trang này">⦸ Tắt ở trang này</button>
      </div>` : ""}
    </div>`;
}

function bindShell() {
  $(".scrim")?.addEventListener("click", closeAll);
  $('[data-act="close"]')?.addEventListener("click", closeAll);
  $('[data-act="collection"]')?.addEventListener("click", () => send({ type: "AUS_OPEN_COLLECTION" }).catch(() => {}));
  layerEl.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  $('[data-act="save"]')?.addEventListener("click", onSave);
  $('[data-act="copy"]')?.addEventListener("click", onCopy);
  $('[data-act="report"]')?.addEventListener("click", onReport);
  $('[data-act="mute"]')?.addEventListener("click", async () => {
    await send({ type: "AUS_DISABLE_SITE", domain: location.hostname }).catch(() => {});
    toast("Đã tắt AUS ở trang này. Bật lại trong popup extension.");
    setTimeout(closeAll, 1200);
  });
}

function showDashboard() {
  if (!session) return;
  layerEl.innerHTML = shell(loadingHtml("Đang phân tích đoạn văn..."), false);
  bindShell();
  if (session.analysis) return showTab("analysis");

  send({ type: "AUS_ANALYZE", selectedText: session.text, contextText: session.context, url: location.href })
    .then((res) => {
      if (!session) return;
      session.analysis = res.data;
      session.queryHash = res.queryHash || "";
      showTab("analysis");
    })
    .catch((err) => showError(err.message, showDashboard));
}

function loadingHtml(msg) {
  const quotes = [
    "Sự thật thường nằm ở giữa các góc nhìn...",
    "Một quan điểm không phải là một sự thật.",
    "Hãy hỏi: điều này dựa trên bằng chứng gì?",
  ];
  return `<div class="loading"><div class="orb"></div><p class="loading-msg">${msg}</p>
    <p class="quote">“${quotes[Math.floor(Math.random() * quotes.length)]}”</p></div>`;
}

function showError(message, retry) {
  if (!layerEl) return;
  layerEl.innerHTML = shell(`<div class="error"><p>⚠ ${escapeHtml(message)}</p>
    <div class="btn-row"><button class="btn ghost" data-act="close">Đóng</button>
    <button class="btn primary" data-act="retry">Thử lại</button></div></div>`, false);
  bindShell();
  $('[data-act="retry"]')?.addEventListener("click", retry);
}

function showTab(name) {
  if (!session) return;
  if (name === "analysis") renderAnalysis();
  else if (name === "perspectives") renderPerspectives();
  else renderChat();
}

// --- Tab: Phân tích ---
function gauge(pct) {
  const r = 54, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 130 130" class="gauge" aria-label="${pct}% đối lập nhận thức">
    <circle cx="65" cy="65" r="${r}" class="g-track"/>
    <circle cx="65" cy="65" r="${r}" class="g-val" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - pct / 100)}"/>
    <text x="65" y="64" text-anchor="middle" class="g-num">${pct}%</text>
    <text x="65" y="84" text-anchor="middle" class="g-lbl">đối lập nhận thức</text>
  </svg>`;
}

function meter(label, m, hint) {
  return `<div class="meter" title="${escapeHtml(hint)}">
    <div class="meter-top"><span>${label}</span><b>${m.score}%</b></div>
    <div class="track"><div class="fill" style="width:0" data-w="${m.score}"></div></div>
    ${m.note ? `<small>${escapeHtml(m.note)}</small>` : ""}
  </div>`;
}

function renderAnalysis() {
  const a = session.analysis;
  const riskText = { low: "Rủi ro thấp", medium: "Cần thận trọng", high: "Rủi ro cao" }[a.risk_level];
  const html = `
    <div class="hero">
      ${gauge(a.opposition_percent)}
      <div class="hero-txt">
        <span class="chip ${a.risk_level}">${riskText}</span>
        <p class="claim">“${escapeHtml(a.core_claim)}”</p>
        <p class="sum">${escapeHtml(a.summary)}</p>
        ${a._demo_mode ? '<span class="demo">Chế độ demo — nhập API key trong popup để dùng AI thật</span>' : ""}
      </div>
    </div>
    <div class="meters">
      ${meter("Phân cực", a.polarization, "Mức độ chia phe, trắng–đen")}
      ${meter("Bong bóng lọc", a.filter_bubble, "Chỉ thấy một lát cắt thông tin")}
      ${meter("Buồng vang", a.echo_chamber, "Củng cố niềm tin nhóm, gạt tiếng nói khác")}
      ${meter("Cảm xúc hoá", a.emotional_intensity, "Dùng cảm xúc thay cho lập luận")}
    </div>
    <div class="objectivity"><span>Độ khách quan</span>
      <div class="track"><div class="fill alt" style="width:0" data-w="${a.objectivity}"></div></div><b>${a.objectivity}/100</b></div>
    ${a.biases.length ? `<h3>Thiên kiến phát hiện</h3>${a.biases.map((b) => `
      <div class="item"><b>${escapeHtml(b.name)}</b><p>${escapeHtml(b.explanation)}</p>
      ${b.evidence ? `<small>Dấu hiệu: ${escapeHtml(b.evidence)}</small>` : ""}</div>`).join("")}` : ""}
    ${a.fallacies.length ? `<h3>Ngụy biện logic</h3>${a.fallacies.map((f) => `
      <div class="item"><b>${escapeHtml(f.name)}</b><p>${escapeHtml(f.explanation)}</p></div>`).join("")}` : ""}
    <div class="cta"><button class="btn primary wide" data-tab="perspectives">Xem góc nhìn khác →</button></div>`;
  layerEl.innerHTML = shell(html, "analysis");
  bindShell();
  $(".cta .btn")?.addEventListener("click", () => showTab("perspectives"));
  requestAnimationFrame(() => requestAnimationFrame(animateBars));
}

function animateBars() {
  layerEl.querySelectorAll(".fill").forEach((f) => (f.style.width = `${f.dataset.w}%`));
  layerEl.querySelectorAll(".g-val").forEach((g) => (g.style.strokeDashoffset = g.dataset.target));
}

// --- Tab: Góc nhìn khác ---
function sourceLink(s) {
  return s.url
    ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)} ↗</a>`
    : `<span>${escapeHtml(s.name)}</span>`;
}

function renderPerspectives() {
  if (!session.perspectives) {
    layerEl.innerHTML = shell(loadingHtml("Đang tìm các góc nhìn khác & nguồn kiểm chứng..."), "perspectives");
    bindShell();
    send({
      type: "AUS_PERSPECTIVES",
      selectedText: session.text,
      contextText: session.context,
      comments: session.comments,
      url: location.href,
    })
      .then((res) => {
        if (!session) return;
        session.perspectives = res.data;
        if ($(".tab.active")?.dataset.tab === "perspectives") renderPerspectives();
      })
      .catch((err) => {
        if (!layerEl || !$(".tab.active") || $(".tab.active").dataset.tab !== "perspectives") return;
        $(".dash-body").innerHTML = `<div class="error"><p>⚠ ${escapeHtml(err.message)}</p>
          <div class="btn-row"><button class="btn primary" data-act="retry">Thử lại</button></div></div>`;
        $('[data-act="retry"]').addEventListener("click", renderPerspectives);
      });
    return;
  }
  const p = session.perspectives;
  const stanceIcon = { "đồng tình": "＋", "phản đối": "−", "trung lập": "○", "bổ sung": "◇" };
  const html = `
    ${p.rebuttal ? `<div class="rebuttal"><h3>Phản biện tổng hợp</h3><p>${escapeHtml(p.rebuttal)}</p></div>` : ""}
    <h3>Góc nhìn trong bình luận</h3>
    ${p.comment_perspectives.length
      ? p.comment_perspectives.map((c) => `
        <div class="item row"><span class="stance">${stanceIcon[c.stance] || "○"}</span>
        <div><b>${escapeHtml(c.stance)}</b> · ~${c.share}%<p>${escapeHtml(c.viewpoint)}</p></div></div>`).join("")
      : `<p class="muted">Không tìm thấy bình luận nào trên trang này để tổng hợp. Hãy mở phần bình luận rồi thử lại.</p>`}
    <h3>Góc nhìn chuyên môn có nguồn</h3>
    ${p.expert_perspectives.map((e) => `
      <div class="item">
        <span class="domain">${escapeHtml(e.domain)}</span>
        <b>${escapeHtml(e.title)}</b>
        <p>${escapeHtml(e.content)}</p>
        ${e.sources.length ? `<div class="sources">${e.sources.map(sourceLink).join("")}</div>` : ""}
      </div>`).join("")}
    ${p.new_angles.length ? `<h3>Góc nhìn mới</h3>${p.new_angles.map((n) => `<div class="item row"><span class="stance">✦</span><p>${escapeHtml(n)}</p></div>`).join("")}` : ""}
    ${p.questions_to_ask.length ? `<h3>Tự hỏi mình</h3>${p.questions_to_ask.map((q) => `<div class="item q"><p>${escapeHtml(q)}</p></div>`).join("")}` : ""}
    ${p.verified_sources.length ? `<h3>Nguồn tra cứu</h3><div class="sources">${p.verified_sources.map(sourceLink).join("")}</div>` : ""}
    ${p._demo_mode ? '<p class="demo">Chế độ demo — nội dung mẫu, chưa phải phân tích AI thật.</p>' : '<p class="muted small">AI có thể sai. Hãy tự kiểm tra nguồn trước khi dùng.</p>'}
    <div class="cta"><button class="btn primary wide" data-tab="chat">Phản biện cùng AI →</button></div>`;
  layerEl.innerHTML = shell(html, "perspectives");
  bindShell();
  $(".cta .btn")?.addEventListener("click", () => showTab("chat"));
}

// --- Tab: Phản biện cùng AI ---
function renderChat() {
  const a = session.analysis;
  const intro = a?.core_claim
    ? `Mình đã đọc đoạn bạn chọn. Luận điểm chính: “${a.core_claim}”. Bạn đồng ý hay không đồng ý, và vì sao?`
    : "Bạn nghĩ gì về đoạn văn này? Hãy nói quan điểm của bạn, mình sẽ phản biện.";
  const msgs = [{ role: "model", text: intro }, ...session.chat];
  layerEl.innerHTML = shell(`
    <div class="chat">
      <div class="msgs">${msgs.map((m) => `<div class="msg ${m.role}">${renderChatText(m.text)}</div>`).join("")}</div>
      <form class="chat-form">
        <textarea rows="2" placeholder="Nhập quan điểm của bạn... (Enter để gửi)"></textarea>
        <button class="btn primary" type="submit">Gửi</button>
      </form>
    </div>`, "chat");
  bindShell();
  const form = $(".chat-form"), ta = $("textarea"), box = $(".msgs");
  box.scrollTop = box.scrollHeight;
  ta.focus();
  let busy = false;

  const submit = async () => {
    const text = ta.value.trim();
    if (!text || busy) return;
    busy = true;
    ta.value = "";
    session.chat.push({ role: "user", text });
    box.insertAdjacentHTML("beforeend", `<div class="msg user">${renderChatText(text)}</div><div class="msg model typing"><span></span><span></span><span></span></div>`);
    box.scrollTop = box.scrollHeight;
    try {
      const res = await send({
        type: "AUS_CHAT",
        selectedText: session.text,
        coreClaim: a?.core_claim,
        summary: a?.summary,
        history: session.chat,
      });
      session.chat.push({ role: "model", text: res.text });
      box.querySelector(".typing")?.remove();
      box.insertAdjacentHTML("beforeend", `<div class="msg model">${renderChatText(res.text)}</div>`);
    } catch (err) {
      session.chat.pop();
      box.querySelector(".typing")?.remove();
      box.insertAdjacentHTML("beforeend", `<div class="msg model err">⚠ ${escapeHtml(err.message)}</div>`);
    }
    busy = false;
    box.scrollTop = box.scrollHeight;
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation(); // tránh phím tắt của trang
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === "Escape") closeAll();
  });
  ta.addEventListener("keyup", (e) => e.stopPropagation());
}

// ---------------------------------------------------
// 5. Hành động: lưu / sao chép / báo sai
// ---------------------------------------------------
async function onSave() {
  if (!session) return;
  try {
    const res = await send({
      type: "AUS_SAVE",
      item: {
        url: location.href,
        pageTitle: document.title,
        selectedText: session.text,
        analysis: session.analysis,
        perspectives: session.perspectives,
        chat: session.chat,
      },
    });
    session.saved = true;
    session.id = res.id;
    const btn = $('[data-act="save"]');
    if (btn) btn.textContent = "✓ Đã lưu vào bộ sưu tập";
    toast("Đã lưu vào bộ sưu tập của bạn");
  } catch (err) {
    toast(err.message);
  }
}

function buildExportText() {
  const a = session.analysis, p = session.perspectives;
  const lines = [`ĐOẠN VĂN: “${session.text}”`, `Nguồn: ${location.href}`, ""];
  if (a) {
    lines.push(`Luận điểm: ${a.core_claim}`, `Đối lập nhận thức: ${a.opposition_percent}% · Phân cực ${a.polarization.score}% · Bong bóng lọc ${a.filter_bubble.score}% · Buồng vang ${a.echo_chamber.score}%`);
    a.biases.forEach((b) => lines.push(`- Thiên kiến: ${b.name} — ${b.explanation}`));
    lines.push("");
  }
  if (p) {
    if (p.rebuttal) lines.push(`PHẢN BIỆN: ${p.rebuttal}`, "");
    p.expert_perspectives.forEach((e) =>
      lines.push(`[${e.domain}] ${e.title}: ${e.content}${e.sources.length ? ` (Nguồn: ${e.sources.map((s) => s.name + (s.url ? " " + s.url : "")).join("; ")})` : ""}`));
  }
  return lines.join("\n");
}

async function onCopy() {
  try {
    await navigator.clipboard.writeText(buildExportText());
    toast("Đã sao chép");
    send({ type: "AUS_FEEDBACK", queryHash: session.queryHash, rating: "HELPFUL", domain: location.hostname }).catch(() => {});
  } catch {
    toast("Không thể sao chép trên trang này");
  }
}

function onReport() {
  send({ type: "AUS_FEEDBACK", queryHash: session?.queryHash, rating: "BIASED", domain: location.hostname }).catch(() => {});
  toast("Cảm ơn phản hồi!");
}

function toast(msg) {
  layerEl.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  layerEl.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// ---------------------------------------------------
// 6. CSS — 3 màu: Forest Green #1F3D2B · Sand Beige #E8DCC4 · Electric Purple #8B5CF6
// ---------------------------------------------------
function getStyles() {
  return `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .layer {
    --green: #1F3D2B; --sand: #E8DCC4; --purple: #8B5CF6;
    --green-soft: rgba(31,61,43,.10); --green-line: rgba(31,61,43,.16); --green-mute: rgba(31,61,43,.62);
    position: fixed; inset: 0; pointer-events: none;
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: var(--green);
  }
  .layer > * { pointer-events: auto; }
  button { font-family: inherit; }
  .scrim { position: fixed; inset: 0; background: rgba(31,61,43,.55); backdrop-filter: blur(3px); animation: fade .25s ease; }
  @keyframes fade { from { opacity: 0 } to { opacity: 1 } }

  /* ---- Bong bóng ---- */
  .bubble-wrap {
    position: fixed; top: 50%; left: 50%; width: 340px; height: 340px; margin: -170px 0 0 -170px;
    display: flex; align-items: center; justify-content: center; cursor: grab; touch-action: none;
    animation: pop-in .6s cubic-bezier(.34,1.6,.5,1), float 5s ease-in-out .6s infinite;
  }
  .bubble-wrap:active { cursor: grabbing; }
  @keyframes pop-in { from { transform: scale(.2); opacity: 0 } to { transform: scale(1); opacity: 1 } }
  @keyframes float { 0%,100% { translate: 0 0 } 50% { translate: 0 -10px } }
  .bubble-skin {
    position: absolute; inset: 0; border-radius: 50%;
    background:
      radial-gradient(circle at 30% 25%, rgba(255,255,255,.75) 0 7%, transparent 22%),
      radial-gradient(circle at 70% 78%, rgba(139,92,246,.45), transparent 55%),
      radial-gradient(circle at 50% 50%, rgba(232,220,196,.96) 55%, rgba(232,220,196,.78) 100%);
    border: 2px solid rgba(255,255,255,.55);
    box-shadow: inset 0 0 40px rgba(139,92,246,.35), inset -12px -16px 40px rgba(139,92,246,.30),
                0 20px 60px rgba(0,0,0,.35), 0 0 0 6px rgba(139,92,246,.18);
    will-change: transform;
  }
  .shine { position: absolute; top: 12%; left: 18%; width: 22%; height: 11%; border-radius: 50%; background: rgba(255,255,255,.7); transform: rotate(-35deg); filter: blur(1px); }
  .shine2 { position: absolute; bottom: 14%; right: 16%; width: 9%; height: 5%; border-radius: 50%; background: rgba(255,255,255,.45); transform: rotate(-35deg); }
  .bubble-content { position: relative; text-align: center; padding: 0 44px; pointer-events: none; }
  .bubble-content > * { pointer-events: auto; }
  .bubble-content h2 { margin: 8px 0 8px; font-size: 21px; line-height: 1.25; font-weight: 800; color: var(--green); pointer-events: none; }
  .bubble-content p { margin: 0 0 14px; font-size: 11.5px; color: var(--green-mute); pointer-events: none; }
  .bubble-content img { pointer-events: none; }
  .btn-row { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .bubble-wrap.burst .bubble-skin { animation: burst .38s ease-out forwards; }
  .bubble-wrap.burst .bubble-content { animation: fade-out .2s ease forwards; }
  @keyframes burst { 0% { opacity: 1 } 60% { transform: scale(1.35); opacity: .8 } 100% { transform: scale(1.7); opacity: 0 } }
  @keyframes fade-out { to { opacity: 0 } }
  .drop {
    position: fixed; border-radius: 50%; margin: -6px 0 0 -6px; pointer-events: none;
    background: radial-gradient(circle at 30% 30%, #fff 0 15%, var(--purple) 70%);
    border: 1px solid rgba(255,255,255,.6); animation: fly .75s cubic-bezier(.15,.8,.3,1) forwards;
  }
  @keyframes fly { to { transform: translate(var(--dx), var(--dy)) scale(.2); opacity: 0 } }

  /* ---- Nút ---- */
  .btn { border: 1.5px solid var(--green); background: transparent; color: var(--green); border-radius: 999px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; transition: transform .15s, background .15s; }
  .btn:hover { transform: translateY(-1px); background: var(--green-soft); }
  .btn.primary { background: var(--purple); border-color: var(--purple); color: #fff; }
  .btn.primary:hover { background: #7c4de8; }
  .btn.ghost { border-color: var(--green-line); }
  .btn.small { padding: 6px 10px; font-size: 11px; font-weight: 600; }
  .btn.wide { width: 100%; padding: 12px; }

  /* ---- Dashboard ---- */
  .dash {
    position: fixed; top: 50%; left: 50%; width: min(480px, calc(100vw - 24px)); max-height: min(86vh, 760px);
    transform: translate(-50%, -50%); display: flex; flex-direction: column;
    background: var(--sand); border-radius: 22px; box-shadow: 0 30px 80px rgba(0,0,0,.45); overflow: hidden;
    animation: dash-in .45s cubic-bezier(.34,1.4,.5,1);
  }
  @keyframes dash-in { from { opacity: 0; transform: translate(-50%, -46%) scale(.85) } }
  .dash-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; background: var(--green); color: var(--sand); }
  .brand { display: flex; gap: 8px; align-items: center; font-weight: 800; font-size: 14px; }
  .head-actions { display: flex; gap: 6px; }
  .icon-btn { background: transparent; border: 1px solid rgba(232,220,196,.35); color: var(--sand); border-radius: 999px; padding: 5px 11px; font-size: 11.5px; cursor: pointer; }
  .icon-btn:hover { background: rgba(232,220,196,.15); }
  .tabs { display: flex; gap: 4px; padding: 10px 14px 0; border-bottom: 1px solid var(--green-line); }
  .tab { flex: 1; border: none; background: transparent; padding: 10px 4px; font-size: 12.5px; font-weight: 700; color: var(--green-mute); cursor: pointer; border-bottom: 3px solid transparent; }
  .tab.active { color: var(--green); border-bottom-color: var(--purple); }
  .dash-body { padding: 16px 18px; overflow-y: auto; flex: 1; scrollbar-width: thin; scrollbar-color: var(--green-line) transparent; }
  .dash-foot { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--green-line); flex-wrap: wrap; justify-content: center; }
  h3 { font-size: 11.5px; text-transform: uppercase; letter-spacing: .08em; margin: 18px 0 8px; color: var(--green-mute); }
  .muted { color: var(--green-mute); font-size: 12.5px; line-height: 1.5; }
  .small { font-size: 11px; }
  .demo { display: inline-block; font-size: 11px; font-style: italic; color: var(--purple); margin: 6px 0 0; }

  .hero { display: flex; gap: 14px; align-items: center; }
  .gauge { width: 132px; flex: none; }
  .g-track { fill: none; stroke: var(--green-soft); stroke-width: 12; }
  .g-val { fill: none; stroke: var(--purple); stroke-width: 12; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 65px 65px; transition: stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1); }
  .g-num { font-size: 30px; font-weight: 800; fill: var(--green); }
  .g-lbl { font-size: 9.5px; fill: var(--green-mute); }
  .chip { display: inline-block; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 999px; background: var(--green); color: var(--sand); }
  .chip.high { background: var(--purple); color: #fff; }
  .chip.low { background: transparent; border: 1.5px solid var(--green); color: var(--green); }
  .claim { margin: 8px 0 4px; font-size: 13px; font-style: italic; line-height: 1.45; }
  .sum { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--green-mute); }

  .meters { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px; margin-top: 18px; }
  .meter-top { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px; font-weight: 700; }
  .track { height: 8px; border-radius: 999px; background: var(--green-soft); overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; background: var(--purple); transition: width 1s cubic-bezier(.2,.8,.2,1); }
  .fill.alt { background: var(--green); }
  .meter small { display: block; margin-top: 4px; font-size: 10.5px; line-height: 1.35; color: var(--green-mute); }
  .objectivity { display: flex; gap: 10px; align-items: center; margin-top: 16px; font-size: 12px; font-weight: 700; }
  .objectivity .track { flex: 1; }
  .objectivity b { font-size: 11.5px; }

  .item { background: rgba(255,255,255,.45); border: 1px solid var(--green-line); border-radius: 14px; padding: 11px 13px; margin-bottom: 8px; }
  .item b { font-size: 13px; }
  .item p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; }
  .item small { display: block; margin-top: 4px; font-size: 11px; color: var(--green-mute); }
  .item.row { display: flex; gap: 10px; align-items: flex-start; }
  .item.row p { margin: 0; }
  .item.q { border-style: dashed; }
  .stance { flex: none; width: 24px; height: 24px; border-radius: 50%; background: var(--green); color: var(--sand); display: grid; place-items: center; font-size: 13px; font-weight: 800; }
  .domain { display: inline-block; font-size: 10.5px; font-weight: 800; background: var(--purple); color: #fff; border-radius: 999px; padding: 2px 9px; margin-bottom: 6px; }
  .domain + b { display: block; }
  .sources { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .sources a, .sources span { font-size: 11px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--green-line); color: var(--green); text-decoration: none; background: rgba(255,255,255,.5); }
  .sources a { border-color: var(--purple); color: var(--purple); font-weight: 700; }
  .sources a:hover { background: var(--purple); color: #fff; }
  .rebuttal { background: var(--green); color: var(--sand); border-radius: 16px; padding: 4px 16px 14px; }
  .rebuttal h3 { color: rgba(232,220,196,.7); }
  .rebuttal p { margin: 0; font-size: 13px; line-height: 1.55; }
  .cta { margin-top: 18px; }

  /* ---- Loading ---- */
  .loading { text-align: center; padding: 28px 10px; }
  .orb { width: 64px; height: 64px; margin: 0 auto 16px; border-radius: 50%; background: radial-gradient(circle at 30% 30%, #fff 0 10%, var(--purple) 65%); animation: breathe 1.4s ease-in-out infinite; }
  @keyframes breathe { 0%,100% { transform: scale(.85) } 50% { transform: scale(1.15) } }
  .loading-msg { font-weight: 700; margin: 0 0 6px; font-size: 13.5px; }
  .quote { margin: 0; font-size: 12px; font-style: italic; color: var(--green-mute); }
  .error { text-align: center; padding: 20px 6px; font-size: 13px; line-height: 1.5; }

  /* ---- Chat ---- */
  .chat { display: flex; flex-direction: column; height: 100%; min-height: 340px; }
  .msgs { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-bottom: 8px; max-height: 46vh; }
  .msg { max-width: 88%; padding: 9px 13px; border-radius: 16px; font-size: 12.5px; line-height: 1.5; }
  .msg p { margin: 0 0 6px; } .msg p:last-child { margin: 0; }
  .msg ul { margin: 4px 0; padding-left: 18px; }
  .msg.model { background: #fff; border: 1px solid var(--green-line); border-bottom-left-radius: 4px; align-self: flex-start; }
  .msg.user { background: var(--purple); color: #fff; border-bottom-right-radius: 4px; align-self: flex-end; }
  .msg.err { color: var(--purple); }
  .typing { display: flex; gap: 4px; padding: 12px 14px; }
  .typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--green-mute); animation: dot 1s infinite; }
  .typing span:nth-child(2) { animation-delay: .15s } .typing span:nth-child(3) { animation-delay: .3s }
  @keyframes dot { 0%,60%,100% { opacity: .25; transform: none } 30% { opacity: 1; transform: translateY(-3px) } }
  .chat-form { display: flex; gap: 8px; align-items: flex-end; margin-top: 8px; }
  .chat-form textarea { flex: 1; resize: none; border: 1.5px solid var(--green-line); border-radius: 14px; padding: 9px 12px; font: inherit; font-size: 12.5px; background: #fff; color: var(--green); outline: none; }
  .chat-form textarea:focus { border-color: var(--purple); }

  .toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); background: var(--green); color: var(--sand); padding: 10px 18px; border-radius: 999px; font-size: 12.5px; box-shadow: 0 8px 24px rgba(0,0,0,.3); animation: fade .2s; }

  @media (max-width: 520px) { .hero { flex-direction: column; text-align: center; } .meters { grid-template-columns: 1fr; } .bubble-wrap { width: 300px; height: 300px; margin: -150px 0 0 -150px; } .bubble-content { padding: 0 34px; } }
  @media (prefers-reduced-motion: reduce) { * { animation-duration: .01s !important; transition-duration: .01s !important; } }
  `;
}
