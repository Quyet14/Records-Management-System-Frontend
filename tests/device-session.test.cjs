const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createDeviceSession } = require('../assets/js/device-session.js');
const origin = 'https://hospital.test';
const profile = { id: 'admin-1', role: 'admin', fullName: 'Người dùng' };
const payload = token => ({ access_token: token, user: profile, expires_in: 1200 });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

for (const status of [403, 429, 500, 503]) test(`HTTP ${status} preserves the session without refresh or OTP`, async () => {
  let calls = 0;
  const auth = make({ fetch: async request => { calls++; assert.ok(request instanceof Request); return json({ message: 'Failure' }, status); },
    onUnauthorized() { assert.fail('Must keep session'); }, onRecentAuth() { assert.fail('Must not request OTP'); } });
  auth.setSession('current', profile, 1200);
  assert.equal((await auth.fetch(origin + '/documents')).status, status);
  assert.equal(calls, 1); assert.equal(auth.getToken(), 'current');
});

test('recent authentication coalesces OTP and retries pending mutations with the same body and key', async () => {
  let challenges = 0;
  const sent = [];
  const auth = make({ fetch: async request => {
    assert.ok(request instanceof Request, 'Must not refresh instead of OTP');
    sent.push({ token: request.headers.get('Authorization'), key: request.headers.get('Idempotency-Key'), body: await request.text() });
    return request.headers.get('Authorization') === 'Bearer old'
      ? json({ code: 'RECENT_AUTH_REQUIRED' }, 403) : json({ ok: true });
  }, onRecentAuth: async actor => { challenges++; assert.deepEqual(actor, profile); await flush(); auth.setSession('recent', profile, 1200); } });
  auth.setSession('old', profile, 1200);
  const results = await Promise.all([1, 2].map(i => auth.fetch(origin + '/users/' + i, {
    method: 'PATCH', headers: { 'Idempotency-Key': 'key-' + i }, body: 'body-' + i
  })));
  assert.ok(results.every(response => response.ok)); assert.equal(challenges, 1);
  for (const i of [1, 2]) assert.equal(sent.filter(item => item.key === 'key-' + i && item.body === 'body-' + i).length, 2);
});

test('cancelled recent authentication leaves the mutation unsent and session intact', async () => {
  let calls = 0;
  const auth = make({ fetch: async () => { calls++; return json({ code: 'RECENT_AUTH_REQUIRED' }, 403); },
    onRecentAuth: async () => { throw new Error('Cancelled'); } });
  auth.setSession('current', profile, 1200);
  await assert.rejects(auth.fetch(origin + '/users/1', { method: 'PATCH', body: '{}' }), /Cancelled/);
  assert.equal(calls, 1); assert.equal(auth.getToken(), 'current');
});

test('recent authentication retry stops after one attempt if the server still requires OTP', async () => {
  let calls = 0, challenges = 0;
  const auth = make({ fetch: async () => { calls++; return json({ code: 'RECENT_AUTH_REQUIRED' }, 403); },
    onRecentAuth: async () => { challenges++; } });
  auth.setSession('current', profile, 1200);
  assert.equal((await auth.fetch(origin + '/users/1')).status, 403);
  assert.equal(calls, 2); assert.equal(challenges, 1);
});
function mutex() {
  let queue = Promise.resolve();
  return { request: (_name, work) => { const next = queue.then(work, work); queue = next.catch(() => {}); return next; } };
}
function make(options = {}) { return createDeviceSession({ apiUrl: origin, locks: mutex(), ...options }); }
async function flush() { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); }

test('bootstrap refresh uses cookie only, removes legacy keys, stores credentials only in memory', async () => {
  const values = new Map([['lths_token', 'legacy'], ['lths_user', '{}'], ['lths_refresh_token', 'old'], ['lths_dark', '1']]);
  const storage = { removeItem: key => values.delete(key), setItem() { assert.fail('Credentials must not be persisted'); } };
  let calls = 0;
  const auth = make({ storages: [storage], fetch: async (input, init) => {
    calls++; assert.equal(input, origin + '/auth/refresh');
    assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store'); assert.equal(init.body, undefined);
    return json(payload('access-1'));
  } });
  assert.equal(auth.getToken(), null);
  await auth.ensureAccess();
  assert.equal(auth.getToken(), 'access-1'); assert.deepEqual(auth.getUser(), profile);
  await auth.ensureAccess(); assert.equal(calls, 1);
  assert.deepEqual([...values], [['lths_dark', '1']]);
});

