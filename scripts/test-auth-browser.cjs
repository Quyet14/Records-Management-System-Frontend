const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const delay = ms => new Promise(r => setTimeout(r, ms));
const user = { id: 'admin-1', role: 'admin', email: 'admin@test.local', fullName: 'Admin', permissions: [] };
let session = 0, rotations = 0, replay = 0, recent = true, otherDevice = true;
const tokens = new Set(); const calls = [];
const root = process.cwd();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'); const route = url.pathname;
  const json = (data, status = 200, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(status === 204 ? '' : JSON.stringify(data)); };
  const cookie = () => `lths_refresh=${session}; Path=/auth; HttpOnly; SameSite=Lax`;
  if (route.startsWith('/auth/') || route.startsWith('/users/') || route.startsWith('/destruction/') || route.startsWith('/notifications') || route.startsWith('/documents') || route.startsWith('/stats') || route.startsWith('/departments') || route.startsWith('/document-types')) {
    calls.push(route);
    if (route === '/auth/captcha') return json({ captcha_id: 'captcha', image: '<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="20">123456</text></svg>', expires_in: 300 });
    if (route === '/auth/login') { let body = ''; req.on('data', c => body += c); req.on('end', () => { assert.equal(JSON.parse(body).email, user.email); json({ requires_otp: true, user_id: user.id, email_hint: 'a***@test.local', expires_in: 300 }); }); return; }
    if (route === '/auth/verify-otp') { session++; recent = true; tokens.add('token-' + session); return json({ access_token: 'token-' + session, user, expires_in: 1200 }, 200, { 'Set-Cookie': cookie() }); }
    if (route === '/documents/test-pdf/view' && url.searchParams.get('token') === 'file-view') {
      assert.equal(req.headers.authorization, undefined);
      res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end('%PDF-1.7'); return;
    }
    if (route === '/auth/refresh') {
      const sent = /lths_refresh=(\d+)/.exec(req.headers.cookie || '')?.[1];
      if (!sent || !session) return json({}, 401);
      if (Number(sent) !== session) { replay++; return json({}, 401); }
      session++; rotations++; tokens.add('token-' + session);
      return json({ access_token: 'token-' + session, user, expires_in: 1200 }, 200, { 'Set-Cookie': cookie() });
    }
    if (route === '/auth/logout') { session = 0; tokens.clear(); return json(null, 204, { 'Set-Cookie': 'lths_refresh=; Path=/auth; Max-Age=0; HttpOnly' }); }
    if (!tokens.has((req.headers.authorization || '').replace('Bearer ', ''))) return json({}, 401);
    if (route === '/users/sensitive') return recent ? json({ ok: true }) : json({ code: 'RECENT_AUTH_REQUIRED' }, 403);
    if (route === '/documents/test-pdf/view-url') return json({ url: '/documents/test-pdf/view?token=file-view', expiresIn: 120 });
    if (route === '/auth/sessions') return json({ sessions: [{ id: 'current', isCurrent: true, userAgent: 'Current browser' }, ...(otherDevice ? [{ id: 'other', userAgent: 'Other browser' }] : [])] });
    if (route === '/auth/sessions/other' && req.method === 'DELETE') { otherDevice = false; return json(null, 204); }
    if (route === '/auth/logout-all') { session = 0; tokens.clear(); return json(null, 204, { 'Set-Cookie': 'lths_refresh=; Path=/auth; Max-Age=0; HttpOnly' }); }
    if (route === '/users/me') return json(user);
    if (route === '/destruction/capabilities') return json({ enabled: true, canCreate: true, waitHours: 24, serverTime: new Date().toISOString(), maxPdfBytes: 26214400, maxItemsPerRequest: 100, backupPolicy: { version: 'test', targets: ['external','cloud','nas'].map(key => ({ key, label: key, purgeWithinDays: 7 })) } });
    if (route === '/destruction/requests' || route === '/destruction/destroyed-documents') return json({ items: [], total: 0, page: 1, pageSize: 20 });
    if (route === '/notifications/stream') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {}\n\n'); req.on('close', () => res.end()); return; }
    if (route.startsWith('/stats')) return json({ total: 0, pending: 0, stored: 0, rejected: 0 });
    return json([]);
  }
  const filename = path.resolve(root, '.' + decodeURIComponent(route));
  if (!filename.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
  fs.readFile(filename, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(filename); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    if (ext === '.html') data = data.toString().replace('<head>', `<head><meta name="lths-api-base" content="http://localhost:${server.address().port}">`);
    res.end(data);
  });
});
function connect(wsUrl) {
  return new Promise(resolve => {
    const ws = new WebSocket(wsUrl); let next = 0; const pending = new Map(), errors = [];
    ws.onmessage = e => { const data = JSON.parse(e.data); if (data.id) { const p = pending.get(data.id); pending.delete(data.id); data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result); } else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text); };
    ws.onopen = () => resolve({ ws, errors, call: (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }) });
  });
}
async function evaluate(cdp, expression) { const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
async function until(cdp, expression) { for (let i = 0; i < 100; i++) { try { if (await evaluate(cdp, expression)) return; } catch (_) {} await delay(100); } throw new Error('Timed out: ' + expression); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://localhost:' + server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lths-auth-browser-'));
  const browser = spawn(process.env.EDGE_BIN || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir=' + profile,'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const closed = new Promise(resolve => { browser.on('exit', resolve); browser.on('error', resolve); });
  let debugOrigin;
  const clients = [];
  try {
    for (let i = 0; i < 100; i++) {
      try {
        const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
        if (!/^\d+$/.test(port)) throw new Error('Invalid debug port');
        debugOrigin = 'http://127.0.0.1:' + port;
        await fetch(debugOrigin + '/json/version'); break;
      } catch (_) { await delay(100); }
    }
    if (!debugOrigin) throw new Error('Cannot start headless browser');
    const newTab = async () => { const target = await (await fetch(debugOrigin + '/json/new?about:blank', { method: 'PUT' })).json(); const c = await connect(target.webSocketDebuggerUrl); clients.push(c); await c.call('Runtime.enable'); await c.call('Page.enable'); return c; };
    const first = await newTab();
    await first.call('Page.navigate', { url: base + '/pages/login.html' });
    await until(first, `document.querySelector('#login-btn') && !document.querySelector('#login-btn').disabled`);
    assert.equal(await evaluate(first, `!!document.querySelector('#password')`), true);
    assert.equal(await evaluate(first, `document.querySelector('#btn-toggle-pw svg') !== null`), true);
    assert.equal(await evaluate(first, `Auth.roleHome('admin')`), '/pages/admin/dashboard.html');
    assert.equal(await evaluate(first, `document.querySelector('a[href="forgot-password.html"]')?.textContent.trim()`), 'Quên mật khẩu?');
    await evaluate(first, `document.querySelector('#btn-toggle-pw').click()`);
    assert.equal(await evaluate(first, `document.querySelector('#password').type`), 'text');
    assert.equal(await evaluate(first, `document.querySelector('#btn-toggle-pw[aria-pressed="true"]') !== null`), true);
    await evaluate(first, `document.querySelector('#btn-toggle-pw').click()`);
    await evaluate(first, `document.querySelector('#email').value='admin@test.local';document.querySelector('#password').value='test-password';document.querySelector('#captcha-input').value='123456';document.querySelector('#login-form').requestSubmit()`);
    await until(first, `document.querySelector('#otp-panel').style.display==='block'`);
    await evaluate(first, `document.querySelectorAll('.otp-input').forEach((e,i)=>e.value=String(i+1));document.querySelector('#btn-verify-otp').click()`);
    await until(first, `location.pathname==='/pages/admin/dashboard.html' && window.Auth?.getUser()?.role==='admin' && !!document.querySelector('#btn-logout')`);
    assert.equal(await evaluate(first, `localStorage.getItem('lths_token')`), null);
    assert.equal(await evaluate(first, `sessionStorage.getItem('lths_token')`), null);
    assert.equal(await evaluate(first, `document.cookie.includes('lths_refresh')`), false);
    assert.equal(await evaluate(first, `(async()=> (await fetchDocumentView('test-pdf')).status)()`), 200);
    recent = false;
    await evaluate(first, `window.sensitiveDone=false;api.patch('/users/sensitive',{role:'user'}).then(()=>window.sensitiveDone=true);true`);
    await until(first, `document.querySelector('dialog[open] input[name="captcha"]') && document.querySelector('dialog img')?.src`);
    await evaluate(first, `document.querySelector('dialog input[name="captcha"]').value='123456';document.querySelector('dialog form').requestSubmit()`);
    await until(first, `document.querySelector('dialog input[name="otp"]').required`);
    await evaluate(first, `document.querySelector('dialog input[name="otp"]').value='123456';document.querySelector('dialog form').requestSubmit()`);
    await until(first, `window.sensitiveDone===true && !document.querySelector('dialog[open]')`);
    const second = await newTab();
    await Promise.all([first.call('Page.navigate', { url: base + '/pages/destruction.html' }), second.call('Page.navigate', { url: base + '/pages/documents.html' })]);
    await until(first, `document.querySelector('#requests-list')?.textContent.includes('Chưa có đề nghị')`);
    await until(second, `window.Auth?.getUser()?.role==='admin'`);
    await delay(300);
    assert.equal(replay, 0); assert.ok(rotations >= 3);
    await first.call('Page.navigate', { url: base + '/pages/devices.html' });
    await until(first, `document.querySelector('[data-revoke="other"]')`);
    await evaluate(first, `document.querySelector('[data-revoke="other"]').click()`);
    await until(first, `!document.querySelector('[data-revoke="other"]') && document.querySelector('[data-revoke="current"]')`);
    assert.equal(otherDevice, false);
    await evaluate(first, `document.querySelector('#sessions-logout-all').click()`);
    await until(first, `location.pathname==='/pages/login.html'`);
    await until(second, `location.pathname==='/pages/login.html'`);
    await delay(200);
    assert.equal(session, 0);
    assert.deepEqual(clients.flatMap(c => c.errors), []);
    console.log(JSON.stringify({ browser: 'Edge headless', otpLogin: true, memoryOnly: true, httpOnlyCookie: true, crossTabRefresh: true, signedPdfView: true, recentOtp: true, deviceRevocation: true, replay, logoutAllOpenTabs: true, runtimeErrors: 0 }));
  } finally {
    for (const client of clients) client.ws.close();
    browser.kill(); server.closeAllConnections(); server.close();
    await Promise.race([closed, delay(3000)]);
    const target = path.resolve(profile), tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (target.startsWith(tempRoot) && path.basename(target).startsWith('lths-auth-browser-')) {
      try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }); }
      catch (_) { console.warn('Temporary browser profile is still in use: ' + target); }
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.closeAllConnections(); server.close(); });
