/* Shared display guards. The backend must enforce every rule independently. */
(function (root) {
  'use strict';
  const labels = Object.freeze({
    draft: 'Nháp', pending: 'Chờ duyệt', partially_approved: 'Chờ duyệt bổ sung',
    scheduled: 'Đã duyệt — chờ hủy', processing: 'Đang hủy', destroyed: 'Đã hủy — chờ biên bản',
    completed: 'Đã hoàn tất', rejected: 'Từ chối', withdrawn: 'Đã thu hồi', failed: 'Hủy lỗi — cần xử lý'
  });
  function eligible(doc, now) {
    const expiry = Date.parse(doc.retentionUntil);
    return doc.eligible === true && doc.legalHold === false && Number.isFinite(expiry)
      && expiry <= now && ['approved', 'stored'].includes(doc.status) && !doc.activeDestructionRequestId;
  }
  const identity = value => String(typeof value === 'object' ? value?.id || value?._id || '' : value || '');
  function canViewRequest(request, user) {
    if (['admin', 'department_head'].includes(user?.role)) return true;
    const userId = identity(user?.id || user?._id || user?.userId);
    return user?.role === 'user' && !!userId && identity(request?.createdBy) === userId;
  }
  function proposalBlockReason(doc, user) {
    if (user?.role === 'user') {
      const userId = identity(user.id || user._id || user.userId);
      const departmentId = identity(user.departmentId || user.department);
      if (!userId || identity(doc.uploaderId || doc.uploader) !== userId)
        return 'Chỉ được gửi yêu cầu hủy hồ sơ do mình tải lên.';
      if (!departmentId || identity(doc.departmentId || doc.department) !== departmentId)
        return 'Chỉ được gửi yêu cầu hủy hồ sơ thuộc khoa mình.';
    }
    if (!doc.id) return 'Hồ sơ thiếu mã định danh.';
    if (doc.legalHold === true) return 'Hồ sơ đang bị giữ lại.';
    if (doc.activeDestructionRequestId) return 'Hồ sơ đã thuộc đề nghị hủy đang xử lý.';
    if (!['approved', 'stored'].includes(doc.status)) return 'Chỉ chọn hồ sơ đã duyệt hoặc đã lưu kho.';
    return '';
  }
  function approvalBlockReason(request, user) {
    if (!request || !user) return 'Chưa có đủ thông tin đề nghị hoặc tài khoản để xác định quyền duyệt.';
    if (!['admin', 'department_head'].includes(user.role)) return 'Chỉ Admin hoặc Trưởng khoa được duyệt đề nghị hủy trong phạm vi được cấp quyền.';
    const userId = String(user.id || user._id || user.userId || '');
    const creatorId = String(request.createdBy?.id || '');
    if (!userId || !creatorId || !Number.isInteger(request.version)) return 'Thông tin tài khoản hoặc đề nghị chưa đầy đủ. Hãy tải lại chi tiết.';
    // The server grants approve only after checking ownership, department and sensitivity.
    const mayApproveOwnUpload = user.role === 'department_head' && request.requiredApprovals === 1;
    if (userId === creatorId && !mayApproveOwnUpload) return 'Bạn là người lập đề nghị này. Chỉ Trưởng khoa được tự duyệt hồ sơ thường do mình tải lên, thuộc khoa mình và được hệ thống cấp quyền. Các trường hợp khác cần người duyệt khác.';
    if (request.approvals?.some(approval => String(approval.userId) === userId)) return request.requiredApprovals > 1
      ? 'Bạn đã duyệt đề nghị này. Hồ sơ mật cần đủ Trưởng khoa của hồ sơ và Admin duyệt; hãy dùng tài khoản thuộc vai trò còn thiếu.'
      : 'Bạn đã duyệt đề nghị này.';
    if (!['pending', 'partially_approved'].includes(request.status)) return 'Đề nghị không còn ở trạng thái chờ duyệt.';
    if (!Array.isArray(request.allowedActions) || !request.allowedActions.includes('approve')) return user.role === 'department_head'
      ? 'Hệ thống chưa cấp quyền duyệt đề nghị này cho tài khoản của bạn. Trưởng khoa chỉ được duyệt khi toàn bộ hồ sơ thuộc khoa mình và trong phạm vi được xem.'
      : 'Hệ thống chưa cấp quyền duyệt đề nghị này cho tài khoản Admin của bạn. Cần kiểm tra quyền duyệt và điều kiện của đề nghị.';
    return '';
  }
  function canAction(request, action, user, now) {
    if (!request || !user || !['admin', 'department_head', 'user'].includes(user.role)) return false;
    if (user.role === 'user' && (action !== 'withdraw' || !canViewRequest(request, user))) return false;
    if (!Array.isArray(request.allowedActions) || !request.allowedActions.includes(action)) return false;
    const userId = String(user.id || user._id || user.userId || '');
    const creatorId = String(request.createdBy?.id || '');
    if (!userId || !creatorId || !Number.isInteger(request.version)) return false;
    if (action === 'approve') {
      return !approvalBlockReason(request, user);
    }
    if (action === 'reject') return userId !== creatorId
      && ['pending', 'partially_approved'].includes(request.status);
    if (action === 'withdraw') return ['pending', 'partially_approved'].includes(request.status)
      || (request.status === 'scheduled' && Number.isFinite(Date.parse(request.executeAfter)) && Date.parse(request.executeAfter) > now);
    if (action === 'complete') return user.role === 'admin' && request.status === 'destroyed';
    return false;
  }
  const rules = Object.freeze({ labels, eligible, proposalBlockReason, approvalBlockReason, canAction, canViewRequest });
  if (typeof module !== 'undefined' && module.exports) module.exports = rules;
  else root.DestructionRules = rules;
})(typeof window !== 'undefined' ? window : globalThis);
