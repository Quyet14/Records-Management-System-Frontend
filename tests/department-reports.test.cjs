const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const reports = require('../assets/js/department-reports.js');
const user = { role: 'department_head', department: { id: 'dept-a', name: 'Khoa A' } };
const overview = { totalDocuments: 42, totalUsers: 7, storedSizeBytes: 8192,
  byStatus: [{ status: 'stored', count: 30 }, { status: 'approved', count: 2 }, { status: 'pending', count: 10 }] };
function fixture(path) {
  const url = new URL(path, 'http://test');
  const page = Number(url.searchParams.get('page') || 1);
  const envelope = data => ({ data, total: 45, page, limit: 20 });
  switch (url.pathname) {
    case '/stats/overview': return structuredClone(overview);
    case '/stats/by-document-type': return { byType: [{ typeName: 'Loại A', totalDocuments: 42 }], unclassifiedCount: 0 };
    case '/stats/by-year': return { year: Number(url.searchParams.get('year')), monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, totalDocuments: i, totalBytes: i * 1024 })) };
    case '/system/missing-checksums': return envelope([{ id: 'no-hash', title: '<Hồ sơ thiếu checksum>', status: 'pending', documentNumber: 'HS-1', createdAt: '2026-01-01' }]);
    case '/retention/pending-review': return { ...envelope([{ id: 'old', title: 'Hồ sơ cũ', documentType: 'Loại A', documentDate: '2024-01-01' }]), deadline: '2030-07-01', daysToDeadline: 1000 };
    case '/retention/review-summary': return { totalOldDocuments: 100, completed: 55, remaining: 45, completionRate: 55, deadline: '2030-07-01' };
    case '/retention/expiring': return [{ title: 'Sắp hết hạn', documentType: 'Loại A', expiresAt: '2027-01-01', daysRemaining: 80 }];
    case '/system/audit-logs': return envelope([{ id: 'log-1', documentTitle: 'Hồ sơ A', actorName: '<Người duyệt>', action: url.searchParams.get('action') || 'auto-approve (private)', metadata: { reason: '<Lý do>' }, createdAt: '2026-10-22T03:00:00Z' }]);
    default: throw Error('Unexpected API: ' + path);
  }
}

test('statistics use scoped report endpoints; only the monthly request receives year', async () => {
  const calls = [];
  const data = await reports.loadStats(user, async path => { calls.push(path); return fixture(path); }, 2025);
  assert.deepEqual(calls, ['/stats/overview', '/stats/by-document-type', '/stats/by-year?year=2025']);
  assert.equal(data.summary.totalDocuments, 42);
  assert.equal(data.monthly.year, 2025);
  assert.equal(data.monthly.monthly.length, 12);
});

test('monitor requests scoped checksums, retention and actual audit logs with independent pagination', async () => {
  const calls = [];
  const data = await reports.loadMonitor(user, async path => { calls.push(new URL(path, 'http://test')); return fixture(path); }, { checksums: 2, review: 3, history: 1 }, 'auto-approve (private)');
  assert.equal(calls.length, 6);
  assert.equal(calls.find(url => url.pathname === '/system/missing-checksums').searchParams.get('page'), '2');
  assert.equal(calls.find(url => url.pathname === '/retention/pending-review').searchParams.get('page'), '3');
  assert.equal(calls.find(url => url.pathname === '/system/audit-logs').searchParams.get('action'), 'auto-approve (private)');
  assert.equal(data.missing.total, 45);
  assert.equal(data.progress.remaining, 45);
  assert.ok(calls.every(url => !url.searchParams.has('departmentId')));
});

test('missing department and non-head roles fail before any data request', async () => {
  for (const actor of [{ role: 'department_head' }, { role: 'user', departmentId: 'dept-a' }, { role: 'admin', departmentId: 'dept-a' }, null]) {
    let calls = 0;
    const get = async () => { calls++; return {}; };
    await assert.rejects(reports.loadStats(actor, get, 2026));
    await assert.rejects(reports.loadMonitor(actor, get, {}));
    assert.equal(calls, 0);
  }
});

test('invalid years and filters do not send invalid report requests', async () => {
  for (const year of ['', 1899, 10000, 2026.5, 'invalid']) {
    await assert.rejects(reports.loadStats(user, async () => assert.fail('Unexpected API call'), year), /Năm/);
  }
  await assert.rejects(reports.loadMonitor(user, async () => assert.fail('Unexpected API call'), {}, 'approved'), /Bộ lọc/);
});

