// Local visual check with a mock session; never contacts the production API.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = process.cwd(), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/assets/js/app.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end("\nconst previewUser = { id: 'preview', role: 'department_head', fullName: 'Nguyễn Minh Anh', department: { id: 'dept-a', name: 'Khoa Nội tổng hợp' } };\nwindow.Auth = { require: async () => previewUser, requireDeptHead: async () => previewUser, getUser: () => previewUser, getToken: () => '', showError: console.error, hasPermission: () => false };\nwindow.esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;');\nwindow.fmtDate = value => value ? new Date(value).toLocaleDateString('vi-VN') : '—';\nwindow.fmtSize = value => value >= 1048576 ? (value / 1048576).toFixed(1) + ' MB' : value + ' B';\nwindow.onPageReady = work => { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', work, { once: true }); else work(); };\nwindow.previewCalls = [];\nwindow.api = { get: async path => {\n  previewCalls.push(path);\n  const url = new URL(path, location.origin);\n  const paged = data => ({ data, total: 25, limit: 20, page: Number(url.searchParams.get('page') || 1) });\n  switch (url.pathname) {\n    case '/stats/overview': return { totalDocuments: 1248, totalUsers: 42, storedSizeBytes: 2912235520, byStatus: [{ status: 'stored', count: 1080 }, { status: 'pending', count: 126 }, { status: 'rejected', count: 42 }] };\n    case '/stats/by-document-type': return { byType: [{ typeName: 'Hồ sơ bệnh án', totalDocuments: 640 }, { typeName: 'Báo cáo chuyên môn', totalDocuments: 320 }, { typeName: 'Văn bản hành chính', totalDocuments: 288 }] };\n    case '/stats/by-year': return { year: Number(url.searchParams.get('year')), monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, totalDocuments: 20 + i * 8, totalBytes: 10485760 + i * 2097152 })) };\n    case '/stats/by-classification': return [{ classificationValue: 'permanent', count: 320 }, { classificationValue: 'timed', count: 880 }, { classificationValue: 'unclassified', count: 48 }];\n    case '/retention/review-summary': return { totalOldDocuments: 100, completed: 75, remaining: 25, completionRate: 75, deadline: '2030-07-01' };\n    case '/retention/pending-review': return paged([{ id: 'doc-review', title: 'Hồ sơ bệnh án nội trú tháng 06/2024', documentType: 'Hồ sơ bệnh án', documentDate: '2024-06-01' }]);\n    case '/retention/expiring': return [{ id: 'doc-expiry', title: 'Báo cáo hoạt động chuyên môn năm 2021', documentType: 'Báo cáo chuyên môn', expiresAt: '2027-02-01', daysRemaining: 102 }];\n    case '/system/missing-checksums': return paged([{ id: 'doc-hash', title: 'Biên bản giao nhận hồ sơ lưu trữ', documentNumber: 'HS-2026-0182', status: 'stored', createdAt: '2026-09-01' }]);\n    case '/system/audit-logs': return paged([{ id: 'audit-a', documentTitle: 'Hồ sơ bệnh án nội trú tháng 09/2026', actorName: 'Nguyễn Minh Anh', action: 'approve', metadata: {}, createdAt: '2026-10-22T03:00:00Z' }]);\n    default: return [];\n  }\n} };\n");
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lths-department-preview-'));
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

    for (const mode of ['stats', 'monitor']) {
      await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
      await cdp.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/pages/dept-head/' + mode + '.html' });
      let loaded = false;
      for (let i = 0; i < 200; i++) {
        if (await evaluate(cdp, "document.getElementById('report-message')?.textContent.includes('Cập nhật:')")) { loaded = true; break; }
        await delay(100);
      }
      assert.equal(loaded, true, await evaluate(cdp, "document.getElementById('report-message')?.textContent"));
      assert.equal(await evaluate(cdp, 'document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(await evaluate(cdp, "document.getElementById('report-department').textContent"), 'Khoa Nội tổng hợp');
      if (mode === 'stats') {
        assert.equal(await evaluate(cdp, "Array.from(document.querySelectorAll('canvas')).filter(el => Chart.getChart(el)).length"), 5);
        await delay(600);
      } else {
        await evaluate(cdp, "document.getElementById('report-tab-expiry').click()");
        assert.equal(await evaluate(cdp, "document.getElementById('report-panel-expiry').hidden"), false);
        await evaluate(cdp, "document.getElementById('report-tab-checksums').focus()");
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home' });
        assert.equal(await evaluate(cdp, "document.getElementById('report-tab-review').getAttribute('aria-selected')"), 'true');
      }
      let shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('artifacts/department-' + mode + '-desktop.png', Buffer.from(shot.data, 'base64'));
      await evaluate(cdp, "document.getElementById('report-expiry-days').value='730'; document.getElementById('report-expiry-days').dispatchEvent(new Event('change'))");
      for (let i = 0; i < 100; i++) {
        if (await evaluate(cdp, "!document.getElementById('report-refresh').disabled")) break;
        await delay(100);
      }
      assert.equal(await evaluate(cdp, "previewCalls.includes('/retention/expiring?days=730')"), true);
      assert.equal(await evaluate(cdp, "previewCalls.every(path => !path.includes('/health') && !path.includes('/verify-checksums'))"), true);
      await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await evaluate(cdp, 'scrollTo(0,0)'); await delay(300);
      assert.equal(await evaluate(cdp, 'document.documentElement.scrollWidth <= innerWidth'), true);
      shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('artifacts/department-' + mode + '-mobile.png', Buffer.from(shot.data, 'base64'));
      await evaluate(cdp, "document.documentElement.setAttribute('data-theme','dark')"); await delay(200);
      assert.ok(await evaluate(cdp, "(() => {const label=document.querySelector('.stat-label');const luminance=color=>{const rgb=color.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const fg=luminance(getComputedStyle(label).color),bg=luminance(getComputedStyle(label.closest('.stat-card')).backgroundColor);return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);})()") >= 4.5, 'Dark theme labels must have readable contrast');
      assert.equal(await evaluate(cdp, 'document.documentElement.scrollWidth <= innerWidth'), true);
      shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('artifacts/department-' + mode + '-dark.png', Buffer.from(shot.data, 'base64'));
    }
    assert.deepEqual(cdp.errors, []);
    console.log('Department reports preview passed: statistics and monitor, five charts, scoped requests, tabs, expiry filter, desktop/mobile and dark theme.');

  } finally {
    cdp?.ws.close(); browser.kill(); server.closeAllConnections(); server.close();
    await delay(500); browser.unref();
    const target = path.resolve(profile), tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (target.startsWith(tempRoot) && path.basename(target).startsWith('lths-department-preview-')) {
      try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.closeAllConnections(); server.close(); });
