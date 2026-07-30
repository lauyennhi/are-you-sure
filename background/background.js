// =====================================================
// AUS — Background Service Worker
// Vai trò tương đương "Cloudflare Worker (Edge Middleware)" trong SRS,
// chạy nội bộ trong extension cho bản demo/MVP này.
// =====================================================

const GEMINI_MODEL = "gemini-2.5-flash"; // kiểm tra tên model mới nhất tại Google AI Studio
const CACHE_TTL_NEWS_SEC = 86400;   // 24h — tin thời sự
const CACHE_TTL_DEFAULT_SEC = 604800; // 7 ngày — kiến thức chung

// ---- Whitelist nguồn tin uy tín (rút gọn cho demo) ----
const WHITELIST_SOURCES = [
  "Reuters", "AP News", "BBC", "VnExpress", "Tuổi Trẻ", "Thanh Niên",
  "Chính phủ điện tử (chinhphu.vn)", "Tổng cục Thống kê (gso.gov.vn)",
];

// =====================================================
// 1. PII Stripping (FR-S-001)
// =====================================================
function stripPII(text) {
  return text
    .replace(/(\+?84|0)(3|5|7|8|9)\d{8}/g, "[đã ẩn số điện thoại]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[đã ẩn email]")
    .replace(/\b\d{9}(\d{3})?\b/g, "[đã ẩn CCCD]");
}

// =====================================================
// 2. SHA-256 Hash cho Semantic Cache (FR-G-004)
// =====================================================
async function sha256(text) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getFromCache(hash) {
  const key = `cache_${hash}`;
  const store = await chrome.storage.local.get(key);
  const entry = store[key];
  if (!entry) return null;
  const ageSec = (Date.now() - entry.createdAt) / 1000;
  if (ageSec > entry.ttl) {
    chrome.storage.local.remove(key);
    return null;
  }
  return entry.response;
}

async function saveToCache(hash, response, ttlSec) {
  const key = `cache_${hash}`;
  await chrome.storage.local.set({
    [key]: { response, createdAt: Date.now(), ttl: ttlSec },
  });
}

// =====================================================
// 3. Prompt Engineering (mục 4.2 SRS)
// =====================================================
function buildSystemPrompt() {
  return `Bạn là một trợ lý phản biện khách quan cho công cụ "Are You Sure".
Nhiệm vụ: đọc đoạn văn bản người dùng bôi đen, xác định luận điểm chính,
phát hiện ngụy biện logic (nếu có), và đưa ra 2 góc nhìn đối lập/bổ sung
có căn cứ khoa học/logic/kinh tế.

QUY TẮC BẮT BUỘC:
1. CHỈ trả về đúng 1 JSON object hợp lệ, KHÔNG kèm markdown, KHÔNG giải thích thêm.
2. Mỗi "perspective" và "reasoning" không quá 40 từ / 2.5 dòng.
3. Ưu tiên tham chiếu các nguồn uy tín sau nếu phù hợp: ${WHITELIST_SOURCES.join(", ")}.
4. Không tự bịa số liệu/sự kiện không có căn cứ. Nếu không chắc chắn, hãy nêu rõ "chưa có đủ dữ liệu kiểm chứng".
5. Giữ văn phong tiếng Việt tự nhiên, hiểu đúng ngữ cảnh teencode/slang nếu có.

Định dạng JSON đầu ra:
{
  "core_claim": "string",
  "fallacy_detected": "string hoặc null",
  "counter_perspectives": [
    { "perspective": "string", "reasoning": "string" },
    { "perspective": "string", "reasoning": "string" }
  ],
  "objectivity_score": number (1.0 đến 5.0)
}`;
}

// =====================================================
// 4. Gọi Gemini API
// =====================================================
async function callGemini(apiKey, selectedText, contextText, url) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: { parts: [{ text: buildSystemPrompt() }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `URL nguồn: ${url}\n\nNgữ cảnh xung quanh: ${contextText}\n\nĐoạn văn bản cần phân tích: "${selectedText}"`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API lỗi ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return JSON.parse(rawText);
}

// =====================================================
// 5. Chế độ Demo/Mock (khi chưa cấu hình API Key)
// =====================================================
function mockResponse(selectedText) {
  return {
    core_claim: "Đoạn văn bản đưa ra một kết luận chắc chắn nhưng chưa nêu rõ căn cứ số liệu.",
    fallacy_detected: "Hasty Generalization (Khái quát hóa vội vàng)",
    counter_perspectives: [
      {
        perspective: "Nhiều trường hợp tương tự trong quá khứ không dẫn đến kết quả như đoạn văn khẳng định.",
        reasoning: "Cần đối chiếu dữ liệu lịch sử/thống kê trước khi kết luận tuyệt đối.",
      },
      {
        perspective: "Có nhiều biến số tác động cùng lúc, không chỉ một nguyên nhân duy nhất.",
        reasoning: "Các vấn đề kinh tế-xã hội thường đa nhân quả, không nên quy về một yếu tố.",
      },
    ],
    objectivity_score: 3.0,
    _demo_mode: true,
  };
}

// =====================================================
// 6. Message Listener (giao tiếp với content script)
// =====================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "AUS_ANALYZE") return false;

  (async () => {
    try {
      const cleanText = stripPII(msg.selectedText);
      const cleanContext = stripPII(msg.contextText || "");
      const hash = await sha256(cleanText);

      const cached = await getFromCache(hash);
      if (cached) {
        sendResponse({ ok: true, data: cached, fromCache: true });
        return;
      }

      const { geminiApiKey } = await chrome.storage.sync.get("geminiApiKey");

      let result;
      if (geminiApiKey) {
        result = await callGemini(geminiApiKey, cleanText, cleanContext, msg.url);
      } else {
        result = mockResponse(cleanText);
      }

      const ttl = CACHE_TTL_DEFAULT_SEC;
      await saveToCache(hash, result, ttl);

      sendResponse({ ok: true, data: result, fromCache: false });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // giữ kênh async mở
});

// =====================================================
// 7. Feedback Logging (FR-G-005) — lưu local cho demo
// =====================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "AUS_FEEDBACK") return false;

  (async () => {
    const key = "feedback_logs";
    const store = await chrome.storage.local.get(key);
    const logs = store[key] || [];
    logs.push({
      log_id: crypto.randomUUID(),
      query_hash: msg.queryHash,
      user_rating: msg.rating, // HELPFUL | BIASED | IRRELEVANT
      platform_domain: msg.domain,
      created_at: new Date().toISOString(),
    });
    await chrome.storage.local.set({ [key]: logs });
    sendResponse({ ok: true });
  })();

  return true;
});
