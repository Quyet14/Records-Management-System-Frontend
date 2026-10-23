const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('assets/js/app.js', 'utf8');
const helper = app.slice(app.indexOf('// Pending queue helpers:'), app.indexOf('// End pending queue helpers.'));
function service(get) {
  const context = { window: {}, api: { get }, document: { getElementById: () => null } };
  vm.runInNewContext(helper, context);
  return context.window.PendingQueue;
}
test('queue count uses total=49 instead of the first-page length=20', async () => {
  const calls = [];
  const queue = service(async path => { calls.push(path); return { data: [{ id: 'a' }], total: 49, page: 1, limit: 1 }; });
  assert.equal(await queue.count(), 49);
  assert.deepEqual(calls, ['/documents/pending?page=1&limit=1']);
});
test('pending pagination exposes all 49 documents in pages of 20, 20 and 9', async () => {
  const docs = Array.from({ length: 49 }, (_, id) => ({ id: String(id) }));
  const queue = service(async path => { const url = new URL(path, 'http://test'); const page = Number(url.searchParams.get('page')), limit = Number(url.searchParams.get('limit')); return { data: docs.slice((page - 1) * limit, page * limit), total: 49, page, limit }; });
  const pages = await Promise.all([1, 2, 3].map(page => queue.load(page)));
  assert.deepEqual(pages.map(page => page.data.length), [20, 20, 9]);
  assert.equal(new Set(pages.flatMap(page => page.data.map(doc => doc.id))).size, 49);
});
test('empty queue is zero and denied counts never fall back to global search', async () => {
  assert.equal(await service(async () => ({ data: [], total: 0, page: 1, limit: 1 })).count(), 0);
  const calls = [];
  await assert.rejects(service(async path => { calls.push(path); throw Object.assign(Error('Forbidden'), { status: 403 }); }).count(), error => error.status === 403);
  assert.deepEqual(calls, ['/documents/pending?page=1&limit=1']);
});
test('invalid pagination and malformed totals are rejected', async () => {
  const queue = service(async () => assert.fail('Invalid query must not be sent'));
  for (const page of [0, -1, 1.5]) await assert.rejects(queue.load(page));
  for (const limit of [0, 101]) await assert.rejects(queue.load(1, limit));
  for (const payload of [{ data: [], total: '49', page: 1, limit: 20 }, { data: [{ id: 1 }], total: 0, page: 1, limit: 20 }, { data: [], total: 49, page: 2, limit: 20 }]) assert.throws(() => queue.normalize(payload));
});
test('pager shows server total and navigates between pages with correct boundaries', () => {
  const queue = service();
  const buttons = { '[data-queue-prev]': {}, '[data-queue-next]': {} };
  const element = { innerHTML: '', querySelector: key => buttons[key] };
  const visited = [];
  queue.renderPager(element, { data: Array(20).fill({}), total: 49, page: 1, limit: 20 }, page => visited.push(page));
  assert.ok(element.innerHTML.includes("1–20 / 49"));
  buttons['[data-queue-prev]'].onclick(); buttons['[data-queue-next]'].onclick();
  assert.deepEqual(visited, [2]);
  queue.renderPager(element, { data: Array(9).fill({}), total: 49, page: 3, limit: 20 }, page => visited.push(page));
  assert.ok(element.innerHTML.includes("41–49 / 49"));
  buttons['[data-queue-next]'].onclick(); buttons['[data-queue-prev]'].onclick();
  assert.deepEqual(visited, [2, 2]);
});
test('queue scripts parse and wire totals, last-page recovery and mutation reloads', () => {
  for (const role of ['admin', 'dept-head']) {
    const html = fs.readFileSync('pages/' + role + '/queue.html', 'utf8');
    for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script);
    assert.match(html, /PendingQueue.load\(page\)/);
    assert.match(html, /PendingQueue.sync\(res.total\)/);
    assert.match(html, /if \(page > last\) return loadQueue\(last\)/);
    assert.match(html, /await loadQueue\(\)/);
    assert.doesNotMatch(html, /const remaining = document.querySelectorAll\('\.queue-card'\)\.length/);
  }
});