test('malformed report payloads and missing report APIs fail without using document search', async () => {
  await assert.rejects(reports.loadStats(user, async path => path === '/stats/overview' ? {} : fixture(path), 2026), /không hợp lệ/);
  await assert.rejects(reports.loadStats(user, async path => path.startsWith('/stats/by-year') ? { year: 2025, monthly: [] } : fixture(path), 2026), /không hợp lệ/);
  await assert.rejects(reports.loadMonitor(user, async path => path.startsWith('/system/missing-checksums') ? { data: [], total: '0', page: 1, limit: 20 } : fixture(path), {}), /phân trang/);
  await assert.rejects(reports.loadMonitor(user, async path => path === '/retention/review-summary'
    ? { totalOldDocuments: 100, completed: 55, remaining: 45, completionRate: 101 }
    : fixture(path), {}), /Tiến độ chỉnh lý/);
  const calls = [];
  await assert.rejects(reports.loadMonitor(user, async path => {
    calls.push(path);
    if (path.startsWith('/system/missing-checksums')) throw Object.assign(Error('Not found'), { status: 404 });
    return fixture(path);
  }, {}), /Not found/);
  assert.ok(calls.every(path => !path.startsWith('/documents') && !path.includes('/health') && !path.includes('/verify-checksums')));
});

async function setup(mode, options = {}) {
  const elements = new Map(), events = {}, calls = [], chartConfigs = [];
  let destroyedCharts = 0;
  const html = fs.readFileSync(`pages/dept-head/${mode}.html`, 'utf8');
  const declaredIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const get = id => {
    if (!declaredIds.has(id)) return null;
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', disabled: false,
      addEventListener(name, fn) { this[name] = fn; } });
    return elements.get(id);
  };
  const contentIds = mode === 'stats' ? ['report-status', 'report-types', 'report-months']
    : ['report-checksum-status', 'report-checksums', 'report-review-progress', 'report-review', 'report-expiry', 'report-history'];
  contentIds.forEach(id => assert.ok(get(id), `${id} must exist in pages/dept-head/${mode}.html`));
  let ready, respond = options.respond, actor = user;
  const context = {
    document: {
      getElementById: get,
      querySelector: () => ({ dataset: { departmentReport: mode } }),
      querySelectorAll: () => contentIds.map(get), addEventListener: (name, fn) => { events[name] = fn; }
    },
    Auth: { requireDeptHead: async () => actor, getUser: () => actor },
    api: { get: async path => { calls.push(path); const custom = respond && await respond(path); return custom === undefined ? fixture(path) : custom; } },
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    fmtSize: value => String(value) + ' bytes', fmtDate: value => String(value || '—'),
    onPageReady: fn => { ready = fn; }, addEventListener: (name, fn) => { events[name] = fn; },
    Chart: class {
      constructor(element, config) { chartConfigs.push({ element, config }); }
      destroy() { destroyedCharts++; }
    },
    URLSearchParams, Date, console
  };
  vm.runInNewContext(fs.readFileSync('assets/js/department-reports.js', 'utf8'), context);
  await ready();
  return { get, calls, events, chartConfigs, get destroyedCharts() { return destroyedCharts; }, setRespond: fn => { respond = fn; }, setUser: value => { actor = value; }, html: () => [...elements.values()].map(el => el.innerHTML).join('') };
}

