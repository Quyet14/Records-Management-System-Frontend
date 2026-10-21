const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8');
const helpers = app.slice(app.indexOf('function apiError('), app.indexOf('async function uploadWithProgress('));

test('PDF view uses the server view URL unchanged, without login bearer, cookies or referrer', async () => {
  const calls = [], signed = 'https://files.test/documents/doc-1/view?token=purpose-limited';
  const context = { URL, API: 'https://api.test', api: { get: async route => {
    calls.push(route); return { url: signed, expiresIn: 120, expiresAt: new Date(Date.now() + 120000).toISOString() };
  } }, window: { fetch: async (url, init) => {
    assert.equal(url, signed); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store');
    assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.headers, undefined);
    return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } });
  } } };
  vm.runInNewContext(helpers, context);
  assert.equal((await context.fetchDocumentView('doc-1')).status, 200);
  assert.deepEqual(calls, ['/documents/doc-1/view-url']);
});

test('denied view URL never falls back to download or a storage path', async () => {
  let calls = 0;
  const context = { URL, API: 'https://api.test', api: { get: async route => {
    calls++; assert.equal(route, '/documents/doc-1/view-url'); throw Object.assign(new Error('Denied'), { status: 403 });
  } }, window: { fetch() { assert.fail('No file fetch after access denied'); } } };
  vm.runInNewContext(helpers, context);
  await assert.rejects(context.fetchDocumentView('doc-1'), error => error.status === 403);
  assert.equal(calls, 1);
});

test('HTTP errors retain status, backend code and retry delay', () => {
  const context = {}; vm.runInNewContext(helpers, context);
  for (const status of [401, 403, 429, 500, 503]) {
    const error = context.apiError(new Response(null, { status, headers: { 'Retry-After': '60' } }), { code: 'SERVER_CODE' });
    assert.equal(error.status, status); assert.equal(error.code, 'SERVER_CODE'); assert.equal(error.retryAfter, '60');
    assert.ok(error.message && !error.message.startsWith('HTTP'));
  }
});
