/* Access credentials live only in this closure. Refresh credentials are HttpOnly cookies. */
(function (root) {
  'use strict';
  function createDeviceSession(options) {
    const nativeFetch = options.fetch;
    const base = new URL(options.apiUrl);
    const prefix = base.pathname.replace(/\/$/, '');
    let token = null, user = null, expiresAt = 0, refreshPromise = null;
    let worker = null, sequence = 0, generation = 0, recentAuthPromise = null;
    const pending = new Map();
    const legacyKeys = ['lths_token', 'lths_user', 'lths_refresh_token', 'lths_refresh', 'refresh_token', 'lths_access_token', 'lths_refresh_expires_at', 'lths_navigation_shell'];
    for (const storage of options.storages || []) {
      for (const key of legacyKeys) { try { storage.removeItem(key); } catch (_) {} }
    }
    function clear() { token = null; user = null; expiresAt = 0; generation++; options.onChange?.(null); }
    function setSession(accessToken, currentUser, expiresIn) {
      if (typeof accessToken !== 'string' || !accessToken || !currentUser?.role
        || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('Phản hồi phiên đăng nhập không hợp lệ.');
      token = accessToken; user = currentUser; expiresAt = Date.now() + expiresIn * 1000;
      generation++;
      options.onChange?.(user);
    }
    function cookieRequest(path, init = {}) {
      const url = base.origin + prefix + path;
      const request = { ...init, credentials: 'include', cache: 'no-store' };
      if (options.locks?.request) return options.locks.request('lths-auth-cookie', () => nativeFetch(url, request));
      if (!options.SharedWorker) return Promise.reject(new Error('Trình duyệt cần hỗ trợ Web Locks hoặc SharedWorker để duy trì phiên an toàn.'));
      if (!worker) {
        worker = new options.SharedWorker(options.workerUrl, { name: 'lths-auth-cookie' });
        worker.port.onmessage = ({ data }) => {
          const job = pending.get(data.id); if (!job) return;
          pending.delete(data.id);
          if (data.error) job.reject(new Error(data.error));
          else job.resolve(new Response(data.status === 204 ? null : JSON.stringify(data.body), { status: data.status, headers: { 'Content-Type': 'application/json' } }));
        };
        worker.onerror = () => { for (const job of pending.values()) job.reject(new Error('Không thể phối hợp phiên giữa các tab.')); pending.clear(); worker = null; };
        worker.port.start();
      }
      return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); worker.port.postMessage({ id, url, init: request }); });
    }
    async function readError(response) {
      const body = await response.json().catch(() => ({}));
      const fallback = { 403: 'Bạn không có quyền thực hiện thao tác này.', 429: 'Có quá nhiều yêu cầu. Vui lòng chờ rồi thử lại.',
        500: 'Máy chủ gặp lỗi. Vui lòng thử lại sau.', 503: 'Dịch vụ tạm thời không sẵn sàng. Vui lòng thử lại sau.' };
      const error = new Error(Array.isArray(body?.message) ? body.message.join('; ') : body?.message || fallback[response.status] || `HTTP ${response.status}`);
      error.status = response.status; error.code = body?.code || body?.error?.code;
      error.retryAfter = response.headers.get('Retry-After'); return error;
    }
    function refreshSession() {
      if (!refreshPromise) {
        const started = generation;
        refreshPromise = (async () => {
          let response = await cookieRequest('/auth/refresh', { method: 'POST' });
          if (response.status === 404 || response.status === 405) {
            await response.body?.cancel();
            response = await cookieRequest('/auth/refresh-token', { method: 'POST' });
          }
          if (response.status === 401) { clear(); options.onUnauthorized?.(); const error = new Error('Vui lòng đăng nhập lại.'); error.status = 401; throw error; }
          if (!response.ok) throw await readError(response);
          const payload = await response.json();
          const data = payload.data ?? payload;
          if (started !== generation) throw new Error('Phiên đăng nhập đã thay đổi. Vui lòng thử lại.');
          setSession(data.access_token, data.user, data.expires_in);
          return user;
        })().finally(() => { refreshPromise = null; });
      }
      return refreshPromise;
    }
    async function ensureAccess() {
      if (!token || Date.now() >= expiresAt - 60000) await refreshSession();
      return user;
    }
    async function request(input, init = {}) {
      const original = new Request(input, init);
      const url = new URL(original.url);
      if (url.origin !== base.origin || (prefix && !url.pathname.startsWith(prefix + '/'))) {
        const headers = new Headers(original.headers); headers.delete('Authorization');
        return nativeFetch(new Request(original, { headers, credentials: 'omit' }));
      }
      const route = url.pathname.slice(prefix.length);
      const publicAuth = ['/auth/captcha', '/auth/login', '/auth/verify-otp', '/auth/verify-totp', '/auth/refresh', '/auth/refresh-token', '/auth/logout', '/auth/complete-login', '/auth/confirm-login', '/auth/forgot-password', '/auth/reset-password', '/auth/reset-password/verify-otp'].includes(route)
        || route.startsWith('/auth/login-status/');
      if (publicAuth) {
        // These routes never retry automatically: OTP and refresh credentials are one-use.
        if (['/auth/refresh', '/auth/refresh-token', '/auth/logout', '/auth/verify-otp', '/auth/complete-login'].includes(route)) {
          return cookieRequest(route + url.search, init);
        }
        return nativeFetch(new Request(original, { credentials: 'include', cache: 'no-store' }));
      }
      await ensureAccess();
      const sentToken = token;
      // Clone before the first send so a single retry also works with stream bodies.
      const retry = original.clone();
      const recentRetry = original.clone();
      const send = source => {
        const headers = new Headers(source.headers); headers.set('Authorization', `Bearer ${token}`);
        return nativeFetch(new Request(source, { headers, cache: 'no-store', credentials: 'include' }));
      };
      let response = await send(original);
      if (response.status === 401) {
        await response.body?.cancel();
        if (token === sentToken) await refreshSession();
        response = await send(retry);
      }
      if (response.status === 401) { clear(); options.onUnauthorized?.(); }
      if (response.status === 403 && options.onRecentAuth) {
        const body = await response.clone().json().catch(() => ({}));
        if ((body.code || body.error?.code || body.message) === 'RECENT_AUTH_REQUIRED') {
          await response.body?.cancel();
          if (!recentAuthPromise) recentAuthPromise = Promise.resolve().then(() => options.onRecentAuth(user))
            .finally(() => { recentAuthPromise = null; });
          await recentAuthPromise;
          response = await send(recentRetry);
          if (response.status === 401) { clear(); options.onUnauthorized?.(); }
        }
      }
      return response;
    }
    async function logout(all = false) {
      if (all) await ensureAccess();
      const response = await cookieRequest(all ? '/auth/logout-all' : '/auth/logout', {
        method: 'POST', ...(all ? { headers: { Authorization: `Bearer ${token}` } } : {})
      });
      if (!response.ok && response.status !== 401) throw await readError(response);
      clear(); options.channel?.postMessage({ type: 'logout' });
    }
    if (options.channel) options.channel.onmessage = event => {
      if (event.data?.type === 'logout') { clear(); options.onUnauthorized?.(); }
    };
    return { getToken: () => token, getUser: () => user, setSession, clear, refreshSession, ensureAccess, fetch: request, logout,
      logoutAll: () => logout(true),
      updateUser: value => { user = value; options.onChange?.(user); } };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createDeviceSession };
  else root.createDeviceSession = createDeviceSession;
})(typeof window !== 'undefined' ? window : globalThis);
