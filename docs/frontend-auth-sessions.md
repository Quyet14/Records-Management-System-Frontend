# Frontend: đăng nhập mật khẩu, OTP và phiên thiết bị

Frontend dùng hợp đồng backend `auth-device-sessions.md`:

- Email + mật khẩu + CAPTCHA để đăng nhập; backend có thể yêu cầu xác minh OTP sau khi mật khẩu hợp lệ. Liên kết quên mật khẩu dẫn tới quy trình đặt lại mật khẩu qua email.
- Access token và hồ sơ người dùng chỉ giữ trong bộ nhớ trang, thời hạn lấy từ `expires_in` (backend hiện 1.200 giây). Khóa token/user/navigation snapshot cũ được xóa khỏi localStorage và sessionStorage.
- Tải lại/chuyển trang khôi phục phiên qua POST `/auth/refresh` với `credentials: include`, dùng `/auth/refresh-token` nếu backend không có route đầu tiên. Cookie refresh HttpOnly do backend cấp khi xác thực OTP và quản lý; nếu backend không cấp cookie này, không thể duy trì phiên an toàn qua lần tải trang tiếp theo.
- Mỗi tab gộp refresh vào một promise. Các tab dùng cùng Web Lock; trình duyệt thiếu Web Locks dùng SharedWorker thực hiện request cookie theo hàng đợi. Không tự gửi request refresh thiếu cơ chế phối hợp.
- `Auth.fetch` chủ động refresh khi access token còn dưới một phút, hoặc refresh và thử lại một lần khi API trả 401. Body được clone trước khi gửi. Lỗi mạng/5xx không tự chuyển thành yêu cầu OTP. Các thao tác OTP không tự gửi lại khi lỗi.
- XHR tải file có tiến độ cũng kiểm tra hạn token và thử lại tối đa một lần sau 401. Fetch PDF, xuất dữ liệu và hủy hồ sơ dùng chung `Auth.fetch`.
- Đăng xuất gọi backend trước khi xóa state, thông báo các tab khác bằng BroadcastChannel không chứa token. Có `Auth.logoutAll()` cho luồng đăng xuất tất cả thiết bị; nút hiện tại chỉ đăng xuất thiết bị này.
- Thông báo SSE dùng fetch + Bearer, không dùng query access token. Tải file qua `/documents/:id/download-url` lấy token file-download riêng; liên kết trong file Excel dẫn về trang hồ sơ, không chứa access token.
- Các trang đợi `Auth.require*()` hoàn tất rồi mới đọc người dùng/quyền hoặc khởi tạo dữ liệu. Hàm thao tác dùng trong HTML vẫn được đưa ra window để giữ các nút hiện có.

## Triển khai

Đồng bộ toàn bộ `pages/` và `assets/js/`, đặc biệt file mới `device-session.js`, `auth-cookie-worker.js`, `login.js`. Không chỉ cập nhật app.js. Các query version hiện dùng `device-2` để trình duyệt lấy bản xác thực mới.

Production cần HTTPS cho cả trang và API, migration phiên backend và CORS origin chính xác với credentials. Giữ cookie Secure/HttpOnly và Cache-Control no-store. Backend phải cấu hình CORS cho origin frontend; không dùng `*` cùng credentials.

Trên HTTPS, app.js mặc định gọi API cùng origin (reverse proxy các route API đến backend, giữ các đường dẫn /auth, /users, /documents, v.v.). Nếu API dùng origin/port khác, đặt `meta name="lths-api-base" content="https://hostname:3002"` trong head các trang, hoặc cấu hình giá trị API chung trong app.js trước khi triển khai. Hỗ trợ cả base URL có tiền tố /api. Frontend và API cùng site phù hợp SameSite=Lax; kiểm tra chứng chỉ và cấu hình cookie thật trên server.

Trên HTTP để phát triển, mặc định vẫn gọi địa chỉ LAN đã có `http://192.168.0.67:3002`; backend cần chế độ development và cookie không Secure theo hướng dẫn backend. Đây không phải cấu hình production. Nếu trình duyệt không cung cấp Web Locks/SharedWorker trên origin HTTP, dùng localhost hoặc HTTPS.

## Kiểm tra

- `npm test`: bộ kiểm thử quy tắc hủy, tích hợp giao diện và device session với HTTP/worker giả lập.
- `npm run test:auth-browser`: Edge headless trên Windows, máy chủ HTTP cục bộ mô phỏng API/cookie và dữ liệu; không truy cập tài khoản thật. Có thể chỉ định executable bằng biến môi trường `EDGE_BIN`.
- Kiểm thử trình duyệt bao gồm email/mật khẩu/CAPTCHA/OTP, chuyển trang, refresh đồng thời hai tab, cookie HttpOnly, không lưu access token trong storage và đăng xuất các tab đang mở.
- Sau triển khai cần kiểm tra SMTP, MySQL, HTTPS/CORS và việc cookie Secure được gửi/nhận thật; các kiểm thử frontend không thay thế các bước đó.
