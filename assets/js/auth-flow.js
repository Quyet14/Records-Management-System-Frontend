/* Shared authentication flow helpers. */
function authRedirect(res) {
  const payload = authPayload(res);
  const token = payload?.access_token || payload?.token || res?.access_token || res?.token;
  const user = payload?.user || res?.user;
  if (!token || !user) throw new Error('Backend không trả về thông tin đăng nhập đầy đủ');
  Auth.setSession(token, user, payload.expires_in);
  const role = user.role;
  window.location.href = role === 'admin' ? 'admin/dashboard.html'
    : role === 'department_head' ? 'dept-head/dashboard.html' : 'dashboard.html';
}

function authErrorMessage(error, fallback = 'Có lỗi xảy ra, vui lòng thử lại.') {
  return error?.message || fallback;
}

function authPayload(res) {
  let payload = res;
  while (payload?.data || payload?.result) payload = payload.data || payload.result;
  return payload;
}

function requiresPasswordChange(res) {
  const payload = authPayload(res);
  const user = payload?.user || res?.user;
  return payload?.must_change_password === true || payload?.must_change_password === 1
    || payload?.mustChangePassword === true || payload?.mustChangePassword === 1
    || user?.must_change_password === true || user?.must_change_password === 1
    || user?.mustChangePassword === true || user?.mustChangePassword === 1
    || payload?.is_first_login === true || payload?.is_first_login === 1
    || payload?.isFirstLogin === true || payload?.isFirstLogin === 1
    || user?.is_first_login === true || user?.is_first_login === 1
    || user?.isFirstLogin === true || user?.isFirstLogin === 1
    || payload?.password_changed === false || user?.password_changed === false;
}

async function authRouteAfterStep(res, userId, emailHint = '') {
  const payload = authPayload(res);
  if (payload?.access_token && payload?.user) {
    authRedirect(res);
    return true;
  }
  if (payload?.requires_totp === true) {
    window.location.href = `verify-code.html?type=totp&user_id=${encodeURIComponent(payload.user_id || userId || '')}`;
    return true;
  }
  if (payload?.requires_otp === true) {
    const hint = payload.email_hint || emailHint || '';
    window.location.href = `verify-code.html?type=otp&user_id=${encodeURIComponent(payload.user_id || userId || '')}&email_hint=${encodeURIComponent(hint)}`;
    return true;
  }
  if (payload?.requires_email_confirmation === true && payload.pending_login_id) {
    const completed = await api.post('/auth/complete-login', { pending_login_id: payload.pending_login_id });
    authRedirect(completed);
    return true;
  }
  authRedirect(res);
  return true;
}
