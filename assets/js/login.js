(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const inputs = [...document.querySelectorAll('.otp-input')];
  let captchaId = '', pendingId = '', pendingEmail = '', pendingPassword = '';
  const error = message => { $('login-error').textContent = message; $('login-error').style.display = message ? 'block' : 'none'; };
  const busy = (button, value) => { button.disabled = value; button.classList.toggle('loading', value); };
  $('email').addEventListener('input', () => error(''));
  $('btn-toggle-pw').addEventListener('click', () => {
    const password = $('password');
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    $('btn-toggle-pw').innerHTML = visible
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c6.4 0 10 7 10 7a16 16 0 01-4 4.8M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10.8 10.8 0 004.1-.8" /></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>';
    $('btn-toggle-pw').setAttribute('aria-label', visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    $('btn-toggle-pw').setAttribute('aria-pressed', String(visible));
  });
  async function loadCaptcha() {
    captchaId = '';
    const response = await api.get('/auth/captcha');
    const data = response.data ?? response;
    const image = data.image || data.svg;
    if (!data.captcha_id || !image) throw new Error('Không tải được mã xác nhận.');
    captchaId = data.captcha_id;
    $('captcha-image').src = image.startsWith('data:') ? image : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}`;
    $('captcha-input').value = '';
  }
  function showLogin() {
    $('login-form').style.display = 'block'; $('otp-panel').style.display = 'none';
    pendingId = ''; error('');
    return loadCaptcha();
  }
  function showOtp(data, email, password) {
    pendingId = data.user_id; pendingEmail = email; pendingPassword = password;
    $('login-form').style.display = 'none'; $('otp-panel').style.display = 'block';
    const info = document.querySelector('.otp-info');
    info.textContent = `Nhập mã OTP gửi đến ${data.email_hint || email}. Mã có hiệu lực ${Math.ceil((data.expires_in || 300) / 60)} phút.`;
    inputs.forEach(input => { input.value = ''; }); inputs[0].focus();
  }
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('login-btn'); if (button.disabled) return;
    busy(button, true); error('');
    try {
      const email = $('email').value.trim();
      const password = $('password').value;
      const captchaCode = $('captcha-input').value.trim();
      if (!captchaId || !captchaCode) throw new Error('Vui lòng nhập mã xác nhận.');
      const response = await api.post('/auth/login', { email, ...(password ? { password } : {}), captcha_id: captchaId, captcha_code: captchaCode });
      const data = authPayload(response);
      if (requiresPasswordChange(response)) {
        sessionStorage.setItem('lths_force_email', email.toLowerCase());
        await authRouteAfterStep(response, data.user_id || data.user?.id, email);
        return;
      }
      if (data.requires_otp === true) {
        if (!data.user_id) throw new Error('Phản hồi yêu cầu OTP không hợp lệ.');
        showOtp(data, email, password);
        return;
      }
      await authRouteAfterStep(response, data.user_id || data.user?.id, email);
    } catch (err) { error(err.message); await loadCaptcha().catch(() => {}); }
    finally { busy(button, false); }
  });
  async function verify() {
    const button = $('btn-verify-otp'); if (button.disabled) return;
    const otp = inputs.map(input => input.value).join('');
    if (!pendingId || !/^\d{6}$/.test(otp)) { error('Vui lòng nhập đủ 6 số OTP.'); return; }
    busy(button, true); error('');
    try {
      const response = await api.post('/auth/verify-otp', { user_id: pendingId, otp });
      const data = authPayload(response);
      const hasSession = (data?.access_token || data?.token || response?.access_token || response?.token)
        && (data?.user || response?.user);
      if (data?.requires_totp === true || data?.requires_otp === true
        || data?.requires_email_confirmation === true) {
        await authRouteAfterStep(response, pendingId, pendingEmail);
      } else {
        if (hasSession) {
          const token = data.access_token || data.token || response.access_token || response.token;
          const user = data.user || response.user;
          Auth.setSession(token, user, data.expires_in || response.expires_in);
        }
        const user = await Auth.ensureFresh(true);
        window.location.href = Auth.roleHome(user.role);
      }
    } catch (err) { error(err.message); inputs.forEach(input => { input.value = ''; }); inputs[0].focus(); }
    finally { busy(button, false); }
  }
  $('captcha-refresh').addEventListener('click', () => loadCaptcha().catch(err => error(err.message)));
  $('btn-verify-otp').addEventListener('click', verify);
  $('btn-cancel-otp').addEventListener('click', () => showLogin().catch(err => error(err.message)));
  $('btn-resend-otp').addEventListener('click', async () => {
    $('email').value = pendingEmail;
    $('password').value = pendingPassword;
    await showLogin().catch(err => error(err.message));
    $('captcha-input').focus();
  });
  inputs.forEach((input, index) => {
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(-1); if (input.value) inputs[index + 1]?.focus(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); verify(); }
      if (event.key === 'Backspace' && !input.value) inputs[index - 1]?.focus();
      if (event.key === 'ArrowLeft') inputs[index - 1]?.focus();
      if (event.key === 'ArrowRight') inputs[index + 1]?.focus();
    });
    input.addEventListener('paste', event => {
      event.preventDefault();
      const code = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      inputs.forEach((item, i) => { item.value = code[i] || ''; }); inputs[Math.min(code.length, 5)].focus();
    });
  });
  // A valid cookie restores this device without sending a new OTP.
  busy($('login-btn'), true);
  Auth.ensureFresh().then(user => { window.location.href = Auth.roleHome(user.role); })
    .catch(err => { if (err.status !== 401) error(err.message); return loadCaptcha().catch(err => error(err.message)); })
    .finally(() => busy($('login-btn'), false));
})();
