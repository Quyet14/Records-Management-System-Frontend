const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/devices.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
async function setup(options = {}) {
  const elements = new Map(), calls = [];
  let cleared = false;
  const get = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', listeners: {}, addEventListener(name, work) { this.listeners[name] = work; } });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: get, querySelectorAll: () => [] },
    window: { location: { href: '' } }, _pagesRoot: () => '/pages/',
    esc: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    api: {
      get: async route => { calls.push(['GET', route]); if (options.failure) throw new Error('Service unavailable'); return { sessions: [
        { id: 'current', isCurrent: true, userAgent: 'My browser' }, { id: 'other', userAgent: '<script>untrusted</script>' }
      ] }; },
      del: async route => { calls.push(['DELETE', route]); if (options.deleteFailure) throw new Error('Denied'); }
    },
    Auth: { require: async () => {}, clear: () => { cleared = true; }, logoutAll: async () => {
      calls.push(['POST', '/auth/logout-all']); if (options.logoutFailure) throw new Error('Service unavailable'); cleared = true;
    } }, onPageReady: work => work(), Date
  };
  vm.runInNewContext(source, context); await flush();
  return { get, calls, context, cleared: () => cleared, revoke: async id => {
    get('sessions-list').listeners.click({ target: { closest: () => ({ dataset: { revoke: id } }) } }); await flush();
  } };
}
test('device list escapes labels and revokes another device without clearing the current session', async () => {
  const env = await setup();
  assert.match(env.get('sessions-list').innerHTML, /&lt;script>/);
  await env.revoke('other');
  assert.ok(env.calls.some(([method, route]) => method === 'DELETE' && route === '/auth/sessions/other'));
  assert.equal(env.cleared(), false); assert.equal(env.context.window.location.href, '');
});
test('revoking the current device clears local session after server success', async () => {
  const env = await setup(); await env.revoke('current');
  assert.equal(env.cleared(), true); assert.equal(env.context.window.location.href, '/pages/login.html');
});
test('failed revocation preserves session and displays the API error', async () => {
  const env = await setup({ deleteFailure: true }); await env.revoke('current');
  assert.equal(env.cleared(), false); assert.equal(env.get('sessions-status').textContent, 'Denied');
});
test('device listing failure shows an error and supports retry', async () => {
  const options = { failure: true }, env = await setup(options);
  assert.match(env.get('sessions-status').textContent, /Service unavailable/);
  options.failure = false;
  await env.get('sessions-reload').listeners.click(); await flush();
  assert.match(env.get('sessions-list').innerHTML, /My browser/);
});
test('logout-all only redirects after successful server revocation', async () => {
  const options = { logoutFailure: true }, env = await setup(options);
  await env.get('sessions-logout-all').listeners.click(); await flush();
  assert.equal(env.cleared(), false); assert.equal(env.context.window.location.href, '');
  options.logoutFailure = false;
  await env.get('sessions-logout-all').listeners.click(); await flush();
  assert.equal(env.cleared(), true); assert.equal(env.context.window.location.href, '/pages/login.html');
});
