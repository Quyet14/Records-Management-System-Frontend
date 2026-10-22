/* Event/API integration checks with a minimal DOM; no real backend is called. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const rules = require('../assets/js/destruction-rules.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/destruction.js'), 'utf8');

const stamp = '2026-10-19T03:00:00Z';
const user = { id: 'admin-2', role: 'admin' };
const caps = {
  enabled: true, canCreate: true, serverTime: stamp, waitHours: 24,
  maxPdfBytes: 26214400, maxItemsPerRequest: 100,
  backupPolicy: { version: 'v1', targets: ['external', 'cloud', 'nas'].map(key => ({ key, label: key, purgeWithinDays: 30 })) }
};
const doc = { id: 'doc-1', title: '<script>untrusted</script>', code: 'HS-1', documentType: { name: 'Type' },
  status: 'stored', retentionUntil: '2025-01-01T00:00:00Z', legalHold: false, eligible: true, securityLevel: 'normal' };
const detail = (changes = {}) => ({
  id: 'req-1', code: 'HUY-1', version: 1, createdBy: { id: 'admin-1', fullName: 'Author' },
  status: 'pending', decisionNumber: 'QD-1', decisionDate: '2026-10-19', reason: 'Expired',
  approvals: [], requiredApprovals: 1, items: [], attachments: [], events: [], backupPolicy: caps.backupPolicy,
  allowedActions: ['approve', 'reject', 'withdraw'], ...changes
});
const page = items => ({ items, page: 1, pageSize: 20, total: items.length });
class Element {
  constructor(dataset = {}) {
    const classes = new Set();
    Object.assign(this, { dataset, innerHTML: '', textContent: '', value: '', disabled: false, hidden: false, files: [], elements: {}, listeners: {},
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle() {} } });
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute() {}
  removeAttribute() {}
  querySelectorAll() { return []; }
  querySelector() { return this.submitButton ||= new Element(); }
  reportValidity() { return true; }
  focus() {}
  reset() { this.resetCalled = true; }
  closest(selector) { return selector === '[data-action-form]' && this.dataset.actionForm ? this : null; }
}
async function flush() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); }
async function setup(options = {}) {
  const elements = new Map(), events = {}, calls = [], notices = [];
  const get = name => { if (!elements.has(name)) elements.set(name, new Element()); return elements.get(name); };
  const tabs = ['requests', 'create', 'destroyed'].map(tab => { const el = new Element({ tab }); el.disabled = tab === 'create'; return el; });
  get('panel-create').hidden = true; get('panel-destroyed').hidden = true;
  get('create-submit').disabled = true;
  const location = { href: `http://localhost/pages/destruction.html${options.search || ''}`, search: options.search || '' };
  let current = options.detail || detail();
  const context = {
    Auth: { require() {}, ensureFresh: async () => {}, getUser: () => options.user || user, getToken: () => 'test-token', clear() {} },
    API: 'http://backend.test', window: { DestructionRules: rules, addEventListener() {} },
    document: {
      getElementById: get,
      querySelectorAll: selector => selector.includes('[data-tab]') || selector === '.destruction-tabs button' ? tabs : [],
      querySelector: selector => selector === '[data-tab="create"]' ? tabs[1] : null,
      addEventListener: (name, callback) => { events[name] = callback; }
    },
    location, history: { replaceState: (_, __, url) => { location.href = String(url); } },
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    Toast: Object.fromEntries(['error', 'success', 'warning'].map(type => [type, message => notices.push({ type, message })])),
    documentSecurityLabel: value => value, _pagesRoot: () => '/pages/',
    URL, URLSearchParams, FormData, File, TextDecoder, TextEncoder, Uint8Array, Date, crypto,
    setInterval() {}, setTimeout, console,
    fetch: async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({ path, url: String(url), ...init });
      if (options.respond) {
        const response = await options.respond(url, init);
        if (response) return response;
      }
      let body;
      if (path === '/destruction/capabilities') {
        if (options.unavailable) return new Response('{}', { status: 404 });
        body = { ...caps, ...options.caps };
      } else if (path === '/documents/search') {
        body = { documents: options.documents || [doc, { ...doc, id: 'held', legalHold: true }] };
      }
      else if (path === '/destruction/destroyed-documents') body = page([{
        id: 'destroyed-1', code: 'HS-OLD', title: 'Destroyed', requestId: 'req-1', destroyedAt: stamp,
        checksumAtDestruction: 'a'.repeat(64), approvers: [], sizeBytes: 12, decisionNumber: 'QD-1'
      }]);
      else if (path === '/destruction/requests' && init.method === 'POST') {
        current = detail({ createdBy: options.user || user }); body = { id: 'req-1', status: 'pending', version: 1 };
      } else if (path === '/destruction/requests') body = page([current]);
      else if (path === '/destruction/requests/req-1') body = current;
      else if (path.endsWith('/otp-challenges')) body = { challengeId: 'otp-1', expiresAt: '2026-10-19T03:05:00Z', message: 'Use authenticator' };
      else if (path.endsWith('/approve')) { current = detail({ status: 'scheduled', version: 2, executeAfter: '2026-10-20T03:00:00Z', allowedActions: ['withdraw'] }); body = current; }
      else if (path.endsWith('/complete')) { current = detail({ status: 'completed', version: 2, allowedActions: [] }); body = current; }
      else throw new Error(`Unexpected API call: ${path}`);
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  };
  context.window.location = location;
  context.Auth.fetch = context.fetch;
  const app = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/app.js'), 'utf8');
  vm.runInNewContext(app.slice(app.indexOf('function repairMojibake('), app.indexOf('function normalizeUiText(')), context);
  vm.runInNewContext(app.slice(app.indexOf('function getDocumentId(doc)'), app.indexOf('async function loadDocumentDetail')), context);
  vm.runInNewContext(app.slice(app.indexOf('function normalizeSearchText('), app.indexOf('function flattenDocumentSearchValue(')), context);
  vm.runInNewContext(source, context, { filename: 'destruction.js' });
  await flush();
  const click = async (dataset, extra = {}) => {
    const button = Object.assign(new Element(dataset), extra);
    await events.click({ target: { closest: () => button } }); await flush();
  };
  return { get, events, calls, notices, tabs, click, context };
}

test('missing backend blocks creation and never reports destruction success', async () => {
  const env = await setup({ unavailable: true });
  assert.equal(env.tabs[1].disabled, true);
  assert.equal(env.get('create-submit').disabled, true);
  assert.match(env.get('service-status').textContent, /Backend/);
  assert.equal(env.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(env.notices.filter(notice => notice.type === 'success').length, 0);
});

for (const tab of ['requests', 'destroyed']) test(`${tab} loads before capabilities complete, once on startup`, async () => {
  let resolveCaps;
  const env = await setup({ search: `?view=${tab}`, respond: url => {
    if (new URL(url).pathname === '/destruction/capabilities') return new Promise(resolve => { resolveCaps = resolve; });
  } });
  const listPath = tab === 'destroyed' ? '/destruction/destroyed-documents' : '/destruction/requests';
  assert.equal(env.calls.filter(call => call.path === listPath).length, 1);
  assert.match(env.get(`${tab}-list`).innerHTML, tab === 'destroyed' ? /Destroyed/ : /HUY-1/);
  assert.equal(env.tabs[1].disabled, true);
  assert.equal(env.get('create-submit').disabled, true);
  // Details remain readable before capabilities and must not expose write actions.
  await env.click({ detail: 'req-1' });
  assert.match(env.get('request-detail').innerHTML, /HUY-1/);
  assert.doesNotMatch(env.get('request-detail').innerHTML, /data-action-form=/);
  resolveCaps(new Response(JSON.stringify(caps)));
  await flush();
  assert.equal(env.calls.filter(call => call.path === listPath).length, 1);
  assert.equal(env.get('destruction-wait-title').textContent, '2. Duyệt và chờ 24 giờ');
  assert.equal(env.tabs[1].disabled, false);
  assert.match(env.get('request-detail').innerHTML, /Chờ 24 giờ tính từ lượt duyệt cuối cùng/);
  assert.match(env.get('request-detail').innerHTML, /data-action-form="approve"/);
  assert.ok(env.calls.every(call => call.cache === 'no-store'));
});

for (const tab of ['requests', 'destroyed']) test(`${tab} stays readable when capabilities are disabled; writes stay blocked`, async () => {
  let resolveCaps;
  const env = await setup({ search: `?view=${tab}`, respond: url => {
    if (new URL(url).pathname === '/destruction/capabilities') return new Promise(resolve => { resolveCaps = resolve; });
  } });
  const listPath = tab === 'destroyed' ? '/destruction/destroyed-documents' : '/destruction/requests';
  const html = env.get(`${tab}-list`).innerHTML;
  resolveCaps(new Response(JSON.stringify({ enabled: false, unavailableReasons: ['SMTP chưa sẵn sàng', 'Scanner lỗi'] })));
  await flush();
  assert.equal(env.get(`${tab}-list`).innerHTML, html);
  assert.equal(env.calls.filter(call => call.path === listPath).length, 1);
  assert.equal(env.get('service-status').textContent, 'SMTP chưa sẵn sàng; Scanner lỗi');
  assert.equal(env.tabs[1].disabled, true);
  assert.equal(env.get('create-submit').disabled, true);
  env.get(`${tab}-filter`).listeners.submit({ preventDefault() {} }); await flush();
  assert.equal(env.calls.filter(call => call.path === listPath).length, 2);
  env.get('eligible-filter').listeners.submit({ preventDefault() {} }); await flush();
  assert.equal(env.calls.some(call => call.path === '/documents/search'), false);
  await env.click({ detail: 'req-1' });
  assert.doesNotMatch(env.get('request-detail').innerHTML, /data-action-form=/);
  const form = new Element({ actionForm: 'approve' });
  form.elements = { reviewed: { checked: true }, otp: { value: '123456' } };
  await env.click({ sendOtp: '' }, { hasAttribute: name => name === 'data-send-otp', closest: () => form });
  await env.get('request-detail').listeners.submit({ target: form, preventDefault() {} });
  await env.get('create-form').listeners.submit({ target: env.get('create-form'), preventDefault() {} });
  assert.equal(env.calls.some(call => call.method === 'POST'), false);
});

test('failed requests show diagnostics without inventing approval counts or retry actions', async () => {
  const failed = detail({ status: 'failed', allowedActions: [], failureReason: '<storage unavailable>', approvals: [{ userId: 'reviewer' }] });
  const env = await setup({ detail: failed });
  assert.match(env.get('requests-list').innerHTML, /1\/1 lượt duyệt/);
  assert.match(env.get('requests-list').innerHTML, /&lt;storage unavailable&gt;/);
  await env.click({ detail: 'req-1' });
  assert.match(env.get('request-detail').innerHTML, /Hủy chưa hoàn tất/);
  assert.match(env.get('request-detail').innerHTML, /&lt;storage unavailable&gt;/);
  assert.doesNotMatch(env.get('request-detail').innerHTML, /data-action-form=/);

  const missing = await setup({ detail: detail({ status: 'failed', approvals: undefined, requiredApprovals: undefined, allowedActions: [] }) });
  assert.match(missing.get('requests-list').innerHTML, /Chưa có đủ thông tin lượt duyệt/);
  assert.doesNotMatch(missing.get('requests-list').innerHTML, /0\/1 lượt duyệt/);
  await missing.click({ detail: 'req-1' });
  assert.match(missing.get('request-detail').innerHTML, /Chưa có nguyên nhân lỗi từ hệ thống/);
});

test('destroyed tab explains empty results and distinguishes API errors from an empty archive', async () => {
  const env = await setup({ detail: detail({ status: 'failed' }), respond: url => {
    if (new URL(url).pathname === '/destruction/destroyed-documents') return new Response(JSON.stringify(page([])));
  } });
  await env.tabs[2].listeners.click();
  assert.equal(env.get('panel-destroyed').hidden, false);
  assert.equal(env.get('panel-requests').hidden, true);
  assert.match(env.get('destroyed-list').innerHTML, /Chưa có hồ sơ được xác nhận hủy thành công/);
  assert.match(env.get('destroyed-list').innerHTML, /hủy lỗi không đồng nghĩa hồ sơ đã hủy/);
  env.get('destroyed-query').value = 'HS-unknown';
  env.get('destroyed-filter').listeners.submit({ preventDefault() {} }); await flush();
  assert.match(env.get('destroyed-list').innerHTML, /Không tìm thấy hồ sơ đã hủy khớp với từ khóa/);

  const broken = await setup({ search: '?view=destroyed', respond: url => {
    if (new URL(url).pathname === '/destruction/destroyed-documents') return new Response(JSON.stringify({ message: 'Service unavailable' }), { status: 503 });
  } });
  assert.match(broken.get('destroyed-list').innerHTML, /Service unavailable/);
  assert.doesNotMatch(broken.get('destroyed-list').innerHTML, /Chưa có hồ sơ/);
});

test('capabilities HTTP failure preserves the initial request list', async () => {
  const env = await setup({ unavailable: true });
  assert.match(env.get('requests-list').innerHTML, /HUY-1/);
  assert.equal(env.calls.filter(call => call.path === '/destruction/requests').length, 1);
  assert.equal(env.tabs[1].disabled, true);
});

test('waitHours accepts positive safe integers and rejects malformed values without hiding lists', async () => {
  for (const waitHours of [24, 36]) {
    const env = await setup({ caps: { waitHours } });
    assert.equal(env.get('destruction-wait-title').textContent, `2. Duyệt và chờ ${waitHours} giờ`);
    assert.equal(env.get('create-submit').disabled, false);
  }
  for (const waitHours of [0, -1, 1.5, '24', null, Number.MAX_SAFE_INTEGER + 1]) {
    const env = await setup({ caps: { waitHours } });
    assert.equal(env.get('create-submit').disabled, true);
    assert.match(env.get('service-status').textContent, /thiếu cấu hình/);
    assert.match(env.get('requests-list').innerHTML, /HUY-1/);
  }
});

test('ordinary users can submit only own uploads in their department and cannot approve', async () => {
  const actor = { id: 'ordinary', role: 'user', departmentId: 'dept-1' };
  const own = { ...doc, uploaderId: actor.id, departmentId: actor.departmentId };
  const env = await setup({ user: actor, detail: detail({ createdBy: actor }), search: '?view=create', documents: [
    own, { ...own, id: 'other-owner', uploaderId: 'other' },
    { ...own, id: 'other-dept', departmentId: 'dept-2' }, { ...doc, id: 'missing-owner' }
  ] });
  assert.equal(env.tabs[1].disabled, false);
  assert.equal(env.tabs[2].hidden, false);
  const html = env.get('eligible-list').innerHTML;
  assert.match(html, /data-select-document="doc-1"/);
  for (const id of ['other-owner', 'other-dept', 'missing-owner']) assert.ok(!html.includes(id));
  await env.click({ detail: 'req-1' });
  assert.match(env.get('request-detail').innerHTML, /Chứng từ lưu bất biến/);
  assert.doesNotMatch(env.get('request-detail').innerHTML, /data-action-form="(?:approve|reject|complete)"|data-send-otp/);
  const form = new Element({ actionForm: 'approve' });
  await env.get('request-detail').listeners.submit({ target: form, preventDefault() {} });
  assert.equal(env.calls.filter(call => call.method === 'POST').length, 0);
});

test('ordinary users cannot display another request; their archive is scoped by the server', async () => {
  const env = await setup({ user: { id: 'ordinary', role: 'user' }, search: '?view=destroyed' });
  assert.doesNotMatch(env.get('requests-list').innerHTML, /HUY-1/);
  await env.click({ detail: 'req-1' });
  assert.match(env.get('request-detail').innerHTML, /chỉ được xem yêu cầu/);
  assert.doesNotMatch(env.get('request-detail').innerHTML, /Chứng từ lưu bất biến/);
  await env.tabs[2].listeners.click();
  assert.equal(env.calls.filter(call => call.path === '/destruction/destroyed-documents').length, 2);
});

test('shared submit handler leaves managed destruction forms to their async handlers', () => {
  const app = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/app.js'), 'utf8');
  const managed = new Element(), ordinary = new Element();
  managed.hasAttribute = name => name === 'data-managed-loading';
  ordinary.hasAttribute = () => false;
  const context = { document: { querySelectorAll: () => [managed, ordinary] } };
  vm.runInNewContext(app.slice(app.indexOf('function _initButtonLoading()'), app.indexOf('/* ── Skeleton helpers')), context);
  context._initButtonLoading();
  assert.equal(managed.listeners.submit, undefined);
  ordinary.listeners.submit();
  assert.equal(ordinary.querySelector().classList.contains('loading'), true);
  const html = fs.readFileSync(require('node:path').join(__dirname, '../pages/destruction.html'), 'utf8');
  for (const name of ['requests-filter', 'eligible-filter', 'destroyed-filter', 'create-form']) {
    assert.match(html, new RegExp(`<form id="${name}"[^>]*data-managed-loading`));
  }
});

test('search clears loading on empty results and errors; an older response cannot stop a newer search', async () => {
  const pending = [];
  const env = await setup({ search: '?view=create', respond: url => {
    if (new URL(url).pathname === '/documents/search') {
      return new Promise(resolve => pending.push(resolve));
    }
  } });
  const form = env.get('eligible-filter'), button = form.querySelector();
  assert.equal(button.classList.contains('loading'), true);
  env.get('eligible-query').value = '  test  ';
  form.listeners.submit({ preventDefault() {} });
  await flush();
  const search = env.calls.filter(call => call.path === '/documents/search').at(-1);
  assert.equal(new URL(search.url).searchParams.get('limit'), '10000');
  pending[0](new Response(JSON.stringify(page([doc]))));
  await flush();
  assert.equal(button.classList.contains('loading'), true);
  pending[1](new Response(JSON.stringify(page([]))));
  await flush();
  assert.equal(button.classList.contains('loading'), false);
  assert.match(env.get('eligible-list').innerHTML, /Không tìm thấy hồ sơ khớp với từ khóa/);
  form.listeners.submit({ preventDefault() {} });
  await flush();
  assert.equal(button.classList.contains('loading'), true);
  pending[2](new Response(JSON.stringify({ message: 'Search failed' }), { status: 500 }));
  await flush();
  assert.equal(button.classList.contains('loading'), false);
  assert.match(env.get('eligible-list').innerHTML, /Search failed/);
});

test('warehouse search finds names without accents, codes and types, and allows proposing without expiry metadata', async () => {
  const candidate = { _id: 'candidate', title: 'Hồ sơ Điều dưỡng', code: 'HS-42', status: 'stored', documentType: { name: 'Bệnh án' } };
  const env = await setup({ search: '?view=create', documents: [candidate,
    { ...candidate, _id: 'held', legalHold: true },
    { ...candidate, _id: 'claimed', activeDestructionRequestId: 'req-2' },
    { ...candidate, _id: 'pending', status: 'pending' },
    { ...candidate, _id: 'destroyed', status: 'destroyed' }
  ] });
  const form = env.get('eligible-filter');
  for (const query of ['dieu duong', 'HS-42', 'benh an']) {
    env.get('eligible-query').value = query;
    form.listeners.submit({ preventDefault() {} }); await flush();
    const html = env.get('eligible-list').innerHTML;
    assert.match(html, /data-select-document="candidate"[^>]*\/>/);
    assert.doesNotMatch(html, /data-select-document="candidate"[^>]*disabled/);
    assert.match(html, /data-select-document="held"[^>]*disabled/);
    assert.match(html, /data-select-document="claimed"[^>]*disabled/);
    assert.doesNotMatch(html, /data-select-document="pending"|data-select-document="destroyed"/);
  }
  const checkbox = new Element({ selectDocument: 'candidate' }); checkbox.checked = true;
  env.events.change({ target: { closest: selector => selector === '[data-select-document]' ? checkbox : null } });
  assert.match(env.get('selection-count').textContent, /Đã chọn 1\/100/);
  env.get('eligible-query').value = 'khong trung';
  form.listeners.submit({ preventDefault() {} }); await flush();
  assert.match(env.get('eligible-list').innerHTML, /Không tìm thấy hồ sơ khớp/);
  assert.match(env.get('selection-count').textContent, /Đã chọn 1\/100/);
  assert.equal(env.calls.some(call => call.path === '/documents/search'), true);
  assert.equal(env.calls.some(call => call.path === '/destruction/eligible-documents'), false);
});

test('warehouse response formats normalize document IDs and reject malformed data', async () => {
  const candidate = { ...doc, id: undefined, documentId: 'warehouse-id' };
  for (const payload of [[candidate], { data: [candidate] }, { documents: [candidate] }, { items: [candidate] }]) {
    const env = await setup({ search: '?view=create', respond: url => {
      if (new URL(url).pathname === '/documents/search') return new Response(JSON.stringify(payload));
    } });
    assert.match(env.get('eligible-list').innerHTML, /data-select-document="warehouse-id"/);
  }
  const env = await setup({ search: '?view=create', respond: url => {
    if (new URL(url).pathname === '/documents/search') return new Response('{}');
  } });
  assert.match(env.get('eligible-list').innerHTML, /Dữ liệu hồ sơ trong kho từ backend không hợp lệ/);
  assert.doesNotMatch(env.get('eligible-list').innerHTML, /Không có hồ sơ đã duyệt/);
});

test('warehouse search filters before pagination and preserves selection between pages', async () => {
  const documents = Array.from({ length: 25 }, (_, i) => ({ ...doc, id: `doc-${i}`, title: `Hồ sơ ${i}` }));
  const env = await setup({ search: '?view=create', documents });
  assert.match(env.get('eligible-pagination').innerHTML, /Trang 1\/2 · 25 kết quả/);
  const checkbox = new Element({ selectDocument: 'doc-0' }); checkbox.checked = true;
  env.events.change({ target: { closest: selector => selector === '[data-select-document]' ? checkbox : null } });
  await env.click({ pageKind: 'eligible', page: '2' });
  assert.match(env.get('eligible-list').innerHTML, /data-select-document="doc-24"/);
  assert.doesNotMatch(env.get('eligible-list').innerHTML, /data-select-document="doc-0"/);
  await env.click({ pageKind: 'eligible', page: '1' });
  assert.match(env.get('eligible-list').innerHTML, /data-select-document="doc-0"[^>]*checked/);
  env.get('eligible-query').value = 'Hồ sơ 24';
  env.get('eligible-filter').listeners.submit({ preventDefault() {} }); await flush();
  assert.match(env.get('eligible-pagination').innerHTML, /Trang 1\/1 · 1 kết quả/);
});

for (const role of ['admin', 'user']) test(`${role} create form sends selected IDs and required PDF atomically; no self-approval is rendered`, async () => {
  const actor = { id: 'creator-1', role, departmentId: 'dept-1' };
  const documents = [doc, { ...doc, id: 'held', legalHold: true }].map(item => ({ ...item, uploaderId: actor.id, departmentId: actor.departmentId }));
  const env = await setup({ search: '?view=create', user: actor, documents });
  assert.match(env.get('eligible-list').innerHTML, /&lt;script&gt;/);
  if (role === 'admin') assert.match(env.get('eligible-list').innerHTML, /data-select-document="held"[^>]*disabled/);
  const checkbox = new Element({ selectDocument: 'doc-1' }); checkbox.checked = true;
  env.events.change({ target: { closest: selector => selector === '[data-select-document]' ? checkbox : null } });
  env.get('destruction-reason').value = 'Expired'; env.get('decision-number').value = 'QD-123'; env.get('decision-date').value = '2026-10-19';
  env.get('decision-file').files = [new File(['%PDF-1.7\nmock'], 'decision.pdf', { type: 'application/pdf' })];
  const form = env.get('create-form');
  await form.listeners.submit({ target: form, preventDefault() {} }); await flush();
  const call = env.calls.find(call => call.path === '/destruction/requests' && call.method === 'POST');
  assert.ok(call); assert.deepEqual(JSON.parse(call.body.get('documentIds')), ['doc-1']);
  assert.equal(call.body.get('decisionFile').name, 'decision.pdf');
  assert.equal(call.body.get('backupPolicyVersion'), 'v1'); assert.ok(call.headers['Idempotency-Key']);
  assert.equal(form.resetCalled, true);
  assert.match(env.get('request-detail').innerHTML, /Chứng từ lưu bất biến/);
  assert.doesNotMatch(env.get('request-detail').innerHTML, /data-action-form="approve"/);
});

test('invalid PDF never submits a request', async () => {
  const env = await setup({ search: '?view=create' });
  const checkbox = new Element({ selectDocument: 'doc-1' }); checkbox.checked = true;
  env.events.change({ target: { closest: selector => selector === '[data-select-document]' ? checkbox : null } });
  env.get('destruction-reason').value = 'Expired'; env.get('decision-number').value = 'QD-123'; env.get('decision-date').value = '2026-10-19';
  env.get('decision-file').files = [new File(['not a pdf'], 'fake.pdf', { type: 'application/pdf' })];
  const form = env.get('create-form'); await form.listeners.submit({ target: form, preventDefault() {} });
  assert.equal(env.calls.filter(call => call.path === '/destruction/requests' && call.method === 'POST').length, 0);
  assert.ok(env.notices.some(notice => notice.type === 'error' && /PDF/.test(notice.message)));
});

test('admin without approval permission sees the reason even when rejection is allowed', async () => {
  const env = await setup({ detail: detail({ allowedActions: ['reject', 'withdraw'] }) });
  await env.click({ detail: 'req-1' });
  const html = env.get('request-detail').innerHTML;
  assert.match(html, /Hệ thống chưa cấp quyền duyệt đề nghị này/);
  assert.match(html, /data-action-form="reject"/);
  assert.doesNotMatch(html, /data-action-form="approve"/);
});

test('department head without scope permission cannot request OTP or approve', async () => {
  const env = await setup({ user: { id: 'head-1', role: 'department_head' },
    detail: detail({ allowedActions: [] }) });
  await env.click({ detail: 'req-1' });
  assert.match(env.get('request-detail').innerHTML, /toàn bộ hồ sơ thuộc khoa mình/);
  assert.doesNotMatch(env.get('request-detail').innerHTML, /data-action-form="approve"/);
  const form = new Element({ actionForm: 'approve' });
  form.elements = { reviewed: { checked: true }, otp: { value: '123456' } };
  await env.click({ sendOtp: '' }, { hasAttribute: name => name === 'data-send-otp', closest: () => form });
  await env.get('request-detail').listeners.submit({ target: form, preventDefault() {} });
  assert.equal(env.calls.some(call => call.path.endsWith('/otp-challenges') || call.path.endsWith('/approve')), false);
});

test('approval notice distinguishes the author and an admin who already approved', async () => {
  const author = await setup({ detail: detail({ createdBy: user }) });
  await author.click({ detail: 'req-1' });
  assert.match(author.get('request-detail').innerHTML, /Bạn là người lập đề nghị này/);
  assert.doesNotMatch(author.get('request-detail').innerHTML, /data-action-form="approve"/);
  const approved = await setup({ detail: detail({ status: 'partially_approved', approvals: [{ userId: user.id }] }) });
  await approved.click({ detail: 'req-1' });
  assert.match(approved.get('request-detail').innerHTML, /Bạn đã duyệt đề nghị này/);
  assert.doesNotMatch(approved.get('request-detail').innerHTML, /data-action-form="approve"/);
});

for (const scenario of [
  { role: 'admin' }, { role: 'department_head' }, { role: 'department_head', ownUpload: true }
]) test(`${scenario.role}${scenario.ownUpload ? ' own normal upload' : ''} approval requires a challenge, sends OTP/version and displays the server schedule`, async () => {
  const actor = { ...user, role: scenario.role };
  const env = await setup({ user: actor, ...(scenario.ownUpload ? { detail: detail({ createdBy: actor }) } : {}) });
  await env.click({ detail: 'req-1' });
  assert.match(env.get('request-detail').innerHTML, /data-action-form="approve"/);
  const form = new Element({ actionForm: 'approve' }); form.elements = { reviewed: { checked: true }, otp: { value: '123456' } };
  await env.get('request-detail').listeners.submit({ target: form, preventDefault() {} });
  assert.equal(env.calls.filter(call => call.path.endsWith('/approve')).length, 0);
  await env.click({ sendOtp: '' }, { hasAttribute: name => name === 'data-send-otp', closest: () => form });
  form.elements.otp.value = '123456';
  await env.get('request-detail').listeners.submit({ target: form, preventDefault() {} }); await flush();
  const call = env.calls.find(call => call.path.endsWith('/approve'));
  assert.ok(call); assert.equal(call.headers['If-Match'], '"1"'); assert.ok(call.headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(call.body), { challengeId: 'otp-1', otp: '123456', documentsReviewed: true });
  assert.match(env.get('request-detail').innerHTML, /data-status="scheduled"/);
  assert.equal(env.calls.filter(call => /execute|destroy-file|delete/.test(call.path)).length, 0);
});

test('sensitive request uses server permissions for the remaining role and blocks self-approval', async () => {
  const sensitive = detail({ requiredApprovals: 2, status: 'partially_approved', approvals: [{ userId: 'other-admin' }] });
  const head = { id: 'head-1', role: 'department_head' };
  const remaining = await setup({ user: head, detail: sensitive });
  await remaining.click({ detail: 'req-1' });
  assert.match(remaining.get('request-detail').innerHTML, /data-action-form="approve"/);
  const secondAdmin = await setup({ detail: { ...sensitive, allowedActions: ['withdraw'] } });
  await secondAdmin.click({ detail: 'req-1' });
  assert.doesNotMatch(secondAdmin.get('request-detail').innerHTML, /data-action-form="approve"/);
  const author = await setup({ user: head, detail: { ...sensitive, createdBy: head } });
  await author.click({ detail: 'req-1' });
  assert.doesNotMatch(author.get('request-detail').innerHTML, /data-action-form="approve"/);
});

test('attachment names repair raw upload encoding before HTML escaping', async () => {
  const filename = '3. Tiểu đường_Hướng dẫn chẩn đoán và điều trị.pdf';
  const broken = Buffer.from(filename, 'utf8').toString('latin1');
  const twiceBroken = Buffer.from(broken, 'utf8').toString('latin1');
  const env = await setup({ detail: detail({ attachments: [filename, broken, twiceBroken, 'Quyết định <test>.pdf'].map((name, i) => ({
    id: `attachment-${i}`, type: 'decision', filename: name
  })) }) });
  await env.click({ detail: 'req-1' });
  const html = env.get('request-detail').innerHTML;
  assert.equal(html.split(filename).length - 1, 3);
  assert.match(html, /Quyết định &lt;test&gt;\.pdf/);
  assert.doesNotMatch(html, /Tiá|Æ°/);
});

test('attachment names use original or user-provided names without inventing filenames', async () => {
  const lost = '3. Tiá__u Ä_Æ_á__ng_HÆ_á__ng dáº_n cháº_n Ä_oÃ_n vÃ_ Ä_iá__u trá__.pdf';
  const env = await setup({ detail: detail({ attachments: [
    { id: 'lost', type: 'decision', filename: lost, displayName: 'Quyết định số 12.pdf' },
    { id: 'original', type: 'council_minutes', filename: lost, originalFilename: 'Biên bản họp hội đồng.pdf' },
    { id: 'unknown', type: 'other', filename: '\ufffd.pdf' },
    { id: 'titled', type: 'destruction_minutes', filename: lost, title: 'Biên bản hủy năm 2026' }
  ] }) });
  await env.click({ detail: 'req-1' });
  const html = env.get('request-detail').innerHTML;
  assert.match(html, /Quyết định số 12\.pdf/);
  assert.match(html, /Biên bản họp hội đồng\.pdf/);
  assert.match(html, /Biên bản hủy năm 2026/);
  assert.match(html, /Tên tệp chưa khả dụng/);
  assert.doesNotMatch(html, /Quyết định hủy\.pdf|Chứng từ\.pdf/);
  assert.doesNotMatch(html, /Tiá|Æ_|\ufffd/);
  assert.match(html, /data-preview="lost"/);
  assert.match(html, /data-download="lost"/);
});

test('closure requires minutes and backup notes and destroyed view exposes no file actions', async () => {
  const env = await setup({ detail: detail({ status: 'destroyed', allowedActions: ['complete'] }) });
  await env.click({ detail: 'req-1' }); assert.match(env.get('request-detail').innerHTML, /data-action-form="complete"/);
  const form = new Element({ actionForm: 'complete' });
  form.elements = { backupNotes: { value: 'External/cloud/NAS: pending expiry per policy' }, minutes: { files: [new File(['%PDF-1.7\nmock'], 'minutes.pdf', { type: 'application/pdf' })] } };
  await env.get('request-detail').listeners.submit({ target: form, preventDefault() {} }); await flush();
  const call = env.calls.find(call => call.path.endsWith('/complete'));
  assert.ok(call); assert.equal(call.body.get('destructionMinutesFile').name, 'minutes.pdf');
  assert.match(call.body.get('backupDispositionNotes'), /NAS/);
  await env.tabs[2].listeners.click(); await flush();
  assert.match(env.get('destroyed-list').innerHTML, /Destroyed/);
  assert.doesNotMatch(env.get('destroyed-list').innerHTML, /data-preview|data-download|storagePath|downloadDoc|previewDoc/);
});
