const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/app.js', 'utf8');
const context = { Auth: { getUser: () => ({ id: 'me', email: 'me@example.test', fullName: 'Nguyen Van A' }) } };
vm.runInNewContext(source.slice(source.indexOf('function isUploadedByCurrentUser('), source.indexOf('function canAccessDocumentSecurity(')), context);
const owns = context.isUploadedByCurrentUser;

test('personal documents match uploader IDs in supported API shapes', () => {
  for (const uploader of [{ uploader: { id: 'me' } }, { uploaderId: 'me' }, { uploadedBy: { _id: 'me' } }, { uploader_id: 'me' }]) {
    for (const status of ['pending', 'stored', 'rejected']) assert.equal(owns({ ...uploader, status }), true);
  }
  assert.equal(owns({ uploaderId: 42 }, { id: '42' }), true);
  assert.equal(owns({ uploader: { _id: { $oid: 'me' } } }), true);
});

test('names, authors and stale email cannot claim another uploader document', () => {
  assert.equal(owns({ uploader: { id: 'other', fullName: 'Nguyen Van A', email: 'me@example.test' } }), false);
  assert.equal(owns({ author: { id: 'me' }, uploader: { id: 'other' } }), false);
  assert.equal(owns({ uploader: { fullName: 'Nguyen Van A' } }), false);
  assert.equal(owns({ uploaderId: 'other', uploadedBy: { id: 'me' } }), false);
  assert.equal(owns({ uploaderId: 'other', uploader: { id: 'other', email: 'me@example.test' } }), false);
});

test('missing identity fails closed and legacy uploader email is case insensitive', () => {
  assert.equal(owns({}), false);
  assert.equal(owns({ uploaderId: 'me' }, null), false);
  assert.equal(owns({ uploader: { email: ' ME@EXAMPLE.TEST ' } }), true);
  assert.equal(owns({ uploader: { email: 'other@example.test' } }), false);
  assert.equal(owns({ uploader: { id: {} } }, { id: {} }), false);
});

test('dashboard includes own submissions and approved shared files, excluding others pending submissions', async () => {
  const html = fs.readFileSync('pages/dashboard.html', 'utf8');
  const start = html.indexOf('  async function loadDashboard()');
  const end = html.indexOf('  onPageReady(loadDashboard);', start);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', classList: { add() {}, remove() {} }, addEventListener() {} });
    return elements.get(id);
  };
  const pending = { id: 'own-pending', uploader: { id: 'me' }, title: 'Own pending', status: 'pending' };
  const stored = { id: 'own-stored', uploaderId: 'me', title: 'Own stored', status: 'stored' };
  const shared = [
    { id: 'public-stored', uploaderId: 'other', title: 'Shared public', status: 'stored', visibility: 'public', departmentId: 'other-department' },
    { id: 'internal-approved', uploaderId: 'other', title: 'Shared internal', status: 'approved', visibility: 'department', departmentId: 'my-department' }
  ];
  const rejected = { id: 'own-rejected', uploaderId: 'me', title: 'Own rejected', status: 'rejected' };
  const env = {
    URLSearchParams, isUploadedByCurrentUser: owns,
    Auth: { currentUserId: () => 'me' }, document: { getElementById: element },
    api: { get: async route => {
      assert.equal(new URLSearchParams(route.split('?')[1]).has('uploaderId'), false);
      return { data: [pending, stored, rejected, ...shared, { id: 'other', uploaderId: 'other', title: 'Other pending', status: 'pending' }, { id: 'other-rejected', uploaderId: 'other', title: 'Other rejected', status: 'rejected' }] };
    } },
    skeletonCards: () => '', loadViewStatusMap: async () => new Map(),
    renderRetentionBanner(docs) { assert.deepEqual(Array.from(docs, d => d.id), ['own-pending', 'own-stored', 'own-rejected', 'public-stored', 'internal-approved']); },
    esc: value => value || '', displayDocTitle: d => d.title, fmtDate: () => '', fmtSize: () => '',
    statusBadge: () => '', getDocumentId: d => d.id, canViewFromStatus: () => false,
    Toast: { error: message => assert.fail(message) }
  };
  vm.runInNewContext(html.slice(start, end), env);
  await env.loadDashboard();
  assert.equal(element('stat-total').textContent, 5);
  assert.equal(element('stat-pending').textContent, 1);
  assert.equal(element('stat-stored').textContent, 3);
  assert.equal(element('stat-rejected').textContent, 1);
  assert.match(element('recent-docs').innerHTML, /Own pending/);
  assert.match(element('recent-docs').innerHTML, /Own rejected/);
  assert.match(element('recent-docs').innerHTML, /Shared public/);
  assert.match(element('recent-docs').innerHTML, /Shared internal/);
  assert.doesNotMatch(element('recent-docs').innerHTML, /Other pending|Other rejected/);
});