test('statistics render backend totals and monthly bytes; a year change does not filter all-time overview', async () => {
  const env = await setup('stats');
  assert.match(env.get('report-summary').innerHTML, />42</);
  assert.match(env.get('report-summary').innerHTML, /8192 bytes/);
  assert.match(env.get('report-summary').innerHTML, /stat-card--brass/);
  assert.match(env.get('report-summary').innerHTML, /class="stat-icon"/);
  assert.match(env.get('report-summary').innerHTML, /<svg viewBox="0 0 24 24"/);
  assert.equal((env.get('report-summary').innerHTML.match(/class="stat-card /g) || []).length, 5);
  assert.match(env.get('report-types').innerHTML, /Loại A/);
  assert.equal(env.chartConfigs.length, 4);
  assert.equal(env.chartConfigs[0].config.type, 'doughnut');
  assert.equal(env.chartConfigs[2].config.type, 'line');
  assert.equal(env.chartConfigs[3].config.options.indexAxis, 'y');
  assert.equal(env.get('report-year-label').textContent, new Date().getFullYear());
  env.get('report-year').value = '2025';
  await env.get('report-year').change();
  assert.equal(env.calls.at(-1), '/stats/by-year?year=2025');
  assert.match(env.get('report-summary').innerHTML, />42</);
  assert.match(env.get('report-months').innerHTML, /11264 bytes/);
  assert.equal(env.destroyedCharts, 4);
  assert.equal(env.chartConfigs.length, 8);
});

test('monitor renders server audit events safely, progress and paginated totals', async () => {
  const env = await setup('monitor');
  assert.match(env.get('report-summary').innerHTML, /stat-card--deny/);
  assert.match(env.get('report-summary').innerHTML, /class="stat-icon"/);
  assert.equal((env.get('report-summary').innerHTML.match(/class="stat-card /g) || []).length, 4);
  assert.match(env.get('report-checksum-status').innerHTML, /45 hồ sơ chưa có SHA-256/);
  assert.match(env.get('report-checksums').innerHTML, /&lt;Hồ sơ thiếu checksum&gt;/);
  assert.match(env.get('report-checksums').innerHTML, /Trang 1\/3 · 45 kết quả/);
  assert.match(env.get('report-review-progress').innerHTML, /55\/100/);
  assert.match(env.get('report-review-progress').innerHTML, /<progress/);
  assert.match(env.get('report-history').innerHTML, /Tự động duyệt/);
  assert.match(env.get('report-history').innerHTML, /&lt;Người duyệt&gt;/);
  assert.match(env.get('report-history').innerHTML, /&lt;Lý do&gt;/);
  const button = { dataset: { reportPage: 'history', page: '2' } };
  env.events.click({ target: { closest: () => button } });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(env.calls.some(path => path.startsWith('/system/audit-logs?page=2')));
  env.get('report-history-filter').value = 'reject';
  env.get('report-history-filter').change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.calls.at(-1), '/system/audit-logs?page=1&limit=20&action=reject');
});

for (const mode of ['stats', 'monitor']) test(`${mode}: same-department session refresh preserves the rendered report`, async () => {
  const env = await setup(mode);
  const before = env.html();
  const callsBefore = env.calls.length;
  env.events['lths:session']({ detail: { user: { ...user, departmentId: 'dept-a' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.html(), before);
  assert.equal(env.calls.length, callsBefore);
});

for (const mode of ['stats', 'monitor']) test(`${mode}: changed department reloads the report in the new scope`, async () => {
  const env = await setup(mode);
  const callsBefore = env.calls.length;
  const changedUser = { ...user, departmentId: 'dept-b' };
  env.setUser(changedUser);
  env.events['lths:session']({ detail: { user: changedUser } });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(env.calls.length > callsBefore);
  assert.match(env.get('report-message').textContent, /Dữ liệu thuộc khoa của bạn/);
});

test('logout clears the report so data is not retained after the session ends', async () => {
  const env = await setup('stats');
  env.events['lths:session']({ detail: { user: null } });
  assert.equal(env.html(), '');
  assert.match(env.get('report-message').textContent, /Phiên đăng nhập đã kết thúc/);
});

for (const mode of ['stats', 'monitor']) test(`${mode}: 403 clears old totals and shows the access error without fallback`, async () => {
  const env = await setup(mode);
  env.setRespond(async () => { throw Object.assign(Error('Chưa gán khoa'), { status: 403 }); });
  await env.get('report-refresh').click();
  assert.equal(env.html(), '');
  assert.match(env.get('report-message').textContent, /Không được phép.*Chưa gán khoa/);
  assert.equal(env.get('report-refresh').disabled, false);
  assert.ok(env.calls.every(path => !path.startsWith('/documents')));
});

test('a response for an earlier year cannot replace the newer report', async () => {
  const env = await setup('stats');
  let resolveOld;
  env.setRespond(path => path === '/stats/by-year?year=2024' ? new Promise(resolve => { resolveOld = resolve; }) : undefined);
  env.get('report-year').value = '2024';
  const old = env.get('report-year').change();
  await new Promise(resolve => setImmediate(resolve));
  env.get('report-year').value = '2025';
  await env.get('report-year').change();
  const current = env.html();
  resolveOld(fixture('/stats/by-year?year=2024'));
  await old;
  assert.equal(env.html(), current);
});

test('a department change while requests are pending clears the old department report', async () => {
  let resolveOverview;
  const env = await setup('stats');
  env.setRespond(path => path === '/stats/overview' ? new Promise(resolve => { resolveOverview = resolve; }) : undefined);
  const pending = env.get('report-refresh').click();
  await new Promise(resolve => setImmediate(resolve));
  env.setUser({ role: 'department_head', departmentId: 'dept-b' });
  resolveOverview(structuredClone(overview));
  await pending;
  assert.equal(env.html(), '');
  assert.match(env.get('report-message').textContent, /Khoa của tài khoản đã thay đổi/);
});
