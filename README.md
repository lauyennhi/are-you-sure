# Are You Sure (AUS) — Chrome Extension MVP

Bản MVP thật, chạy được trên Chrome/Edge. Dùng vanilla JS + Shadow DOM cho gọn nhẹ
(bản production theo SRS sẽ nâng cấp lên React + TypeScript + Tailwind + CRXJS).

## 1. Cài đặt (Load Unpacked)

1. Mở Chrome → gõ địa chỉ: `chrome://extensions`
2. Bật **Developer mode** (góc trên phải)
3. Bấm **Load unpacked** → chọn thư mục `aus-extension` (thư mục chứa file `manifest.json`)
4. Icon "?" sẽ xuất hiện trên thanh công cụ Chrome

## 2. Demo ngay không cần API Key

Extension chạy sẵn ở **Chế độ demo** — trả về dữ liệu mẫu để bạn thấy đầy đủ luồng
UI (FAB → Loading → Verdict Card) mà không cần cấu hình gì thêm.

**Cách demo:**
1. Vào bất kỳ trang báo/mạng xã hội nào (VnExpress, Facebook...)
2. Bôi đen một đoạn văn bản từ 15-500 từ
3. Icon FAB nhỏ (24px) sẽ hiện ở góc dưới-phải đoạn bôi đen sau ~200ms
4. Bấm vào FAB → xem Loading → xem Verdict Card với 2 tab góc nhìn

## 3. Dùng Gemini API thật (không bắt buộc)

1. Lấy API key miễn phí tại: https://aistudio.google.com/apikey
2. Bấm icon extension trên thanh công cụ → dán API key → **Lưu cấu hình**
3. Từ lần bôi đen tiếp theo, hệ thống sẽ gọi Gemini API thật thay vì dữ liệu mẫu

> Lưu ý bảo mật: đây là bản demo nên API key được lưu tại `chrome.storage.sync`
> (phía client). Trong bản production thật theo đúng SRS, API key phải được giấu
> ở Cloudflare Worker (Edge Middleware) — KHÔNG BAO GIỜ lưu key ở phía client
> như bản demo này (đúng như rủi ro FR-S-003 đã ghi trong BRD).

## 4. Cấu trúc thư mục

```
aus-extension/
├── manifest.json          # Manifest V3
├── background/
│   └── background.js      # Gọi Gemini API, PII stripping, Semantic Cache
├── content/
│   └── content.js         # Detect highlight, hiển thị FAB + Verdict Card (Shadow DOM)
├── popup/
│   ├── popup.html         # Cài đặt API key
│   └── popup.js
└── icons/                 # Icon "?" đã thiết kế (16/24/32/48/128px)
```

## 5. Những gì ĐÃ làm đúng theo SRS

- ✅ FR-G-001: chỉ hiện FAB khi bôi đen 15-500 từ, delay 200ms
- ✅ FR-G-002: gọi LLM với temperature 0.3, JSON Schema bắt buộc
- ✅ FR-G-003: UI cách ly hoàn toàn bằng Shadow DOM
- ✅ FR-G-004: Semantic Cache bằng SHA-256 hash (dùng `chrome.storage.local` thay Redis cho bản demo)
- ✅ FR-G-005: nút feedback ghi log (dùng `chrome.storage.local` thay Supabase cho bản demo)
- ✅ FR-S-001: PII Stripping bằng regex trước khi gửi đi

## 6. Những gì CHƯA làm (đúng như đã ghi trong Out-of-scope / giới hạn demo)

- ❌ Chưa có Cloudflare Worker thật — API key demo đang lưu phía client (chỉ chấp nhận được cho demo, KHÔNG dùng cho production)
- ❌ Chưa có Regex/NLP threshold filter để chặn văn bản "vô hại" trước khi gọi API (Unit Economics optimization)
- ❌ Chưa tích hợp React/TypeScript/Tailwind như tech stack chính thức
- ❌ Chưa có B2B Rule Engine, Dashboard báo cáo

## 7. Gợi ý demo khi phỏng vấn

1. Mở 1 trang tin tức, bôi đen 1 đoạn có tính tranh cãi → cho thấy FAB xuất hiện tinh tế, không phiền
2. Bấm FAB → chỉ ra Loading state có trích dẫn tư duy phản biện
3. Chỉ ra Verdict Card có 2 tab, giải thích lý do chọn tab thay vì 2 cột (Scannability)
4. Mở tab Console (F12) → gõ `chrome.storage.local.get(null, console.log)` để cho thấy cache/feedback log đang hoạt động thật
5. Nếu có API key thật, so sánh trực tiếp kết quả demo vs kết quả AI thật
