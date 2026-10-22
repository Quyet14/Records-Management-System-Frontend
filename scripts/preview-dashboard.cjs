// Local visual check with a mock session; never contacts the production API.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = process.cwd(), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/assets/js/app.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end("\nconst role = location.pathname.includes('/admin/') ? 'admin' : location.pathname.includes('/dept-head/') ? 'department_head' : 'user';\nconst previewUser = { id: 'preview', role, fullName: 'Nguyễn Minh Anh', departmentId: 'dept-a', department: { id: 'dept-a', name: 'Khoa Nội tổng hợp' } };\nwindow.Auth = { require: async () => previewUser, requireAdmin: async () => previewUser, requireDeptHead: async () => previewUser, getUser: () => previewUser, getToken: () => '', showError: console.error, hasPermission: () => false };\nwindow.esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;');\nwindow.fmtDate = value => new Date(value).toLocaleDateString('vi-VN');\nwindow.fmtSize = () => '2.4 MB';\nwindow.skeletonCards = () => '<p>Đang tải…</p>';\nwindow.emptyStatePro = (icon, title, description) => '<div class=\"empty-state\"><h3>' + esc(title) + '</h3><p>' + esc(description) + '</p></div>';\nwindow.statusBadge = status => '<span class=\"stamp stamp-' + (status === 'stored' ? 'ok' : 'wait') + '\">' + (status === 'stored' ? 'Đã lưu trữ' : 'Chờ duyệt') + '</span>';\nwindow.renderRetentionBanner = () => {};\nwindow.loadViewStatusMap = async () => new Map();\nwindow.canViewFromStatus = () => false;\nwindow.getDocumentId = document => document.id;\nwindow.displayDocTitle = document => document.title;\nwindow.Toast = { error: console.error };\nwindow.onPageReady = work => { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', work, { once: true }); else work(); };\nwindow.api = { get: async path => {\n  if (path.startsWith('/users')) return Array.from({ length: 900 }, (_, i) => ({ id: String(i), isActive: i !== 899, role: i === 0 ? 'admin' : 'user', departmentId: 'dept-a' }));\n  if (path.startsWith('/documents')) return { data: Array.from({ length: 50 }, (_, i) => ({ id: 'doc-' + i, title: ['Báo cáo hoạt động chuyên môn tháng 10', 'Hồ sơ lưu trữ và bàn giao tài liệu', 'Kế hoạch công tác khoa năm 2026'][i % 3], status: i < 8 ? 'stored' : 'pending', originalFilename: 'ho-so.pdf', createdAt: '2026-10-22', department: previewUser.department, uploader: { fullName: previewUser.fullName } })), total: 50 };\n  return [];\n} };\n");
  }
  const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!filename.startsWith(root + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(filename, (err, bytes) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(filename)] || 'application/octet-stream' });
    res.end(bytes);
  });
});
function connect(url) {
  return new Promise(resolve => {
    const ws = new WebSocket(url), pending = new Map(), errors = []; let id = 0;
    ws.onmessage = event => {
      const result = JSON.parse(event.data);
      if (result.id) { const p = pending.get(result.id); pending.delete(result.id); result.error ? p.reject(Error(result.error.message)) : p.resolve(result.result); }
      else if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails.text);
    };
    ws.onopen = () => resolve({ ws, errors, call: (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); }) });
  });
}
async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lths-dashboard-preview-'));
  const browser = spawn(process.env.EDGE_BIN || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', error => console.error(error.message));
  let cdp;
  try {
    let origin;
    for (let i = 0; i < 100; i++) {
      try { const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); origin = 'http://127.0.0.1:' + Number(port); await fetch(origin + '/json/version'); break; }
      catch { await delay(100); }
    }
    if (!origin) throw Error('Cannot launch browser');
    const tab = await (await fetch(origin + '/json/new?about:blank', { method: 'PUT' })).json();
    cdp = await connect(tab.webSocketDebuggerUrl);
    await cdp.call('Page.enable'); await cdp.call('Runtime.enable');
    fs.mkdirSync('artifacts', { recursive: true });

    for (const role of ['admin', 'department_head', 'user']) {
      const page = role === 'admin' ? 'admin/dashboard.html' : role === 'department_head' ? 'dept-head/dashboard.html' : 'dashboard.html';
      await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
      await cdp.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/pages/' + page });
      let loaded = false;
      for (let i = 0; i < 100; i++) {
        if (await evaluate(cdp, "document.querySelector('.stat-value')?.textContent !== '—' && !!document.querySelector('.dashboard-context time')?.dateTime && document.querySelector('.sidebar .nav-item.active') !== null")) { loaded = true; break; }
        await delay(100);
      }
      assert.equal(loaded, true);
      assert.equal(await evaluate(cdp, "document.querySelectorAll('.dashboard-shortcut').length"), 4);
      assert.equal(await evaluate(cdp, 'document.documentElement.scrollWidth <= innerWidth'), true);
      const expectedTotal = role === 'admin' ? '900' : role === 'department_head' ? '42' : '50';
      assert.equal(await evaluate(cdp, "document.querySelector('.stat-value').textContent"), expectedTotal);
      const bounds = await evaluate(cdp, "(() => { const r = document.querySelector('.stat-card').getBoundingClientRect(); return { x: r.right - 20, y: r.top + 20 }; })()");
      await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.x, y: bounds.y });
      await delay(400);
      assert.equal(await evaluate(cdp, "document.querySelector('.stat-card').style.getPropertyValue('--tilt-y') !== ''"), true);
      let shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('artifacts/dashboard-' + role + '-desktop.png', Buffer.from(shot.data, 'base64'));
      await cdp.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await delay(150);
      assert.equal(await evaluate(cdp, "document.querySelector('.stat-card').style.getPropertyValue('--tilt-y')"), '');
      assert.equal(await evaluate(cdp, "getComputedStyle(document.querySelector('.stat-card')).transform"), 'none');
      await cdp.call('Emulation.setEmulatedMedia', { features: [] });
      await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await evaluate(cdp, 'scrollTo(0,0)'); await delay(200);
      assert.equal(await evaluate(cdp, 'document.documentElement.scrollWidth <= innerWidth'), true);
      shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('artifacts/dashboard-' + role + '-mobile.png', Buffer.from(shot.data, 'base64'));
      await evaluate(cdp, "document.documentElement.setAttribute('data-theme','dark')");
      assert.equal(await evaluate(cdp, 'document.documentElement.scrollWidth <= innerWidth'), true);
    }
    assert.deepEqual(cdp.errors, []);
    console.log('Dashboard preview passed: three roles, original totals, shortcuts, pointer tilt, reduced motion, mobile/dark layout and no runtime errors.');

  } finally {
    cdp?.ws.close(); browser.kill(); server.closeAllConnections(); server.close();
    await delay(500);
    const target = path.resolve(profile), tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (target.startsWith(tempRoot) && path.basename(target).startsWith('lths-dashboard-preview-')) {
      try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.closeAllConnections(); server.close(); });
