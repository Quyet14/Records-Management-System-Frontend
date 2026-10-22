// Local visual check with a mock session; never contacts the production API.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = process.cwd(), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/assets/js/app.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end(`const previewUser = {id:'preview',role:new URLSearchParams(location.search).get('role') || 'department_head',fullName:'Người dùng mẫu',department:{id:'dept-a',name:'Khoa Nội'}};
      window.Auth = {require:async()=>previewUser,getUser:()=>previewUser,getToken:()=>'',showError:console.error,hasPermission:()=>false};
      window.api={get:async()=>[]};`);
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lths-guide-preview-'));
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
    for (const role of ['user', 'department_head', 'admin']) {
      await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/pages/guide.html?role=' + role });
      for (let i = 0; i < 100; i++) {
        if (await evaluate(cdp, `document.getElementById('guide-role')?.textContent.includes('Dành cho')`)) break;
        await delay(100);
      }
      assert.equal(await evaluate(cdp, `document.getElementById('department-guide').hidden`), role !== 'department_head');
      assert.equal(await evaluate(cdp, `document.getElementById('admin-guide').hidden`), role !== 'admin');
      assert.equal(await evaluate(cdp, `document.documentElement.scrollWidth <= innerWidth`), true);
      if (role === 'department_head') {
        const shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync('artifacts/guide-desktop.png', Buffer.from(shot.data, 'base64'));
      }
      await evaluate(cdp, `document.getElementById('guide-search').value='tai ho so';document.getElementById('guide-search').dispatchEvent(new Event('input'));`);
      assert.equal(await evaluate(cdp, `document.getElementById('upload').hidden`), false);
      await evaluate(cdp, `document.getElementById('guide-search-clear').click()`);
    }
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(cdp, `window.scrollTo(0,0)`); await delay(200);
    assert.equal(await evaluate(cdp, `document.documentElement.scrollWidth <= innerWidth`), true);
    const shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('artifacts/guide-mobile.png', Buffer.from(shot.data, 'base64'));
    assert.deepEqual(cdp.errors, []);
    console.log('Guide preview passed: three roles, desktop/mobile layout, search, no runtime errors.');
  } finally {
    cdp?.ws.close(); browser.kill(); server.closeAllConnections(); server.close();
    await delay(500);
    const target = path.resolve(profile), tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (target.startsWith(tempRoot) && path.basename(target).startsWith('lths-guide-preview-')) {
      try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.closeAllConnections(); server.close(); });
