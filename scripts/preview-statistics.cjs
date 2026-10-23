// Local visual check with a mock session; never contacts the production API.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = process.cwd(), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/assets/js/app.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end("\nconst previewUser = { id: 'preview', role: location.pathname.includes('/admin/') ? 'admin' : 'department_head', fullName: 'Nguyễn Minh Anh', department: { id: 'dept-a', name: 'Khoa Nội tổng hợp' } };\nwindow.Auth = { require: async () => previewUser, requireDeptHead: async () => previewUser, getUser: () => previewUser, getToken: () => '', showError: console.error, hasPermission: () => false };\nwindow.esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;');\nwindow.fmtDate = value => value ? new Date(value).toLocaleDateString('vi-VN') : '—';\nwindow.fmtSize = value => value >= 1048576 ? (value / 1048576).toFixed(1) + ' MB' : value + ' B';\nwindow.onPageReady = work => { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', work, { once: true }); else work(); };\nwindow.previewCalls = [];\nwindow.api = { get: async path => {\n  previewCalls.push(path);\n  const url = new URL(path, location.origin);\n  const paged = data => ({ data, total: 25, limit: 20, page: Number(url.searchParams.get('page') || 1) });\n  switch (url.pathname) {\n    case '/stats/overview': return { totalDocuments: 1248, totalUsers: 42, storedSizeBytes: 2912235520, byStatus: [{ status: 'stored', count: 1080 }, { status: 'pending', count: 126 }, { status: 'rejected', count: 42 }] };\n    case '/stats/by-document-type': return { byType: [{ typeName: 'Hồ sơ bệnh án', totalDocuments: 640 }, { typeName: 'Báo cáo chuyên môn', totalDocuments: 320 }, { typeName: 'Văn bản hành chính', totalDocuments: 288 }] };\n    case '/stats/by-year': return { year: Number(url.searchParams.get('year')), monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, totalDocuments: 20 + i * 8, totalBytes: 10485760 + i * 2097152 })) };\n    case '/stats/by-classification': return [{ classificationValue: 'permanent', count: 320 }, { classificationValue: 'timed', count: 880 }, { classificationValue: 'unclassified', count: 48 }];\n    case '/retention/review-summary': return { totalOldDocuments: 100, completed: 75, remaining: 25, completionRate: 75, deadline: '2030-07-01' };\n    case '/retention/pending-review': return paged([{ id: 'doc-review', title: 'Hồ sơ bệnh án nội trú tháng 06/2024', documentType: 'Hồ sơ bệnh án', documentDate: '2024-06-01' }]);\n    case '/retention/expiring': return [{ id: 'doc-expiry', title: 'Báo cáo hoạt động chuyên môn năm 2021', documentType: 'Báo cáo chuyên môn', expiresAt: '2027-02-01', daysRemaining: 102 }];\n    case '/system/missing-checksums': return paged([{ id: 'doc-hash', title: 'Biên bản giao nhận hồ sơ lưu trữ', documentNumber: 'HS-2026-0182', status: 'stored', createdAt: '2026-09-01' }]);\n    case '/system/audit-logs': return paged([{ id: 'audit-a', documentTitle: 'Hồ sơ bệnh án nội trú tháng 09/2026', actorName: 'Nguyễn Minh Anh', action: 'approve', metadata: {}, createdAt: '2026-10-22T03:00:00Z' }]);\n    default: return [];\n  }\n} };\n\nAuth.requireAdmin = async () => previewUser;\nwindow.getFileSizeBytes = document => document.fileSizeBytes || 0;\nwindow.getExpiringDocs = () => [];\nwindow.Toast = { error: message => { throw Error(message); } };\nconst originalStatsGet = api.get;\napi.get = async path => {\n  if (!path.startsWith('/documents/search')) return originalStatsGet(path);\n  return { data: Array.from({ length:180 }, (_, index) => ({ id:'doc-' + index, title:'Hồ sơ ' + index,\n    status:index < 140 ? 'stored' : index < 170 ? 'pending' : 'rejected',\n    createdAt:new Date(new Date().getFullYear(), index % 12, 10).toISOString(),\n    documentDate:new Date(new Date().getFullYear(), index % 12, 10).toISOString(),\n    fileSizeBytes:1048576 * (index % 8 + 1), department:{name:['Khoa Nội','Khoa Ngoại','Khoa Cấp cứu','Khoa Dược'][index % 4]},\n    documentType:{name:['Hồ sơ bệnh án','Báo cáo chuyên môn','Văn bản hành chính','Hồ sơ nhân sự'][index % 4], isPermanent:index % 3 === 0},\n    valueType:index % 3 === 0 ? 'permanent' : 'limited'\n  })) };\n};\n\nwindow.previewFailGrowth=false;\nconst previousStatsGet=api.get;\napi.get=async path=>{\n if(!path.startsWith('/stats/')) return previousStatsGet(path);\n previewCalls.push(path);\n const u=new URL(path,location.origin), bytes=1048576;\n switch(u.pathname){\n case '/stats/overview': return {totalDocuments:1248,totalUsers:42,totalDepartments:18,storedSizeBytes:1080*bytes,byStatus:[{status:'stored',count:1080,totalBytes:1080*bytes},{status:'pending',count:126,totalBytes:126*bytes},{status:'rejected',count:42,totalBytes:42*bytes},{status:'destroyed',count:12,totalBytes:0}]};\n case '/stats/by-department':return Array.from({length:18},(_,i)=>({departmentId:'dept-'+i,departmentName:'Khoa '+(i+1),totalDocuments:100-i,totalBytes:(100-i)*bytes,storedCount:80-i,pendingCount:12,rejectedCount:8}));\n case '/stats/by-document-type':return {unclassifiedCount:8,byType:Array.from({length:24},(_,i)=>({typeId:'type-'+i,code:'HS'+i,typeName:'Loại hồ sơ '+(i+1),retentionYears:10,isPermanent:i===0,totalDocuments:50-i,totalBytes:(50-i)*bytes,storedCount:40-i}))};\n case '/stats/by-year':return {year:Number(u.searchParams.get('year')),monthly:Array.from({length:12},(_,i)=>({month:i+1,totalDocuments:u.searchParams.get('year')==='2020'?0:20+i*8,totalBytes:u.searchParams.get('year')==='2020'?0:(10+i*2)*bytes}))};\n case '/stats/by-classification':return [{classificationValue:'permanent',count:320,totalBytes:320*bytes},{classificationValue:'timed',count:892,totalBytes:880*bytes},{classificationValue:'unclassified',count:48,totalBytes:48*bytes}];\n case '/stats/storage-growth':if(previewFailGrowth)throw Error('Growth unavailable');return Array.from({length:24},(_,i)=>({year:2025+Math.floor(i/12),month:i%12+1,addedBytes:45*bytes,addedDocs:45,cumulativeBytes:(i+1)*45*bytes,cumulativeDocs:(i+1)*45}));\n case '/stats/top-uploaders':return Array.from({length:Number(u.searchParams.get('limit'))},(_,i)=>({userId:'u'+i,fullName:'Nhân viên '+(i+1),email:'user'+i+'@example.test',totalDocuments:50-i,totalBytes:(50-i)*bytes}));\n case '/stats/review-progress':return {deadline:'2030-07-01',daysToDeadline:1300,totalOldDocuments:100,completed:75,remaining:25,completionRate:75,byStatus:{pending:20,in_progress:5,completed:75}};\n case '/stats/expiring-soon':return {withinDays:Number(u.searchParams.get('days')),total:2,data:[{id:'e1',title:'Hồ sơ sắp hết hạn',department:'Khoa Nội',documentType:'Bệnh án',expiresAt:'2027-02-01',daysRemaining:100},{id:'e2',title:'Báo cáo chuyên môn',department:'Khoa Ngoại',documentType:'Báo cáo',expiresAt:'2027-04-01',daysRemaining:160}]};\n default:throw Error('Unexpected endpoint '+path);\n }\n};\n");
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lths-statistics-preview-'));
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


    for (const role of ['admin','dept-head']) {
      const count = role === 'admin' ? 8 : 5;
      await cdp.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
      await cdp.call('Page.navigate',{url:'http://127.0.0.1:' + server.address().port + '/pages/' + role + '/stats.html'});
      let loaded = false;
      for (let i=0;i<200;i++) {
        if (await evaluate(cdp,"document.querySelectorAll('.stats-chart-export').length === " + count + " && Array.from(document.querySelectorAll('canvas')).filter(canvas=>Chart.getChart(canvas)).length === " + count)) { loaded=true; break; }
        await delay(100);
      }
      assert.equal(loaded,true);
      await delay(800);
      assert.equal(await evaluate(cdp,'document.documentElement.scrollWidth <= innerWidth'),true);

      if(role==='admin') {
        assert.equal(await evaluate(cdp,"document.querySelectorAll('[data-stats-pane]:not([hidden])').length"),4);
        const calls=await evaluate(cdp,'previewCalls.length');
        for(const name of ['distribution','activity','retention','overview']) {
          await evaluate(cdp,"document.querySelector('[data-stats-pane="+name+"]').scrollIntoView({block:'start'})");await delay(180);
          assert.equal(await evaluate(cdp,"document.querySelector('[data-stats-pane="+name+"]').hidden"),false);
          assert.equal(await evaluate(cdp,"document.querySelectorAll('[data-stats-pane]:not([hidden])').length"),4);
          assert.equal(await evaluate(cdp,'document.documentElement.scrollWidth <= innerWidth'),true);
        }
        assert.equal(await evaluate(cdp,"document.querySelectorAll('[role=tab],[role=tabpanel]').length"),0);
        assert.equal(await evaluate(cdp,"Array.from(document.querySelectorAll('canvas')).every(canvas=>canvas.getBoundingClientRect().width>0)"),true);
        await evaluate(cdp,"document.querySelector('[data-stats-metric=department][data-metric=size]').click()");
        assert.equal(await evaluate(cdp,"Chart.getChart('chart-by-dept').data.datasets[0].label"),'Dung lượng (MB)');
        assert.equal(await evaluate(cdp,"Chart.getChart('chart-by-dept').data.datasets[0].data[0]"),100);
        await evaluate(cdp,"document.querySelector('[data-stats-metric=department][data-metric=count]').click()");
        assert.equal(await evaluate(cdp,"Chart.getChart('chart-by-dept').data.datasets[0].label"),'Hồ sơ hiện có');
        await evaluate(cdp,"document.querySelector('[data-stats-pane=activity]').scrollIntoView({block:'start'});document.querySelector('[data-stats-metric=monthly][data-metric=size]').click();document.querySelector('[data-stats-metric=growth][data-metric=count]').click()");
        assert.equal(await evaluate(cdp,"Chart.getChart('chart-by-month').data.datasets[0].data[0]"),10);
        assert.equal(await evaluate(cdp,"Chart.getChart('chart-growth-bytes').data.datasets[0].data.at(-1)"),1080);
        assert.equal(await evaluate(cdp,'previewCalls.length'),calls);
        assert.equal(await evaluate(cdp,"Array.from(document.querySelectorAll('.chart-card')).every(panel=>panel.querySelectorAll('details').length===1)"),true);
        await evaluate(cdp,"document.querySelector('[data-stats-metric=monthly][data-metric=count]').click();document.querySelector('[data-stats-metric=growth][data-metric=size]').click()");
        await delay(800);
        const activity=await cdp.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('artifacts/statistics-admin-activity.png',Buffer.from(activity.data,'base64'));
        await evaluate(cdp,"scrollTo(0,0)");await delay(200);
      }
      const statusId = role === 'admin' ? 'chart-by-status' : 'report-status-chart';
      assert.equal(await evaluate(cdp,"document.querySelectorAll('.stats-html-legend').length"),2);
      await evaluate(cdp,"document.getElementById('" + statusId + "').closest('.chart-card, .report-chart-panel').querySelector('.stats-html-legend button').click()");
      assert.equal(await evaluate(cdp,"Chart.getChart('" + statusId + "').getDataVisibility(0)"),false);
      assert.equal(await evaluate(cdp,"document.getElementById('" + statusId + "').closest('.chart-card, .report-chart-panel').querySelector('.stats-html-legend button').getAttribute('aria-pressed')"),'false');
      await evaluate(cdp,"document.getElementById('" + statusId + "').closest('.chart-card, .report-chart-panel').querySelector('.stats-html-legend button').click()");
      assert.equal(await evaluate(cdp,"Chart.getChart('" + statusId + "').getDataVisibility(0)"),true);
      await evaluate(cdp,"(() => { const original=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){window.statsDownload={file:this.download,valid:this.href.startsWith('data:image/png')}}; document.querySelector('.stats-chart-export').click(); HTMLAnchorElement.prototype.click=original; })()");
      assert.equal(await evaluate(cdp,"statsDownload.valid && statsDownload.file.endsWith('.png')"),true);
      const table = await evaluate(cdp,"document.querySelectorAll('.stats-chart-data table').length");
      assert.equal(table >= (role === 'admin' ? 8 : 1),true);
      let shot=await cdp.call('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync('artifacts/statistics-' + role + '-desktop.png',Buffer.from(shot.data,'base64'));
      const panelBounds=await evaluate(cdp,"(() => { const r=document.getElementById('"+statusId+"').closest('.chart-card, .report-chart-panel').getBoundingClientRect(); return {x:r.left,y:r.top+scrollY,width:r.width,height:r.height,scale:1}; })()");
      shot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:panelBounds});
      fs.writeFileSync('artifacts/statistics-' + role + '-donut.png',Buffer.from(shot.data,'base64'));
      const yearId=role==='admin'?'year-filter':'report-year';
      await evaluate(cdp,"document.getElementById('"+yearId+"').value='2020'; document.getElementById('"+yearId+"').dispatchEvent(new Event('change'))");
      await delay(900);
      assert.equal(await evaluate(cdp,"document.querySelectorAll('.stats-chart-export').length"),count);
      assert.equal(await evaluate(cdp,"document.querySelectorAll('.stats-html-legend').length"),2);
      if(role==='admin') {
        assert.equal(await evaluate(cdp,"document.getElementById('s-total').textContent"),'1.248');
        assert.equal(await evaluate(cdp,"Chart.getChart('chart-by-month').data.datasets[0].data.every(n=>n===0)"),true);
        assert.equal(await evaluate(cdp,"document.querySelectorAll('#summary-stats .stat-card').length"),10);
        assert.equal(await evaluate(cdp,"document.getElementById('s-destroyed').textContent"),'12');
        assert.equal(await evaluate(cdp,"document.querySelectorAll('#admin-department-table tbody tr').length"),18);
        assert.equal(await evaluate(cdp,"document.querySelectorAll('#admin-type-table tbody tr').length"),24);
        assert.equal(await evaluate(cdp,"document.querySelectorAll('#admin-status-table tbody tr').length"),4);
        assert.equal(await evaluate(cdp,"document.querySelectorAll('#admin-classification-table tbody tr').length"),3);
        assert.equal(await evaluate(cdp,"document.querySelectorAll('#admin-growth-table tbody tr').length"),24);
        assert.equal(await evaluate(cdp,"previewCalls.some(path=>path.startsWith('/documents/search'))"),false);
        await evaluate(cdp,"document.getElementById('admin-uploader-limit').value='25';document.getElementById('admin-uploader-limit').dispatchEvent(new Event('change'))");
        await delay(500);
        assert.equal(await evaluate(cdp,"document.querySelectorAll('#admin-uploader-table tbody tr').length"),25);
        await evaluate(cdp,"document.getElementById('expiry-years').value='2';document.getElementById('expiry-years').dispatchEvent(new Event('change'))");
        await delay(500);
        assert.equal(await evaluate(cdp,"previewCalls.at(-1)"),'/stats/expiring-soon?days=730');
        assert.equal(await evaluate(cdp,"document.querySelectorAll('#expiry-table-wrap tbody tr').length"),2);
        await evaluate(cdp,"previewFailGrowth=true;document.getElementById('admin-stats-refresh').click()");
        await delay(500);
        assert.equal(await evaluate(cdp,"document.querySelector('[data-admin-error=growth]').hidden"),false);
        assert.equal(await evaluate(cdp,"!!Chart.getChart('chart-growth-bytes')"),false);
        assert.equal(await evaluate(cdp,"document.getElementById('s-total').textContent"),'1.248');
        await evaluate(cdp,"previewFailGrowth=false;document.getElementById('admin-stats-refresh').click()");
        await delay(500);
        assert.equal(await evaluate(cdp,"document.querySelectorAll('.stats-chart-export').length"),8);
      } else {
        assert.equal(await evaluate(cdp,"document.querySelector('#report-summary .stat-card').getBoundingClientRect().height < 170"),true);
      }
      await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]}); await delay(150);
      assert.equal(await evaluate(cdp,"Array.from(document.querySelectorAll('canvas')).every(canvas=>Chart.getChart(canvas).config.options.animation === false)"),true);
      await cdp.call('Emulation.setEmulatedMedia',{features:[]});
      await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await evaluate(cdp,'scrollTo(0,0)'); await delay(200);
      assert.equal(await evaluate(cdp,'document.documentElement.scrollWidth <= innerWidth'),true);
      if(role==='admin') {
        for(const name of ['distribution','activity','retention','overview']) {
          await evaluate(cdp,"document.querySelector('[data-stats-pane="+name+"]').scrollIntoView({block:'start'})");await delay(150);
          assert.equal(await evaluate(cdp,'document.documentElement.scrollWidth <= innerWidth'),true);
        }
        await evaluate(cdp,'scrollTo(0,0)');await delay(150);
        const mobile=await cdp.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('artifacts/statistics-admin-mobile.png',Buffer.from(mobile.data,'base64'));
      }
      await evaluate(cdp,"document.documentElement.setAttribute('data-theme','dark')"); await delay(200);
      assert.equal(await evaluate(cdp,"Chart.getChart('"+statusId+"').config.options.color"),'#d0ddee');
      assert.equal(await evaluate(cdp,'document.documentElement.scrollWidth <= innerWidth'),true);
    }
    assert.deepEqual(cdp.errors,[]);
    console.log('Statistics browser QA passed: admin and department charts, legend toggles, PNG, data tables, year changes/no data, no duplicate controls, reduced motion, mobile and dark theme.');

  } finally {
    cdp?.ws.close(); browser.kill(); server.closeAllConnections(); server.close();
    await delay(500); browser.unref();
    const target = path.resolve(profile), tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (target.startsWith(tempRoot) && path.basename(target).startsWith('lths-statistics-preview-')) {
      try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.closeAllConnections(); server.close(); });
