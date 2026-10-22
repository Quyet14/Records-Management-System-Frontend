const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('pages/login.html', 'utf8');
const loginScript = fs.readFileSync('assets/js/login.js', 'utf8');

test('login form requires email, password and CAPTCHA before submission', () => {
  assert.match(page, /type="email" id="email"[^>]*required/);
  assert.match(page, /type="password" id="password"[^>]*required minlength="6"/);
  assert.match(page, /id="captcha-input" maxlength="5" required/);
  assert.match(loginScript, /if \(!email\).*Vui lòng nhập email/s);
  assert.match(loginScript, /if \(!password\).*Vui lòng nhập mật khẩu/s);
  assert.match(loginScript, /if \(!captchaId \|\| !captchaCode\).*Vui lòng nhập mã xác nhận/s);
  assert.match(loginScript, /api\.post\('\/auth\/login',\s*\{\s*email,\s*password,\s*captcha_id:\s*captchaId,\s*captcha_code:\s*captchaCode\s*\}\)/);
});
