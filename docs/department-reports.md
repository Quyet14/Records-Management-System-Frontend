# Báo cáo khoa trên frontend

Hai trang `pages/dept-head/stats.html` và `pages/dept-head/monitor.html` dùng `assets/js/department-reports.js`.
Backend xác định vai trò/khoa hiện tại qua phiên đăng nhập và giới hạn dữ liệu trước khi tổng hợp hoặc phân trang. Frontend không gửi `departmentId` để chọn phạm vi.

## API đang sử dụng

| Trang | API GET |
| --- | --- |
| Thống kê | `/stats/overview`, `/stats/by-document-type`, `/stats/by-year?year=...` |
| Giám sát | `/stats/overview`, `/system/missing-checksums?page=...&limit=20`, `/retention/pending-review?page=...&limit=20`, `/retention/review-summary`, `/retention/expiring?days=365`, `/system/audit-logs?page=...&limit=20&action=...` |

Tổng quan, dung lượng đã lưu kho và phân bố dùng toàn bộ thời gian. Biểu đồ theo tháng và bảng chi tiết nhận bộ lọc năm (1900–9999). Tổng hồ sơ và số liệu theo tháng loại trừ hồ sơ đã hủy theo backend; phân bố trạng thái có thể có riêng dòng đã hủy. Trang thống kê hiển thị biểu đồ trạng thái, loại hồ sơ, số hồ sơ và dung lượng theo tháng; bảng số liệu chi tiết có thể mở bên dưới biểu đồ.

Giám sát có phân trang độc lập cho thiếu checksum, chờ chỉnh lý và nhật ký. Bộ lọc nhật ký dùng chính xác `approve`, `reject`, `auto-approve (private)`; thay bộ lọc sẽ quay về trang 1. Hiển thị ngày hết hạn do backend trả trong `expiresAt`, không tự tính lại. API sắp hết hạn chỉ trả hồ sơ còn hạn, không phải danh sách đã hết hạn.

Không gọi `/documents/search`, API tình trạng máy chủ, quét checksum, backup hoặc restore. Không thay báo cáo lỗi bằng số 0 hoặc dữ liệu từ nguồn khác. HTTP 403 xóa số liệu cũ và hiển thị lỗi quyền/khoa; các lỗi khác cho phép tải lại. Phản hồi cũ hoặc phản hồi khi khoa tài khoản đã thay đổi không được dựng lại báo cáo.

Báo cáo được giữ nguyên khi phiên đăng nhập được làm mới mà khoa không đổi. Chỉ xóa dữ liệu khi phiên kết thúc hoặc tài khoản đổi/mất phạm vi khoa; đổi khoa sẽ tự tải báo cáo trong phạm vi mới. Dữ liệu không được lưu vĩnh viễn trong trình duyệt để tránh giữ lại thông tin sau khi đăng xuất.

## Kiểm thử và đồng bộ

Chạy `npm test`. Kiểm thử dùng DOM và API giả lập khớp hợp đồng backend, chưa thay thế nghiệm thu với tài khoản trên server.

Đồng bộ hai trang HTML, `assets/js/department-reports.js`, `assets/css/department-reports.css` và `assets/js/sidebar.js` vào đúng thư mục frontend đang được phục vụ. HTML hiện tham chiếu script báo cáo `v=4` và Chart.js 4.4.0 cho biểu đồ thống kê.

Gói `artifacts/department-reports-update.zip` chứa đủ năm tệp để đồng bộ. Phải triển khai backend có các API báo cáo mới trước khi nghiệm thu. Thử với Trưởng khoa của hai khoa và tài khoản chưa có khoa; kiểm tra lọc năm, phân trang và nhật ký từ chối.