test('refresh falls back to the legacy cookie endpoint when the primary route is unavailable', async () => {
  const calls = [];
  const auth = make({ fetch: async input => {
    calls.push(input);
    return input.endsWith('/auth/refresh')
      ? json({}, 404)
      : json(payload('fallback-token'));
  } });
  await auth.ensureAccess();
  assert.deepEqual(calls, [origin + '/auth/refresh', origin + '/auth/refresh-token']);
  assert.equal(auth.getToken(), 'fallback-token');
});

test('refresh coalesces within a tab and serializes rotating cookies across two tabs', async () => {
  const locks = mutex(); let active = 0, peak = 0, rotations = 0;
  const fetch = async () => {
    active++; peak = Math.max(peak, active); const rotation = ++rotations;
    await flush(); active--;
    return json(payload(`access-${rotation}`));
  };
  const a = make({ locks, fetch }), b = make({ locks, fetch });
  await Promise.all([a.ensureAccess(), a.ensureAccess(), a.ensureAccess(), b.ensureAccess(), b.ensureAccess()]);
  assert.equal(rotations, 2); assert.equal(peak, 1);
  assert.equal(a.getToken(), 'access-1'); assert.equal(b.getToken(), 'access-2');
});

test('one 401 refresh and retry preserves request body, bearer and no-store', async () => {
  let rotations = 0; const sent = [];
  const auth = make({ fetch: async (input) => {
    if (typeof input === 'string') { rotations++; return json(payload('new')); }
    sent.push({ authorization: input.headers.get('Authorization'), body: await input.text(), cache: input.cache });
    return sent.length === 1 ? json({}, 401) : json({ ok: true });
  } });
  auth.setSession('old', profile, 1200);
  const response = await auth.fetch(origin + '/destruction/requests', { method: 'POST', body: 'same-body', headers: { 'Idempotency-Key': 'same-key' } });
  assert.equal(response.status, 200); assert.equal(rotations, 1);
  assert.deepEqual(sent.map(item => item.body), ['same-body', 'same-body']);
  assert.deepEqual(sent.map(item => item.authorization), ['Bearer old', 'Bearer new']);
  assert.ok(sent.every(item => item.cache === 'no-store'));
});

test('parallel 401 responses use the newer token instead of rotating again', async () => {
  let rotations = 0, requestCount = 0;
  const auth = make({ fetch: async input => {
    if (typeof input === 'string') { rotations++; await flush(); return json(payload('new')); }
    requestCount++;
    if (input.headers.get('Authorization') === 'Bearer old') return json({}, 401);
    return json({ ok: true });
  } });
  auth.setSession('old', profile, 1200);
  await Promise.all([auth.fetch(origin + '/one'), auth.fetch(origin + '/two'), auth.fetch(origin + '/three')]);
  assert.equal(rotations, 1); assert.equal(requestCount, 6);
});

test('second 401 stops retry, clears state and notifies the caller', async () => {
  let redirects = 0, refreshes = 0, reads = 0;
  const auth = make({ onUnauthorized: () => redirects++, fetch: async input => {
    if (typeof input === 'string') { refreshes++; return json(payload('new')); }
    reads++; return json({}, 401);
  } });
  auth.setSession('old', profile, 1200);
  assert.equal((await auth.fetch(origin + '/documents')).status, 401);
  assert.equal(refreshes, 1); assert.equal(reads, 2); assert.equal(redirects, 1); assert.equal(auth.getToken(), null);
});

test('refresh 401 requires OTP; network and server failures preserve state and never trigger OTP', async () => {
  for (const status of [401, 503, 'network']) {
    let redirects = 0;
    const auth = make({ onUnauthorized: () => redirects++, fetch: async () => {
      if (status === 'network') throw new Error('offline'); return json({ message: 'Unavailable' }, status);
    } });
    auth.setSession('existing', profile, 1200);
    await assert.rejects(auth.refreshSession());
    assert.equal(redirects, status === 401 ? 1 : 0);
    assert.equal(auth.getToken(), status === 401 ? null : 'existing');
  }
});

test('expiry refresh is proactive and temporary failures can be retried without OTP', async () => {
  let count = 0;
  const auth = make({ fetch: async () => { count++; return count === 1 ? json({}, 503) : json(payload('refreshed')); } });
  auth.setSession('expires-soon', profile, 30);
  await assert.rejects(auth.ensureAccess());
  await auth.ensureAccess(); assert.equal(count, 2); assert.equal(auth.getToken(), 'refreshed');
});

