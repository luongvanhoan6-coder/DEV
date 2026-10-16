# Hướng dẫn cấu hình giọng đọc (TTS)

Hệ thống **không giả định** máy tính có sẵn giọng đọc tiếng Việt và **không bao giờ tạo âm thanh giả**.
Khi chưa cấu hình, mỗi video vẫn có `voice_script.txt` + phụ đề SRT, nhưng video sẽ **không được duyệt**
(trừ khi bạn chủ động dùng `--allow-no-voice`).

Chọn nhà cung cấp (`none`, `manual`, `gemini`, `google_cloud`, `edge_tts`) trong `config/settings.yaml` → `voice.provider`, rồi kiểm tra bằng:

```bash
python main.py voice test                 # đọc thử 1 câu, tạo output/voice_test/voice.mp3
python main.py voice test --provider edge_tts
```

Nghe thử tệp tạo ra trước khi sản xuất hàng loạt.

## So sánh nhanh

| Lựa chọn | Chi phí | Chất lượng tiếng Việt | Ổn định / pháp lý | Cài đặt |
|---|---|---|---|---|
| `manual` – tự thu âm | 0 đ | Tốt nhất nếu giọng bạn phù hợp | Ổn định, bạn sở hữu giọng | Micro + phòng yên tĩnh |
| `google_cloud` – Google Cloud TTS | Có hạn mức miễn phí hằng tháng, vượt thì tính phí | Tốt (giọng Neural2/WaveNet `vi-VN`) | API chính thức | Cần tài khoản Google Cloud có thanh toán |
| `gemini` – Gemini API (Google AI Studio) | Có hạn mức miễn phí (giới hạn lượt/phút, lượt/ngày); vượt thì tính phí theo bảng giá Gemini API | Tự nhiên, điều khiển phong cách bằng lời mô tả | API chính thức | Chỉ cần tài khoản Google + API key |
| `edge_tts` – Microsoft Edge Read-Aloud | 0 đ | Tốt (`vi-VN-NamMinhNeural`, `vi-VN-HoaiMyNeural`) | **Không chính thức** – có thể ngừng bất cứ lúc nào; tự đánh giá điều khoản sử dụng trước khi dùng thương mại | `pip install edge-tts` |
| `none` | 0 đ | – | – | Mặc định |

Gợi ý giọng phù hợp phong cách kênh: trầm ấm, chậm vừa (tốc độ 0.85–0.9 hoặc `-10%` đến `-15%`).

## 1. Tự thu âm (`manual`)

1. Đặt `voice.provider: manual`.
2. Chạy `python main.py content generate --count 5` để tạo lời đọc.
3. Mở `output/drafts/<run_id>/<video_id>/voice_script.txt`, thu âm đúng lời đọc, lưu thành
   `voice.mp3` (hoặc `voice.wav`, `voice.m4a`) **trong cùng thư mục đó**.
4. Chạy `python main.py daily --resume <run_id>` – hệ thống tự căn phụ đề theo độ dài bản thu.

Mẹo: đọc chậm, nghỉ ~0,5 giây sau mỗi câu, tổng 15–25 giây.

## 2. Google Cloud Text-to-Speech (`google_cloud`)

1. Vào https://console.cloud.google.com → tạo dự án → bật **Cloud Text-to-Speech API**.
2. Liên kết tài khoản thanh toán (bắt buộc dù dùng trong hạn mức miễn phí).
3. **APIs & Services → Credentials → Create credentials → API key**. Nên giới hạn key chỉ cho Text-to-Speech API.
4. Ghi vào tệp `.env`: `GOOGLE_TTS_API_KEY=...` (không ghi vào settings.yaml, không commit).
5. Đặt `voice.provider: google_cloud`; chỉnh `voice.google_cloud.voice_name` (ví dụ `vi-VN-Neural2-D` giọng nam,
   `vi-VN-Neural2-A` giọng nữ – kiểm tra danh sách giọng hiện có trong tài liệu Google).
