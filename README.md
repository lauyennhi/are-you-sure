# Are You Sure (AUS) — Chrome Extension

Bôi đen một đoạn văn khi lướt Facebook/báo mạng → bong bóng hiện giữa màn hình hỏi
**"Bạn có muốn xem góc nhìn khác không?"** → dashboard phân tích → góc nhìn khác có nguồn → phản biện cùng AI → lưu vào bộ sưu tập.

Giao diện trắng/đen tối giản, **xanh / vàng / đỏ** chỉ dùng cho số liệu (tốt / trung bình / xấu). Có chế độ **sáng / tối / tự động** (đổi ngay trong dashboard hoặc popup). Font Inter đóng gói sẵn (hỗ trợ tiếng Việt).

## Cài đặt
1. Mở `chrome://extensions`, bật **Developer mode**
2. **Load unpacked** → chọn thư mục này (chứa `manifest.json`)
3. (Tuỳ chọn) Bấm icon extension → dán Gemini API key (https://aistudio.google.com/apikey). Không có key → chạy **chế độ demo** với dữ liệu mẫu suy ra từ chính đoạn văn.

## Luồng sử dụng
1. Bôi đen 12–500 từ → bong bóng xuất hiện giữa màn hình.
   - **Giữ & kéo** để kéo giãn (thả ra bong bóng bật lại như lò xo)
   - **Chạm vào bong bóng** hoặc "Xem góc nhìn khác" → bong bóng vỡ → dashboard
   - **Bỏ qua** / Esc / click nền → biến mất
2. **Phân tích**: % đối lập nhận thức, phân cực, bong bóng lọc, buồng vang, cảm xúc hoá, độ khách quan, thiên kiến & ngụy biện.
3. **Góc nhìn khác**: tổng hợp bình luận thật trên trang, góc nhìn pháp luật / tâm lý / triết / xã hội học... kèm nguồn (có Google Search grounding khi dùng API key), đoạn phản biện, góc nhìn mới, câu hỏi tự vấn.
4. **Phản biện cùng AI**: chat nhiều lượt kiểu Socratic.
5. **Lưu vào bộ sưu tập** (xem/tìm/ghi chú/xuất JSON ở trang Bộ sưu tập), sao chép, báo sai, tắt ở trang hiện tại.

## Cấu trúc
```
manifest.json
background/background.js   # Gemini, prompt, cache, PII stripping, lưu trữ
content/content.js         # bong bóng, dashboard, chat (Shadow DOM)
fonts/                     # Inter (OFL) cho tiếng Việt
popup/                     # cài đặt: bật/tắt, API key, model, site đã tắt
collection/                # trang Bộ sưu tập
```

## Lưu ý
- API key lưu ở `chrome.storage.sync` (phía client) — chỉ phù hợp bản demo/cá nhân. Bản production nên đặt qua proxy/Worker.
- Điểm % là ước lượng của AI (hoặc heuristic ở chế độ demo), không phải số đo khoa học. Nguồn do AI trả về cần được người dùng tự kiểm chứng.
- Thu thập bình luận dựa trên cấu trúc DOM (Facebook `role="article"`, class/id chứa "comment"); Facebook đổi giao diện có thể làm giảm độ chính xác.