test('login, OTP and CAPTCHA requests include credentials but do not refresh or retry automatically', async () => {
  const calls = [];
  const auth = make({ fetch: async (input, init) => {
    const request = typeof input === 'string' ? new Request(input, init) : input;
    calls.push(request); return json({}, 401);
  } });
  await auth.fetch(origin + '/auth/login', { method: 'POST', body: JSON.stringify({ email: 'staff@test', password: 'test-password', captcha_id: 'c', captcha_code: '123456' }) });
  await auth.fetch(origin + '/auth/verify-otp', { method: 'POST', body: JSON.stringify({ user_id: 'u', otp: '123456' }) });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(request => request.credentials === 'include' && request.cache === 'no-store'));
  assert.equal(calls[1].url, origin + '/auth/verify-otp');
});

test('logout revokes server session before clearing memory; failures are not disguised as success', async () => {
  let auth, status = 503; const messages = [];
  auth = make({ channel: { postMessage: message => messages.push(message) }, fetch: async (url, init) => {
    assert.equal(url, origin + '/auth/logout'); assert.equal(init.method, 'POST'); assert.equal(auth.getToken(), 'existing');
    return status === 204 ? new Response(null, { status }) : json({}, status);
  } });
  auth.setSession('existing', profile, 1200);
  await assert.rejects(auth.logout()); assert.equal(auth.getToken(), 'existing');
  status = 204; await auth.logout(); assert.equal(auth.getToken(), null); assert.deepEqual(messages, [{ type: 'logout' }]);
});

test('foreign URLs cannot receive the account bearer; protected auth endpoints do receive it', async () => {
  const calls = [];
  const auth = make({ fetch: async input => { calls.push(input); return json({}); } });
  auth.setSession('access', profile, 1200);
  await auth.fetch('https://files.test/signed.pdf', { headers: { Authorization: 'Bearer stale' } });
  await auth.fetch(origin + '/auth/force-change-password', { method: 'POST' });
  assert.equal(calls[0].headers.has('Authorization'), false); assert.equal(calls[0].credentials, 'omit');
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer access');
});

test('SharedWorker fallback serializes real worker fetches for two tabs', async () => {
  let active = 0, peak = 0, count = 0;
  const context = vm.createContext({ URL, Promise, onconnect: null, fetch: async (url, init) => {
    assert.equal(init.credentials, 'include'); active++; peak = Math.max(peak, active); count++;
    await flush(); active--; return json(payload(`access-${count}`));
  } });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../assets/js/auth-cookie-worker.js'), 'utf8'), context);
  class SharedWorker {
    constructor() {
      const client = { start() {}, postMessage: data => server.onmessage({ data }) };
      const server = { start() {}, postMessage: data => client.onmessage({ data }) };
      this.port = client; context.onconnect({ ports: [server] });
    }
  }
  const a = make({ locks: null, SharedWorker }), b = make({ locks: null, SharedWorker });
  await Promise.all([a.ensureAccess(), b.ensureAccess()]);
  assert.equal(count, 2); assert.equal(peak, 1); assert.ok(a.getToken()); assert.ok(b.getToken());
});

test('lack of a cross-tab queue fails closed without rotating cookie', async () => {
  const auth = make({ locks: null, fetch: () => assert.fail('No uncoordinated refresh') });
  await assert.rejects(auth.ensureAccess(), /Web Locks/);
});

test('logout-all includes the current bearer and cookie through the serialized queue', async () => {
  const auth = make({ fetch: async (url, init) => {
    assert.equal(url, origin + '/auth/logout-all');
    assert.equal(init.headers.Authorization, 'Bearer current');
    assert.equal(init.credentials, 'include');
    return new Response(null, { status: 204 });
  } });
  auth.setSession('current', profile, 1200);
  await auth.logoutAll(); assert.equal(auth.getUser(), null);
});

test('API prefix keeps cookie bootstrap and protected requests on the configured base', async () => {
  const calls = [];
  const auth = make({ apiUrl: origin + '/api', fetch: async (input, init) => {
    calls.push(typeof input === 'string' ? input : input.url);
    return typeof input === 'string' ? json(payload('prefix')) : json({});
  } });
  await auth.fetch(origin + '/api/documents');
  assert.deepEqual(calls, [origin + '/api/auth/refresh', origin + '/api/documents']);
});

test('stream request body is cloned before sending and survives a 401 retry', async () => {
  const bodies = [];
  const auth = make({ fetch: async input => {
    if (typeof input === 'string') return json(payload('new'));
    bodies.push(await input.text()); return json({}, bodies.length === 1 ? 401 : 200);
  } });
  auth.setSession('current', profile, 1200);
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('stream-body')); controller.close(); } });
  await auth.fetch(origin + '/documents', { method: 'POST', body, duplex: 'half' });
  assert.deepEqual(bodies, ['stream-body', 'stream-body']);
});
