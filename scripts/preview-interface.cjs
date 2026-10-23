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
    if (path.extname(filename) === '.html') {
      // Layout QA only: omit application calls; functional flows have separate tests.
      let html = bytes.toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      html = html.replace('</body>', '<script>' + "const role=location.pathname.includes('/admin/')?'admin':location.pathname.includes('/dept-head/')?'department_head':'user'; const mockUser={id:'preview',role,fullName:'Người dùng mẫu',department:{id:'dept-a',name:'Khoa Nội'}};window.Auth={require:async()=>mockUser,getUser:()=>mockUser,getToken:()=>'',hasPermission:()=>false,showError:console.error};window.api={get:async()=>[]};" + '</script><script src="/assets/js/sidebar.js"></script><script src="/assets/js/interface.js"></script></body>');
      return res.end(html);
    }
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lths-interface-preview-'));
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
    const pages = JSON.parse(fs.readFileSync('artifacts/interface-update-files.json', 'utf8')).filter(file => file.endsWith('.html'));
    const overflows = [];
    for (const page of pages) {
      await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
      await cdp.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' + page });
      for (let i = 0; i < 100; i++) {
        if (await evaluate(cdp, "document.querySelector('link[href*=interface]') && (document.querySelector('.sidebar') ? document.querySelector('.sidebar .nav-item') !== null : document.readyState !== 'loading')")) break;
        await delay(50);
      }
      await delay(100);
      if (!await evaluate(cdp, 'document.documentElement.scrollWidth <= innerWidth')) overflows.push(page + ': desktop');
      if (['pages/admin/users.html', 'pages/admin/stats.html', 'pages/login.html', 'pages/upload.html'].includes(page)) {
        const shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync('artifacts/interface-' + page.replaceAll('/', '-').replace('.html', '') + '.png', Buffer.from(shot.data, 'base64'));
      }
      if (page === 'pages/admin/stats.html') {
        const point = await evaluate(cdp, "(() => { const r=document.querySelector('.stat-card').getBoundingClientRect();return {x:r.right-20,y:r.top+20};})()");
        await cdp.call('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y }); await delay(150);
        assert.equal(await evaluate(cdp, "document.querySelector('.interface-depth-active') !== null"), true);
        await cdp.call('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] }); await delay(100);
        assert.equal(await evaluate(cdp, "document.querySelector('.interface-depth-active') === null"), true);
        await cdp.call('Emulation.setEmulatedMedia', {features:[]});
      }
      await cdp.call('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:1,mobile:true });
      await evaluate(cdp,'scrollTo(0,0)'); await delay(100);
      if (!await evaluate(cdp,'document.documentElement.scrollWidth <= innerWidth')) {
        const elements = await evaluate(cdp, "Array.from(document.querySelectorAll('main *, .login-wrap *, .auth-wrap *')).filter(el => {const r=el.getBoundingClientRect(); return r.width && r.right>innerWidth+2 && !el.closest('.table-wrap, .sidebar, .modal-overlay, [hidden]');}).slice(0,4).map(el => el.tagName+'.'+el.className)");
        overflows.push(page + ': mobile ' + elements.join(','));
      }
      await evaluate(cdp, "document.documentElement.setAttribute('data-theme','dark')");
      if (!await evaluate(cdp,'document.documentElement.scrollWidth <= innerWidth')) overflows.push(page + ': dark mobile');
    }
    assert.deepEqual(overflows, []);
    assert.deepEqual(cdp.errors, []);
    console.log('Interface layout QA passed: ' + pages.length + ' pages, desktop/mobile/dark, 3D hover and reduced motion. Application scripts were mocked for this layout pass.');

  } finally {
    cdp?.ws.close(); browser.kill(); server.closeAllConnections(); server.close();
    await delay(500);
    const target = path.resolve(profile), tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (target.startsWith(tempRoot) && path.basename(target).startsWith('lths-interface-preview-')) {
      try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.closeAllConnections(); server.close(); });