6. `python main.py voice test` → nghe thử.
7. `python main.py cost` để xem ước tính số ký tự/tháng so với hạn mức miễn phí.

## 3. Gemini API (`gemini`) – khuyến nghị nếu bạn đã dùng Gemini

Lưu ý: ứng dụng chat Gemini (gemini.google.com) **không** cho phần mềm gọi vào. Hệ thống dùng **Gemini API** qua
Google AI Studio – cùng tài khoản Google, miễn phí trong hạn mức.

1. Mở https://aistudio.google.com/apikey → đăng nhập tài khoản Google → **Create API key**.
2. Mở tệp `.env` trong thư mục dự án, điền: `GEMINI_API_KEY=khóa_của_bạn`
   (không dán khóa vào chat, không ghi vào settings.yaml, không commit).
3. Trong `config/settings.yaml` đặt `voice.provider: gemini`.
4. `python main.py voice test` → nghe `output/voice_test/voice.wav`.
5. Chỉnh giọng trong `voice.gemini`:
   - `voice_name`: `Charon` (nam, trầm, rõ – mặc định), thử thêm `Gacrux`, `Algenib`, `Iapetus`; giọng nữ `Kore`, `Sulafat`.
   - `style_prompt`: mô tả cách đọc (mặc định: trầm ấm, điềm đạm, chậm rãi).
   - `tempo`: 0.9 để chậm hơn, 1.1 để nhanh hơn.
6. Tạo video: `python main.py daily` (hoặc làm lại giọng cho lô cũ: `python main.py daily --resume <RUN_ID> --force`).

Lưu ý khi dùng Gemini TTS:
- Mô hình TTS đang ở dạng *preview*; nếu Google đổi tên, cập nhật `voice.gemini.model`.
- Hạn mức miễn phí giới hạn số lượt mỗi phút/ngày: hệ thống tự thử lại khi gặp lỗi 429. Nếu vẫn lỗi, chạy tiếp sau
  bằng `--resume`.
- Hệ thống tự kiểm tra độ dài âm thanh: nếu dài/ngắn bất thường (ví dụ mô hình đọc cả lời hướng dẫn phong cách),
  tệp bị loại và báo lỗi thay vì đưa vào video. **Vẫn phải nghe lại từng video trước khi duyệt** – mô hình có thể
  đọc sai thanh điệu hoặc từ Hán Việt.
- Ở gói miễn phí, Google có thể dùng dữ liệu gửi lên để cải thiện sản phẩm (xem điều khoản Gemini API). Nội dung kênh
  là câu nói công khai nên rủi ro thấp, nhưng không gửi thông tin cá nhân.
- Video dùng giọng tổng hợp: khai báo "nội dung AI/tổng hợp" khi đăng theo quy định của từng nền tảng.

## 4. Edge TTS (`edge_tts`)

1. `pip install edge-tts`
2. Đặt `voice.provider: edge_tts`; chỉnh `voice.edge_tts.voice`, `rate`, `pitch`.
3. `python main.py voice test`.
4. Edge TTS trả về mốc thời gian từng câu → phụ đề được căn theo mốc thật (đồng bộ tốt hơn).

> Lưu ý: đây là dịch vụ đọc văn bản của trình duyệt Edge, không phải API thương mại có cam kết.
> Nếu dịch vụ lỗi, hệ thống ghi lỗi vào báo cáo và **không** đánh dấu video là hoàn chỉnh.

## Thêm nhà cung cấp khác (FPT.AI, Viettel AI, ElevenLabs…)

Tạo lớp mới trong `src/voice_generator.py` kế thừa `VoiceProvider`, cài đặt `is_configured()` và
`synthesize(text, out_dir) -> VoiceResult`, rồi thêm vào `PROVIDERS`. Đọc API key từ biến môi trường.
