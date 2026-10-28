/* ============================================================
   LTHS — Shared JS: API, Auth, Toast, Modal, Drag-drop, Stamp
   ============================================================ */

// Configure a same-site HTTPS API with <meta name="lths-api-base" content="https://host:3002">.
const API = document.querySelector('meta[name="lths-api-base"]')?.content
  || (window.location.protocol === 'https:' ? window.location.origin : 'http://192.168.0.67:3002');

/* ── Auth helpers ────────────────────────────────────────────── */

// Resolve path to pages/ root regardless of current depth
function _pagesRoot() {
  const path = window.location.pathname;
  const pagesIndex = path.indexOf('/pages/');
  if (pagesIndex >= 0) return path.slice(0, pagesIndex) + '/pages/';
  return new URL('pages/', window.location.href).pathname;
}

const deviceSession = createDeviceSession({
  apiUrl: API, fetch: window.fetch.bind(window), locks: navigator.locks,
  SharedWorker: window.SharedWorker,
  workerUrl: new URL(_pagesRoot() + '../assets/js/auth-cookie-worker.js?v=2', window.location.href).href,
  storages: [localStorage, sessionStorage],
  onRecentAuth: user => reauthenticate(user),
  channel: typeof BroadcastChannel === 'function' ? new BroadcastChannel('lths-device-session') : null,
  onChange: user => window.dispatchEvent(new CustomEvent('lths:session', { detail: { user } })),
  onUnauthorized: () => { if (document.querySelector('.main-content')) window.location.href = _pagesRoot() + 'login.html'; }
});

const Auth = {
  ...deviceSession,
  roleHome: (role) => {
    const root = _pagesRoot();
    if (role === 'admin') return root + 'admin/dashboard.html';
    if (role === 'department_head') return root + 'dept-head/dashboard.html';
    return root + 'dashboard.html';
  },
  currentUserId: () => {
    const u = Auth.getUser();
    return String(u?.id || u?._id || u?.userId || u?.sub || '');
  },
  isAdmin: () => {
    const u = Auth.getUser();
    return u && u.role === 'admin';
  },
  isDeptHead: () => {
    const u = Auth.getUser();
    return u && u.role === 'department_head';
  },
  isStaff: () => {
    const u = Auth.getUser();
    return u && (u.role === 'admin' || u.role === 'department_head');
  },
  permissions: () => {
    const u = Auth.getUser() || {};
    const raw = u.permissions || u.userPermissions || u.permissionKeys || [];
    if (!Array.isArray(raw)) return [];
    return raw.map(item => typeof item === 'string' ? item : (item.key || item.name || item.permission)).filter(Boolean);
  },
  hasPermission: (permission) => {
    const u = Auth.getUser();
    if (!u) return false;
    if (u.role === 'admin' || u.role === 'department_head') return true;
    return Auth.permissions().includes(permission);
  },
  refreshUser: async () => {
    await deviceSession.ensureAccess();
    const response = await deviceSession.fetch(API + '/users/me');
    if (!response.ok) { const error = new Error('Không thể tải thông tin tài khoản.'); error.status = response.status; throw error; }
    const user = Auth.extractUser(await response.json());
    if (!user?.role) throw new Error('Thông tin tài khoản không hợp lệ.');
    deviceSession.updateUser(user);
    return user;
  },
  extractUser: (res) => {
    let payload = res;
    while (payload?.data || payload?.result) payload = payload.data || payload.result;
    return payload?.user || payload?.currentUser || payload?.profile || payload || null;
  },
  refreshReady: null,
  refreshedUntil: 0,
  ensureFresh: (force = false) => {
    if (!force && Auth.getToken() && !Auth.refreshReady && Date.now() < Auth.refreshedUntil) return Promise.resolve(Auth.getUser());
    if (!Auth.refreshReady) {
      Auth.refreshReady = Auth.refreshUser()
        .then(user => { Auth.refreshedUntil = Date.now() + 10000; return user; })
        .finally(() => { Auth.refreshReady = null; });
      window.NavigationShell?.track(Auth.refreshReady);
    }
    return Auth.refreshReady;
  },
  enforceRoute: () => {
    const path = window.location.pathname;
    if (path.includes('/pages/admin/') && !Auth.isAdmin()) {
      window.location.href = Auth.roleHome(Auth.getUser()?.role);
      return false;
    }
    if (path.includes('/pages/dept-head/') && !Auth.isDeptHead()) {
      window.location.href = Auth.roleHome(Auth.getUser()?.role);
      return false;
    }
    return true;
  },
  syncRoleRoute: () => {
    const user = Auth.getUser();
    const role = user?.role || 'user';
    const path = window.location.pathname;

    if (!Auth.enforceRoute()) return false;

    const isUserDashboard = /\/pages\/dashboard\.html$/i.test(path);
    if (!isUserDashboard) return true;

    if (role === 'admin') {
      window.location.href = Auth.roleHome(role);
      return false;
    }
    if (role === 'department_head') {
      window.location.href = Auth.roleHome(role);
      return false;
    }
    return true;
  },
  handleExternalRoleChange: async (detail = {}) => {
    const changedUserId = String(detail.userId || '');
    if (!changedUserId || changedUserId !== Auth.currentUserId()) return;

    const expectedRole = detail.role || detail.newRole || '';
    const freshUser = await Auth.refreshUser();
    const currentRole = freshUser?.role || Auth.getUser()?.role || '';

    if (expectedRole && currentRole !== expectedRole) {
      Auth.clear();
      alert('Quyền tài khoản của bạn vừa được thay đổi. Vui lòng đăng nhập lại để cập nhật phiên làm việc.');
      window.location.href = _pagesRoot() + 'login.html';
      return;
    }

    Auth.syncRoleRoute();
    window.location.reload();
  },
  require: async () => {
    try {
      await Auth.ensureFresh();
      if (!Auth.syncRoleRoute()) throw new Error('Đang chuyển đến trang được cấp quyền.');
      return Auth.getUser();
    } catch (error) {
      if (error.status === 401) window.location.href = _pagesRoot() + 'login.html';
      throw error;
    }
  },
  requireAdmin: async () => {
    await Auth.require();
    if (!Auth.isAdmin()) { window.location.href = Auth.roleHome(Auth.getUser()?.role); throw new Error('Không có quyền Admin.'); }
    return Auth.getUser();
  },
  requireDeptHead: async () => {
    await Auth.require();
    if (!Auth.isDeptHead()) { window.location.href = Auth.roleHome(Auth.getUser()?.role); throw new Error('Không có quyền Trưởng khoa.'); }
    return Auth.getUser();
  },
  showError: error => {
    if (error?.status === 401) return;
    const target = document.querySelector('.main-content') || document.getElementById('login-error');
    if (target) {
      const p = document.createElement('p'); p.setAttribute('role', 'alert'); p.textContent = error.message || 'Không thể khôi phục phiên. Vui lòng thử lại.';
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn btn-ghost'; retry.textContent = 'Thử lại';
      retry.onclick = () => window.location.reload(); p.appendChild(retry); target.prepend(p);
    }
  }
};
window.Auth = Auth;
function onPageReady(work) {
  const run = () => Promise.resolve().then(work).catch(Auth.showError);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}

let authFocusRefreshRunning = false;
window.addEventListener('focus', async () => {
  // The first profile refresh already updates the page during navigation.
  // Comparing its pending result on initial focus could reload the new page again.
  if (!Auth.getToken() || !Auth.refreshedUntil || Auth.refreshReady || authFocusRefreshRunning) return;
  authFocusRefreshRunning = true;
  try {
    const before = JSON.stringify([Auth.getUser()?.role, Auth.permissions().slice().sort()]);
    await Auth.ensureFresh(true);
    const after = JSON.stringify([Auth.getUser()?.role, Auth.permissions().slice().sort()]);
    if (Auth.getToken() && before !== after) window.location.reload();
  } catch (error) { Auth.showError(error); } finally {
    authFocusRefreshRunning = false;
  }
});

const AuthRoleChannel = (() => {
  const CHANNEL = 'lths_role_changed';
  const onMessage = (detail) => Auth.handleExternalRoleChange(detail).catch(Auth.showError);

  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = event => onMessage(event.data || {});
  } catch (_) {}

  window.addEventListener('storage', event => {
    if (event.key !== CHANNEL || !event.newValue) return;
    try { onMessage(JSON.parse(event.newValue)); } catch (_) {}
  });

  return {
    notify: (detail) => {
      const payload = { ...detail, at: Date.now() };
      try {
        localStorage.setItem(CHANNEL, JSON.stringify(payload));
        localStorage.removeItem(CHANNEL);
      } catch (_) {}
      try {
        const bc = new BroadcastChannel(CHANNEL);
        bc.postMessage(payload);
        bc.close();
      } catch (_) {}
    }
  };
})();

/* ── HTTP wrapper ────────────────────────────────────────────── */
let documentSearchContentUnsupported = false;

async function http(method, path, body, isForm = false) {
  const documentSearchUrl = method === 'GET' && /^\/documents(?:\/search)?\?/.test(path)
    ? new URL(path, API)
    : null;
  if (documentSearchContentUnsupported && documentSearchUrl?.searchParams.has('includeContent')) {
    documentSearchUrl.searchParams.delete('includeContent');
    path = documentSearchUrl.pathname + documentSearchUrl.search;
  }
  const headers = {};
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isForm) headers['Content-Type'] = 'application/json';

  const res = await Auth.fetch(API + path, {
    method,
    headers,
    cache: 'no-store',
    body: isForm ? body : (body ? JSON.stringify(body) : undefined)
  });


  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const messages = Array.isArray(err.message) ? err.message : [err.message];
    if (res.status === 400 && documentSearchUrl?.searchParams.has('includeContent')
      && messages.length === 1 && messages[0] === 'property includeContent should not exist') {
      const shouldNotify = !documentSearchContentUnsupported;
      documentSearchContentUnsupported = true;
      documentSearchUrl.searchParams.delete('includeContent');
      const result = await http(method, documentSearchUrl.pathname + documentSearchUrl.search, body, isForm);
      if (shouldNotify) Toast.warning('Backend chưa cập nhật API tìm kiếm. Đã tải danh sách; tìm theo nội dung có thể chưa đầy đủ.');
      return result;
    }
    throw apiError(res, err);
  }
  if (res.status === 204) return null;
  return res.json();
}

function apiError(response, body = {}) {
  const defaults = {
    401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    403: 'Bạn không có quyền thực hiện thao tác này.',
    429: 'Có quá nhiều yêu cầu. Vui lòng chờ rồi thử lại.',
    500: 'Máy chủ gặp lỗi. Vui lòng thử lại sau.',
    503: 'Dịch vụ tạm thời không sẵn sàng. Vui lòng thử lại sau.'
  };
  const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
  const error = new Error(message || defaults[response.status] || `HTTP ${response.status}`);
  error.status = response.status;
  error.code = body.code || body.error?.code;
  error.retryAfter = response.headers?.get('Retry-After');
  return error;
}

// Reauthenticate in place so the pending form and request remain in memory.
function reauthenticate(user) {
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'card';
    dialog.style.cssText = 'width:min(440px,90vw);max-height:90vh;overflow:auto';
    dialog.innerHTML = `<form><h2>Xác thực lại</h2><p>Nhập mã xác nhận và OTP gửi đến email tài khoản để tiếp tục thao tác.</p>
      <p data-error role="alert"></p><label class="form-label">Email<input class="form-control" name="email" type="email" required readonly /></label>
      <div data-captcha><img alt="Mã xác nhận" /><button type="button" data-reload class="btn btn-ghost">Đổi mã</button>
      <label class="form-label">Mã xác nhận<input class="form-control" name="captcha" autocomplete="off" /></label></div>
      <label class="form-label" data-otp hidden>Mã OTP<input class="form-control" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" /></label>
      <button type="submit" class="btn btn-primary">Gửi OTP</button> <button type="button" data-cancel class="btn btn-ghost">Hủy</button></form>`;
    const form = dialog.querySelector('form'), submit = form.querySelector('[type="submit"]');
    const error = dialog.querySelector('[data-error]');
    form.elements.email.value = user?.email || '';
    let captchaId = '', pendingId = '', active = true, running = false;
    const finish = (failure) => {
      if (!active) return;
      active = false; dialog.close(); dialog.remove();
      if (failure) reject(failure); else resolve();
    };
    const cancel = () => { if (!running) finish(Object.assign(new Error('Đã hủy xác thực lại. Thao tác chưa được thực hiện.'), { code: 'RECENT_AUTH_REQUIRED', status: 403 })); };
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    dialog.querySelector('[data-cancel]').onclick = cancel;
    async function captcha() {
      captchaId = '';
      const response = await api.get('/auth/captcha');
      const data = response.data ?? response, image = data.image || data.svg;
      if (!data.captcha_id || !image) throw new Error('Không tải được mã xác nhận.');
      if (!active) return;
      captchaId = data.captcha_id;
      dialog.querySelector('img').src = image.startsWith('data:') ? image : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}`;
      form.elements.captcha.value = '';
    }
    dialog.querySelector('[data-reload]').onclick = () => { if (!running) captcha().catch(err => { error.textContent = err.message; }); };
    form.onsubmit = async event => {
      event.preventDefault(); if (running) return;
      running = true; submit.disabled = true; error.textContent = '';
      try {
        if (!pendingId) {
          if (!captchaId || !form.elements.captcha.value.trim()) throw new Error('Vui lòng nhập mã xác nhận.');
          const response = await api.post('/auth/login', { email: user.email, captcha_id: captchaId, captcha_code: form.elements.captcha.value.trim() });
          const data = response.data ?? response;
          if (!data.requires_otp || !data.user_id) throw new Error('Phản hồi yêu cầu OTP không hợp lệ.');
          pendingId = data.user_id;
          dialog.querySelector('[data-captcha]').hidden = true;
          dialog.querySelector('[data-otp]').hidden = false;
          form.elements.otp.required = true; submit.textContent = 'Xác thực và tiếp tục'; form.elements.otp.focus();
        } else {
          const response = await api.post('/auth/verify-otp', { user_id: pendingId, otp: form.elements.otp.value.trim() });
          const data = response.data ?? response;
          if (!data.user || String(data.user.id) !== String(user.id)) throw new Error('Tài khoản xác thực không khớp.');
          Auth.setSession(data.access_token, data.user, data.expires_in);
          finish();
        }
      } catch (err) {
        error.textContent = err.message;
        if (!pendingId) await captcha().catch(() => {});
      } finally { running = false; submit.disabled = false; }
    };
    document.body.appendChild(dialog); dialog.showModal();
    captcha().catch(err => { error.textContent = err.message; });
  });
}

async function authDownloadUrl(path) {
  const match = path.match(/^\/documents\/([^/?]+)\/(download|view)(?:\?|$)/);
  if (!match) throw new Error('Đường dẫn tải tài liệu không hợp lệ.');
  const data = await api.get('/documents/' + match[1] + (match[2] === 'view' ? '/view-url' : '/download-url'));
  const payload = data?.data ?? data;
  if (!payload?.url) throw new Error('Không nhận được liên kết tải tài liệu.');
  const url = new URL(payload.url, API);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Liên kết tài liệu không hợp lệ.');
  return url.href;
}

async function fetchDocumentView(docId) {
  const url = await authDownloadUrl(`/documents/${encodeURIComponent(docId)}/view`);
  const response = await window.fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw apiError(response, await response.json().catch(() => ({})));
  return response;
}

async function uploadWithProgress(path, form, onProgress, retry = false) {
  await deviceSession.ensureAccess();
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', API + path);
    request.withCredentials = true;
    request.responseType = 'json';
    const token = Auth.getToken();
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round(event.loaded * 100 / event.total)));
      }
    };
    request.onload = async () => {
      if (request.status === 401 && !retry) {
        try { if (Auth.getToken() === token) await deviceSession.refreshSession(); resolve(await uploadWithProgress(path, form, onProgress, true)); }
        catch (error) { reject(error); }
        return;
      }
      if (request.status === 401) { Auth.clear(); window.location.href = _pagesRoot() + 'login.html'; }
      if (request.status >= 200 && request.status < 300) {
        resolve(request.response);
      } else {
        const error = new Error(request.response?.message || `HTTP ${request.status}`);
        error.status = request.status;
        reject(error);
      }
    };
    request.onerror = () => reject(new Error('Mất kết nối khi tải file. Vui lòng kiểm tra kết nối và thử lại.'));
    request.onabort = () => reject(new Error('Đã hủy tải file.'));
    request.ontimeout = () => reject(new Error('Hết thời gian tải file.'));
    // Send the File through FormData; never read the complete file into JavaScript memory.
    request.send(form);
  });
}

const pendingGetRequests = new Map();
function getWithoutDuplicateRequests(path) {
  const url = new URL(path, API);
  url.searchParams.sort();
  const key = `${Auth.getToken() || ''}:${url.pathname}${url.search}`;
  if (pendingGetRequests.has(key)) return pendingGetRequests.get(key);
  const request = http('GET', path).finally(() => pendingGetRequests.delete(key));
  window.NavigationShell?.track(request);
  pendingGetRequests.set(key, request);
  return request;
}

async function mapWithConcurrency(items, mapper, concurrency = 6) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      result[index] = await mapper(items[index], index);
    }
  }));
  return result;
}

function createDocumentContentSearch(getDocuments, onReady) {
  const hydrated = new WeakSet();
  let loading = false;
  let activeQuery = '';
  let status;
  function showStatus(message) {
    if (!status && !message) return;
    if (!status) {
      const input = document.getElementById('kw-input') || document.getElementById('search-input');
      if (!input) return;
      status = document.createElement('small');
      status.setAttribute('role', 'status');
      status.style.cssText = 'display:block;color:var(--gray-600);margin-top:6px';
      (input.closest('.search-bar') || input).after(status);
    }
    status.textContent = message;
  }
  return query => {
    activeQuery = String(query || '').trim();
    if (!activeQuery) { showStatus(''); return; }
    const docs = getDocuments();
    if (!docs.length || docs.every(doc => hydrated.has(doc))) { showStatus(''); return; }
    showStatus('Đang tìm thêm trong nội dung tài liệu…');
    if (loading) return;
    loading = true;
    api.get('/documents/search?includeContent=true&limit=10000').then(response => {
      let payload = response;
      for (let depth = 0; depth < 4 && !Array.isArray(payload); depth++) {
        payload = payload?.data || payload?.documents || payload?.items || payload?.results || [];
      }
      const byId = new Map((Array.isArray(payload) ? payload : []).map(doc => [getDocumentId(doc), doc]));
      getDocuments().forEach(doc => {
        const full = byId.get(getDocumentId(doc));
        if (full && Object.hasOwn(full, 'description')) {
          doc.description = full.description;
          hydrated.add(doc);
        }
      });
      loading = false;
      showStatus('');
      // Mark unmatched records too: the API may exclude them after access changes.
      getDocuments().forEach(doc => hydrated.add(doc));
      if (activeQuery) onReady();
    }).catch(() => {
      loading = false;
      showStatus(activeQuery ? 'Chưa tải được nội dung để tìm đầy đủ. Nhập lại từ khóa để thử lại.' : '');
    });
  };
}

const api = {
  post:   (p, b)    => http('POST',   p, b),
  get:    (p)       => getWithoutDuplicateRequests(p),
  patch:  (p, b)    => http('PATCH',  p, b),
  del:    (p)       => http('DELETE', p),
  upload: (p, form, onProgress) => typeof onProgress === 'function'
    ? uploadWithProgress(p, form, onProgress)
    : http('POST', p, form, true),
  
  // Let the browser handle large downloads instead of buffering the full file in JS.
  download: async (path, filename = 'document') => {
    const a = document.createElement('a');
    a.href = await authDownloadUrl(path);
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
  },
  
  // View file in new tab
  view: async (path) => {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try { const url = await authDownloadUrl(path); if (tab) tab.location.href = url; } catch (error) { tab?.close(); throw error; }
  }
};

/* ── Toast ───────────────────────────────────────────────────── */
const Toast = (() => {
  let container;
  function init() {
    container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
  }
  function show(msg, type = 'info', duration = 3500) {
    if (!container) init();
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    t.innerHTML = `<span style="font-weight:700;font-size:1rem">${icons[type]||'ℹ'}</span><span>${msg}</span>`;
    container.appendChild(t);
    setTimeout(() => {
      t.style.animation = 'toastIn .3s ease reverse forwards';
      setTimeout(() => t.remove(), 300);
    }, duration);
  }
  return { success: m => show(m,'success'), error: m => show(m,'error'),
           warning: m => show(m,'warning'), info: m => show(m,'info') };
})();

function returnToNotificationQueue() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('return') !== 'queue' || !document.getElementById('modal-detail')) return false;
  window.location.href = new URL('queue.html', window.location.href).href;
  return true;
}

/* ── Modal ───────────────────────────────────────────────────── */
const Modal = {
  open(id)  {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  },
  close(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  },
  init() {
    // Close on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('open');
        if (e.target === overlay && overlay.id === 'modal-detail') returnToNotificationQueue();
      });
    });
    // Close buttons
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.modalClose;
        Modal.close(id);
      });
    });
  }
};

/* ── Stamp animation ─────────────────────────────────────────── */
function animateStamp(el) {
  el.classList.remove('stamp-animate');
  void el.offsetWidth; // reflow
  el.classList.add('stamp-animate');
}

/* ── Drag-and-drop upload zone ───────────────────────────────── */
function initDropZone(dropEl, inputEl, onFile) {
  if (!dropEl) return;
  ['dragenter','dragover'].forEach(evt => {
    dropEl.addEventListener(evt, e => {
      e.preventDefault();
      dropEl.classList.add('drag-over');
    });
  });
  ['dragleave','drop'].forEach(evt => {
    dropEl.addEventListener(evt, e => {
      e.preventDefault();
      dropEl.classList.remove('drag-over');
    });
  });
  dropEl.addEventListener('drop', e => {
    const files = e.dataTransfer.files;
    if (files && files.length) {
      // Pass all files to callback (for multiple file support)
      onFile(files);
    }
  });
  dropEl.addEventListener('click', () => inputEl && inputEl.click());
  // Note: input change handler should be added separately in upload.html
}

/* ── Preview PDF in modal ────────────────────────────────────── */
async function previewFile(docId, filename, options = {}) {
  if (options.doc && !canAccessDocumentSecurity(options.doc)) {
    Toast.warning('Bạn không có quyền truy cập tài liệu ở độ mật này.');
    return;
  }
  const canDownload = options.canDownload ?? Auth.isStaff();
  const doc = options.doc || {};
  const previewName = documentFileNameForType(doc, filename);
  const downloadName = previewName || filename || doc.title || 'document';
  // Create or reuse preview modal
  let overlay = document.getElementById('modal-pdf-preview');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-pdf-preview';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:860px;width:95vw;padding:0;overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--gray-200);background:var(--white)">
          <span id="pdf-preview-title" style="font-family:var(--font-ui) !important;font-weight:600;font-size:1rem;color:var(--navy)">Xem tài liệu</span>
          <div style="display:flex;gap:8px;align-items:center">
            <button id="pdf-download-btn" class="btn btn-brass btn-sm" style="display:none">↓ Tải về</button>
            <button class="modal-close" id="pdf-close-btn" style="position:static">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div id="pdf-preview-body" style="height:75vh;display:flex;align-items:center;justify-content:center;background:#2b2b2b">
          <div style="color:#fff;font-size:.9rem">Đang tải…</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('pdf-close-btn').addEventListener('click', () => {
      overlay.classList.remove('open');
      document.getElementById('pdf-preview-body').innerHTML = '<div style="color:#fff;font-size:.9rem">Đang tải…</div>';
      if (overlay._previewBlobUrl) {
        URL.revokeObjectURL(overlay._previewBlobUrl);
        overlay._previewBlobUrl = null;
      }
    });
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
        document.getElementById('pdf-preview-body').innerHTML = '<div style="color:#fff;font-size:.9rem">Đang tải…</div>';
        if (overlay._previewBlobUrl) {
          URL.revokeObjectURL(overlay._previewBlobUrl);
          overlay._previewBlobUrl = null;
        }
      }
    });
  }

  document.getElementById('pdf-preview-title').textContent = filename || doc.title || previewName || 'Xem tài liệu';
  document.getElementById('pdf-preview-body').innerHTML = '<div style="color:#fff;font-size:.9rem">Đang tải…</div>';
  const downloadBtn = document.getElementById('pdf-download-btn');
  downloadBtn.style.display = canDownload ? 'inline-flex' : 'none';
  downloadBtn.onclick = null;
  overlay.classList.add('open');

  if (isArchiveDocumentFile(previewName) || isArchiveMimeType(documentMimeType(doc))) {
    const body = document.getElementById('pdf-preview-body');
    if (canDownload) {
      downloadBtn.onclick = async () => {
        const oldHtml = downloadBtn.innerHTML;
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = 'Đang tải...';
        try {
          await downloadFile(docId, downloadName);
        } finally {
          downloadBtn.disabled = false;
          downloadBtn.innerHTML = oldHtml;
        }
      };
      body.innerHTML = `<div style="color:#fff;text-align:center;padding:40px">
        <div style="font-weight:700;margin-bottom:8px">File nén không hỗ trợ xem trực tiếp.</div>
        <div style="font-size:.86rem;color:#ddd">Bấm "Tải về" để tải file gốc. Frontend sẽ không tải trước file nén nên mở nhanh hơn.</div>
      </div>`;
    } else {
      body.innerHTML = `<div style="color:#fff;text-align:center;padding:40px">
        <div style="font-weight:700;margin-bottom:8px">File nén không hỗ trợ xem trực tiếp.</div>
        <div style="font-size:.86rem;color:#ddd">Vui lòng gửi yêu cầu quyền xem/tải nếu cần truy cập file.</div>
      </div>`;
    }
    return;
  }

  try {
    const res = await fetchDocumentView(docId);
    await renderPreviewBlob(await res.blob(), filename, canDownload, downloadBtn, overlay);
  } catch (err) {
    document.getElementById('pdf-preview-body').innerHTML =
      `<div style="color:#f88;text-align:center;padding:40px">
        <div style="font-size:1.2rem;margin-bottom:12px">❌ Không thể tải tài liệu</div>
        <div style="font-size:0.9rem;color:#faa">${esc(err.message)}</div>
        <div style="font-size:0.8rem;color:#999;margin-top:16px">Tài liệu có thể chưa được lưu trữ hoặc file không tồn tại.</div>
      </div>`;
  }
}

const documentLibraryRequests = new Map();
function loadDocumentLibrary(globalName, filename) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (documentLibraryRequests.has(globalName)) return documentLibraryRequests.get(globalName);
  const request = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = new URL('../assets/js/vendor/' + filename, new URL(_pagesRoot(), window.location.href)).href;
    script.onload = () => {
      if (window[globalName]) resolve(window[globalName]);
      else { script.remove(); reject(new Error('Không tải được thư viện xem tài liệu.')); }
    };
    script.onerror = () => { script.remove(); reject(new Error('Không tải được thư viện xem tài liệu.')); };
    document.head.appendChild(script);
  }).catch(err => { documentLibraryRequests.delete(globalName); throw err; });
  documentLibraryRequests.set(globalName, request);
  return request;
}

async function ensurePdfJsLoaded() {
  const library = await loadDocumentLibrary('pdfjsLib', 'pdf.min.js');
  library.GlobalWorkerOptions.workerSrc = new URL('../assets/js/vendor/pdf.worker.min.js', new URL(_pagesRoot(), window.location.href)).href;
  return library;
}

async function renderPreviewBlob(blob, filename, canDownload, downloadBtn, overlay) {
  if (overlay._previewBlobUrl) {
    URL.revokeObjectURL(overlay._previewBlobUrl);
    overlay._previewBlobUrl = null;
  }

  const body = document.getElementById('pdf-preview-body');
  const type = (blob.type || '').toLowerCase();
  const isPdf = type.includes('pdf') || /\.pdf($|\?)/i.test(filename || '');
  const isImage = type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(filename || '');
  const isArchive = isArchiveDocumentFile(filename);

  if (canDownload && (isPdf || isImage)) {
    const blobUrl = URL.createObjectURL(blob);
    overlay._previewBlobUrl = blobUrl;
    body.innerHTML = isPdf
      ? `<iframe src="${blobUrl}" style="width:100%;height:75vh;border:none"></iframe>`
      : `<img src="${blobUrl}" alt="${esc(filename || 'TÃ i liá»‡u')}" style="max-width:100%;max-height:75vh;object-fit:contain;background:#fff" />`;
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || 'document';
      a.click();
    };
    return;
  }

  if (canDownload) {
    const blobUrl = URL.createObjectURL(blob);
    overlay._previewBlobUrl = blobUrl;
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || 'document';
      a.click();
    };
    const fileType = isArchive ? 'file nÃ©n' : 'Ä‘á»‹nh dáº¡ng nÃ y';
    body.innerHTML = `<div style="color:#fff;text-align:center;padding:40px">
      <div style="font-weight:700;margin-bottom:8px">KhÃ´ng xem trá»±c tiáº¿p ${fileType}.</div>
      <div style="font-size:.86rem;color:#ddd">Vui lÃ²ng báº¥m "Táº£i vá»" Ä‘á»ƒ láº¥y file gá»‘c.</div>
    </div>`;
    return;
  }

  downloadBtn.onclick = null;
  if (isPdf) {
    await ensurePdfJsLoaded();
    body.innerHTML = '<div id="pdf-canvas-pages" style="height:75vh;overflow:auto;padding:22px;background:#2b2b2b;display:flex;flex-direction:column;align-items:center;gap:18px"></div>';
    const pagesEl = document.getElementById('pdf-canvas-pages');
    const data = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const maxWidth = Math.min(960, Math.max(320, body.clientWidth - 44));

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.6, maxWidth / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.cssText = 'max-width:100%;height:auto;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.28)';
      canvas.addEventListener('contextmenu', e => e.preventDefault());
      pagesEl.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
    return;
  }

  if (isImage) {
    const blobUrl = URL.createObjectURL(blob);
    overlay._previewBlobUrl = blobUrl;
    body.innerHTML = `<img src="${blobUrl}" alt="${esc(filename || 'Tài liệu')}" style="max-width:100%;max-height:75vh;object-fit:contain;background:#fff" />`;
    return;
  }

  body.innerHTML = '<div style="color:#fff;text-align:center;padding:40px">Định dạng này chưa hỗ trợ xem trực tiếp.</div>';
}

function getDocumentId(doc) {
  const id = doc?.id || doc?._id || doc?.documentId || '';
  if (typeof id === 'object' && id !== null) return id.$oid || id.toString?.() || '';
  return String(id || '');
}

async function loadDocumentDetail(doc) {
  const id = getDocumentId(doc);
  if (!id) throw new Error('Không xác định được tài liệu.');
  const response = await api.get(`/documents/${encodeURIComponent(id)}`);
  const payload = response?.data || response?.result || response;
  const detail = payload?.document || payload?.doc || payload;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail) || getDocumentId(detail) !== id) {
    throw new Error('Dữ liệu chi tiết tài liệu không hợp lệ.');
  }
  return { ...doc, ...detail };
}

function documentSecurityLevel(value) {
  if (value == null) return 'normal';
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  const aliases = {
    normal: ['', 'normal', 'none', 'thuong', 'thường'],
    confidential: ['confidential', 'mat', 'mật'],
    secret: ['secret', 'highly_confidential', 'toi_mat', 'toi mat', 'tối mật', 'tối_mật'],
    top_secret: ['top_secret', 'top secret', 'tuyet_mat', 'tuyet mat', 'tuyệt mật', 'tuyệt_mật']
  };
  return Object.keys(aliases).find(level => aliases[level].includes(text)) || null;
}

function documentSecurityLabel(value) {
  return ({ normal: 'Thường', confidential: 'Mật', secret: 'Tối mật', top_secret: 'Tuyệt mật' })[documentSecurityLevel(value)] || 'Chưa xác định';
}

// Match the uploader identity, never a display name or the document author.
function isUploadedByCurrentUser(doc, user = Auth.getUser()) {
  if (!doc || !user) return false;
  const identity = value => {
    if (value == null) return '';
    if (typeof value === 'object') return identity(value.id ?? value._id ?? value.userId ?? value.sub ?? value.$oid);
    return String(value).trim();
  };
  const userIds = [user.id, user._id, user.userId, user.sub].map(identity).filter(Boolean);
  const uploaderIds = [doc.uploaderId, doc.uploader_id, doc.uploadedById, doc.uploaded_by_id, doc.uploader, doc.uploadedBy]
    .map(identity).filter(Boolean);
  if (uploaderIds.length) return userIds.length > 0 && uploaderIds.every(id => userIds.includes(id));
  const email = String(user.email || '').trim().toLowerCase();
  const uploaderEmails = [doc.uploader?.email, doc.uploadedBy?.email, doc.uploaderEmail, doc.uploadedByEmail]
    .map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
  return !!email && uploaderEmails.length > 0 && uploaderEmails.every(value => value === email);
}

function canAccessDocumentSecurity(doc, user = Auth.getUser()) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const userId = String(user.id || user._id || user.userId || '');
  const uploaderId = String(doc.uploader?.id || doc.uploaderId || '');
  if (userId && uploaderId === userId) return true;
  const level = documentSecurityLevel(doc.securityLevel ?? doc.security_level);
  if (level === 'normal') return true;
  const departmentId = String(user.departmentId || user.department?.id || '');
  return level === 'confidential' && user.role === 'department_head'
    && !!departmentId && String(doc.department?.id || doc.departmentId || '') === departmentId;
}

function configureDocumentSecuritySelect(select, currentValue) {
  const labels = { normal: 'Thường', confidential: 'Mật', secret: 'Tối mật'};
  const levels = Object.keys(labels);
  const normalized = documentSecurityLevel(currentValue);
  const current = levels.includes(normalized) ? normalized : null;
  const isAdmin = Auth.isAdmin();
  select.innerHTML = levels.map((level, index) =>
    `<option value="${level}"${!isAdmin && (current == null || index < levels.indexOf(current)) ? ' disabled' : ''}>${labels[level]}</option>`
  ).join('');
  if (!current) {
    const unknown = document.createElement('option');
    unknown.value = String(currentValue ?? '');
    unknown.textContent = 'Chưa xác định — cần admin cập nhật';
    select.appendChild(unknown);
  }
  select.value = current || String(currentValue ?? '');
  select.disabled = !current && !isAdmin;
  select.dataset.originalSecurityLevel = select.value;
}

function documentLongTextHtml(value) {
  const text = String(value || '—');
  if (text.length <= 280) return `<div class="document-text-content">${esc(text)}</div>`;
  return `<details class="document-long-text">
    <summary>
      <span class="document-text-preview">${esc(text.slice(0, 280))}…</span>
      <span class="document-text-more">Xem đầy đủ nội dung</span>
      <span class="document-text-less">Thu gọn</span>
    </summary>
    <div class="document-text-content document-text-scroll">${esc(text)}</div>
  </details>`;
}

function documentMetadataHtml(doc) {
  const sources = [doc, doc.metadata, doc.documentMetadata, doc.file?.metadata]
    .filter(value => value && typeof value === 'object');
  const value = (...keys) => {
    for (const key of keys) {
      for (const source of sources) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
      }
    }
    return '';
  };
  const field = (label, content, fullWidth = false) => `
    <div${fullWidth ? ' style="grid-column:1/-1"' : ''}>
      <span style="color:var(--gray-600);font-size:.75rem">${esc(label)}:</span><br>
      ${fullWidth ? documentLongTextHtml(content) : `<span style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(content === '' ? '—' : content)}</span>`}
    </div>`;
  const date = (...keys) => value(...keys) ? fmtDate(value(...keys)) : '';
  const type = value('documentType', 'documentTypeInfo', 'document_type');
  const typeName = typeof type === 'object' ? [type.code && `[${type.code}]`, type.name].filter(Boolean).join(' ') : type;
  const visibility = value('visibility', 'accessLevel', 'scope');
  let tags = value('tags');
  if (typeof tags === 'string') {
    try { tags = JSON.parse(tags); } catch (_) { tags = tags.split(','); }
  }
  const tagNames = (Array.isArray(tags) ? tags : [tags])
    .map(tag => typeof tag === 'object' && tag !== null ? tag.name : tag)
    .filter(Boolean).join(', ');
  return `
    <div style="margin-top:16px;padding:12px 14px;background:rgba(27,42,74,.04);border:1px solid var(--gray-200);border-radius:var(--radius-lg)">
      <div style="font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray-600);margin-bottom:10px">📄 Thông tin hồ sơ</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:.84rem">
        ${field('Tiêu đề tài liệu', value('title') || displayDocTitle(doc))}
        ${field('Số ký hiệu', value('referenceNo', 'referenceNumber', 'reference_no'))}
        ${field('Đơn vị ban hành', value('issuingUnit', 'issuingAgency', 'issuing_unit'))}
        ${field('Ngày đến', date('receivedDate', 'received_date'))}
        ${field('Số văn bản', value('documentNumber', 'docNumber', 'document_number'))}
        ${field('Độ mật', documentSecurityLabel(value('securityLevel', 'security_level')))}
        ${field('Người soạn thảo', value('authorName', 'author_name'))}
        ${field('Loại hồ sơ', typeName)}
        ${field('Ngày hình thành tài liệu', date('documentDate', 'issuedDate', 'document_date'))}
        ${field('Trích yếu / tóm tắt', value('summary', 'abstract'), true)}
        ${field('Mô tả', value('description'), true)}
        ${field('Phạm vi', ({ public: 'Công khai', department: 'Nội bộ khoa', private: 'Riêng tư' })[visibility] || visibility)}
        ${field('Từ khóa', tagNames, true)}
      </div>
    </div>`;
}

function normalizeViewStatus(res) {
  let data = res?.data || res || {};
  if (Array.isArray(data)) {
    data = data.find(item => ['approved', 'active'].includes(String(item?.status || '').toLowerCase()))
      || data.find(item => String(item?.status || '').toLowerCase() === 'pending')
      || data[0]
      || {};
  }

  const request = data.request || data.currentRequest || data.viewRequest || data.latestRequest || data;
  let status = request.status || request.requestStatus || request.state || data.status || data.requestStatus || data.state || 'none';
  if (data.canView === true || data.allowed === true || data.hasAccess === true || data.isApproved === true) {
    status = 'approved';
  }
  if (data.canView === false && String(status).toLowerCase() === 'approved') {
    status = 'expired';
  }

  return {
    status,
    expiresAt: request.expiresAt || data.expiresAt || request.expiredAt || data.expiredAt
      || request.validUntil || data.validUntil || request.viewExpiresAt || data.viewExpiresAt
      || request.approvedUntil || data.approvedUntil || null,
  };
}

function canViewFromStatus(status) {
  const st = String(status?.status || 'none').toLowerCase();
  const expired = status?.expiresAt && new Date(status.expiresAt) <= new Date();
  return (st === 'approved' || st === 'active') && !expired;
}

async function loadViewStatusMap(docs) {
  const immediate = new Map();
  docs = (docs || []).filter(doc => {
    const status = getImmediateDocumentViewStatus(doc);
    if (status) immediate.set(getDocumentId(doc), status);
    return !status && canAccessDocumentSecurity(doc);
  });
  const firstId = getDocumentId(docs[0]);
  if (firstId) {
    try {
      immediate.set(firstId, normalizeViewStatus(await api.get(`/documents/${firstId}/view-status`)));
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        const fallback = await loadViewStatusMapFromRequests(docs);
        fallback.forEach((status, id) => immediate.set(id, status));
        return immediate;
      }
      immediate.set(firstId, { status: 'none' });
    }
  }

  const entries = await mapWithConcurrency(docs.slice(firstId ? 1 : 0), async doc => {
    const id = getDocumentId(doc);
    if (!id) return ['', { status: 'none' }];
    try {
      return [id, normalizeViewStatus(await api.get(`/documents/${id}/view-status`))];
    } catch (_) {
      return [id, { status: 'none' }];
    }
  });
  entries.forEach(([id, status]) => { if (id) immediate.set(id, status); });
  return immediate;
}

function getImmediateDocumentViewStatus(doc) {
  const user = Auth.getUser();
  if (!user || !canAccessDocumentSecurity(doc)) return null;
  const userId = String(user.id || user._id || user.userId || '');
  if (userId && String(doc.uploader?.id || doc.uploaderId || '') === userId) return { status: 'approved', expiresAt: null };
  if (!['approved', 'stored'].includes(String(doc.status || '').toLowerCase())) return null;
  if (user.role === 'admin') return { status: 'approved', expiresAt: null };
  const departmentId = String(user.departmentId || user.department?.id || '');
  if (!departmentId || departmentId !== String(doc.departmentId || doc.department?.id || '')) return null;
  if (user.role === 'department_head' || Auth.hasPermission('approve_documents')) return { status: 'approved', expiresAt: null };
  if (['department', 'public'].includes(String(doc.visibility || '').toLowerCase())
    && (Auth.hasPermission('view_department_documents') || Auth.hasPermission('request_document_view'))) {
    return { status: 'approved', expiresAt: null };
  }
  return null;
}

function getRequestDocumentId(request) {
  const doc = request.document || request.doc || {};
  return getDocumentId(doc) || String(request.documentId || request.docId || '');
}

async function loadViewStatusMapFromRequests(docs) {
  const endpoints = [
    '/view-requests',
    '/view-requests?status=pending',
    '/view-requests?status=approved',
    '/view-requests?status=rejected',
  ];
  const byDocId = new Map();
  for (const endpoint of endpoints) {
    try {
      const res = await api.get(endpoint);
      const list = Array.isArray(res) ? res
        : Array.isArray(res?.data) ? res.data
        : Array.isArray(res?.requests) ? res.requests
        : Array.isArray(res?.items) ? res.items
        : [];
      list.forEach(item => {
        const docId = getRequestDocumentId(item);
        if (!docId || byDocId.has(docId)) return;
        byDocId.set(docId, normalizeViewStatus(item));
      });
    } catch (_) {}
  }
  return new Map((docs || []).map(doc => {
    const id = getDocumentId(doc);
    return [id, byDocId.get(id) || { status: 'none' }];
  }).filter(([id]) => id));
}

async function downloadFile(docId, filename) {
  try {
    const a = document.createElement('a');
    a.href = await authDownloadUrl(`/documents/${docId}/download`);
    a.download = filename || 'document';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
  } catch (err) {
    Toast.error('Không thể tải file: ' + err.message);
  }
}
/* ── Notification bell ───────────────────────────────────────── */
const Notif = (() => {
  let stream;

  function _timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'vừa xong';
    if (m < 60) return `${m} phút trước`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} giờ trước`;
    return `${Math.floor(h/24)} ngày trước`;
  }

  function _typeIcon(type) {
    const map = { approved:'✅', rejected:'❌', pending:'⏳', system:'🔔', upload:'📄', comment:'💬' };
    return map[type] || '🔔';
  }

  function _setBadge(count) {
    const b = document.getElementById('notif-badge');
    if (!b) return;
    b.textContent = count > 99 ? '99+' : count;
    b.style.display = count > 0 ? 'flex' : 'none';
  }

  function render(notifications) {
    const unread = notifications.filter(n => !n.isRead);
    _setBadge(unread.length);
    const list = document.getElementById('notif-list');
    if (!list) return;
    if (!notifications.length) {
      list.innerHTML = `<div style="padding:32px;text-align:center;color:var(--gray-400)"><div style="font-size:2rem;margin-bottom:8px">🔕</div><div style="font-size:.85rem">Chưa có thông báo nào</div></div>`;
      return;
    }
    list.innerHTML = notifications.map(n => `
      <div class="notif-item${n.isRead ? '' : ' notif-unread'}" data-id="${esc(n.id)}" data-document-id="${esc(getDocumentId(n))}" style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid var(--gray-100);cursor:pointer;transition:background .1s;${n.isRead ? '' : 'background:rgba(156,107,46,.05)'}">
        <div style="font-size:1.2rem;flex-shrink:0;margin-top:2px">${_typeIcon(n.type)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.85rem;color:var(--navy)">${n.title||n.message||'Thông báo'}</div>
          <div style="font-size:.78rem;color:var(--gray-600);margin-top:2px">${n.body||''}</div>
          <div style="font-size:.72rem;color:var(--gray-400);margin-top:4px">${_timeAgo(n.createdAt)}</div>
        </div>
        ${!n.isRead ? '<div style="width:8px;height:8px;border-radius:50%;background:var(--brass);flex-shrink:0;margin-top:6px"></div>' : ''}
      </div>`).join('');

    list.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', async () => {
        await markRead(item.dataset.id, item);
        const documentId = item.dataset.documentId;
        if (documentId) openDocument(documentId);
      });
    });
  }

  function getDocumentId(notification) {
    return notification.documentId || notification.docId || notification.document?.id
      || notification.entityId || notification.data?.documentId || notification.metadata?.documentId || '';
  }

  function openDocument(documentId) {
    const role = Auth.getUser()?.role || 'user';
    const target = role === 'admin' ? 'admin/search.html'
                 : role === 'department_head' ? 'dept-head/documents.html'
                 : 'my-documents.html';
    const url = new URL(`${_pagesRoot()}${target}`, window.location.href);
    url.searchParams.set('doc', documentId);
    if (role === 'admin' || role === 'department_head') url.searchParams.set('return', 'queue');
    window.location.href = url.href;
  }

  async function load() {
    try {
      const data = await api.get('/notifications');
      const list = Array.isArray(data) ? data : (data.data || data.items || []);
      render(list);
    } catch(e) { _setBadge(0); }
  }

  async function markRead(id, el) {
    if (!el) return;
    el.style.background = '';
    el.querySelector('div[style*="border-radius:50%"]')?.remove();
    const b = document.getElementById('notif-badge');
    if (b && parseInt(b.textContent) > 0) _setBadge(parseInt(b.textContent) - 1);
    try { await api.patch(`/notifications/${id}/read`); } catch(e) {}
  }

  async function markAllRead() {
    document.querySelectorAll('.notif-unread').forEach(el => {
      el.classList.remove('notif-unread');
      el.style.background = '';
      el.querySelector('div[style*="border-radius:50%"]')?.remove();
    });
    _setBadge(0);
    try { await api.patch('/notifications/read-all'); } catch(e) {}
  }

  function connectStream() {
    stream?.close();
    const controller = new AbortController();
    stream = { close: () => controller.abort() };
    (async () => {
      while (!controller.signal.aborted && Auth.getToken()) {
        try {
          const response = await Auth.fetch(API + '/notifications/stream', { signal: controller.signal });
          if (!response.ok || !response.body) throw new Error('Notification stream unavailable');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          // Reconnect before this stream's bearer expires; the next request refreshes if needed.
          const reconnect = setTimeout(() => reader.cancel().catch(() => {}), 15 * 60 * 1000);
          let buffer = '';
          try {
            while (!controller.signal.aborted) {
              const chunk = await reader.read(); if (chunk.done) break;
              buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
              let boundary;
              while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
                if (/^data:/m.test(event)) load();
              }
            }
          } finally { clearTimeout(reconnect); reader.releaseLock(); }
        } catch (error) { if (controller.signal.aborted || error.status === 401) break; }
        if (!controller.signal.aborted) await new Promise(resolve => { const timer = setTimeout(resolve, 5000); controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
      }
    })();
  }

  function init() {
    const bell = document.createElement('div');
    bell.style.cssText = 'position:relative;display:inline-block;flex-shrink:0';
    bell.innerHTML = `
      <button id="notif-btn" title="Thông báo" style="position:relative;background:none;border:none;cursor:pointer;color:var(--navy);padding:6px;border-radius:8px;display:flex;align-items:center;transition:background .15s">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>
        <span id="notif-badge" style="position:absolute;top:2px;right:2px;background:var(--stamp-deny);color:#fff;border-radius:99px;min-width:16px;height:16px;font-size:.6rem;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 3px">0</span>
      </button>
      <div id="notif-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;width:340px;background:var(--white);border:1px solid var(--gray-200);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);z-index:500;overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--gray-200)">
          <span style="font-family:var(--font-ui) !important;font-weight:600;font-size:.95rem">Thông báo</span>
          <button onclick="Notif.markAllRead()" style="background:none;border:none;cursor:pointer;font-size:.78rem;color:var(--brass);font-weight:600">Đọc tất cả</button>
        </div>
        <div id="notif-list" style="max-height:380px;overflow-y:auto">
          <div style="padding:24px;text-align:center;color:var(--gray-400);font-size:.85rem">Đang tải…</div>
        </div>
      </div>`;

    bell.querySelector('#notif-btn').addEventListener('click', e => {
      e.stopPropagation();
      const dd = document.getElementById('notif-dropdown');
      const open = dd.style.display !== 'none';
      dd.style.display = open ? 'none' : 'block';
      if (!open) load();
    });
    document.addEventListener('click', e => {
      if (!bell.contains(e.target)) {
        const dd = document.getElementById('notif-dropdown');
        if (dd) dd.style.display = 'none';
      }
    });

    // Inject vào page-header-row hoặc mobile-topbar
    const header = document.querySelector('.page-header.page-header-row');
    if (header) header.appendChild(bell);
    else {
      // Fixed fallback
      bell.style.cssText = 'position:fixed;top:18px;right:20px;z-index:300';
      document.body.appendChild(bell);
    }
    load();
    connectStream();
    window.addEventListener('pagehide', () => stream?.close(), { once: true });
    setInterval(load, 60000);
  }

  return { init, load, markRead, markAllRead };
})();

/* ── HTML escape (XSS-safe render) ───────────────────────────── */
function repairMojibake(value) {
  let text = String(value);
  const looksBroken = str => /[\u0080-\u009f\ufffd]|\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00c4[\u0080-\u00bf]|\u00c6[\u0080-\u00bf]|\u00e1[\u00ba-\u00bb]|\u00e2[\u0080-\u00bf]|\u00ef\u00bf\u00bd/.test(str);
  if (!looksBroken(text)) return text;

  const fixCommonVietnameseSequences = str => str
    .replace(/\u00c3\u0084\u00c2\u0090/g, 'Đ')
    .replace(/\u00c3\u0084\u0090/g, 'Đ')
    .replace(/\u00c4\u0090/g, 'Đ')
    .replace(/\u00c3\u0084\u00c2\u0091/g, 'đ')
    .replace(/\u00c3\u0084\u0091/g, 'đ')
    .replace(/\u00c4\u0091/g, 'đ');

  const windows1252ToByte = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
    0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
    0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
    0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
    0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
    0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
  };

  const decodeLatin1Bytes = str => {
    const bytes = [];
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (code <= 255) bytes.push(code);
      else if (windows1252ToByte[code]) bytes.push(windows1252ToByte[code]);
      else return str;
    }
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  };

  const brokenScore = str => {
    const matches = str.match(/[\u0080-\u009f\ufffd\u00c2\u00c3\u00c4\u00c6]/g);
    return matches ? matches.length : 0;
  };

  for (let i = 0; i < 3 && looksBroken(text); i++) {
    try {
      text = fixCommonVietnameseSequences(text);
      const next = decodeLatin1Bytes(text);
      if (!next || next === text) break;
      if (brokenScore(next) > brokenScore(text)) break;
      text = next;
    } catch (_) {
      text = fixCommonVietnameseSequences(text);
      break;
    }
  }
  return fixCommonVietnameseSequences(text);
}

function looksMojibakeText(value) {
  if (value == null) return false;
  return /[\u0080-\u009f\ufffd]|\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00c4[\u0080-\u00bf]|\u00c6[\u0080-\u00bf]|\u00e1[\u00ba-\u00bb]|\u00e2[\u0080-\u00bf]|\u00ef\u00bf\u00bd/.test(String(value));
}

function repairMojibakeStrict(value) {
  let text = String(value ?? '');
  if (!looksMojibakeText(text)) return text;
  const suspicious = new Set([0x00c3, 0x00c2, 0x00c4, 0x00c6, 0x00ef, 0xfffd]);
  const win1252 = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
    0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
    0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
    0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
    0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
    0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
  };
  const hasBroken = str => {
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (suspicious.has(code) || (code >= 0x80 && code <= 0x9f)) return true;
    }
    return false;
  };
  const score = str => {
    let total = 0;
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (suspicious.has(code) || (code >= 0x80 && code <= 0x9f)) total++;
    }
    return total;
  };
  const encodeUtf8 = ch => Array.from(new TextEncoder().encode(ch));
  const decodeOnce = str => {
    const bytes = [];
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (code <= 0xff) bytes.push(code);
      else if (win1252[code]) bytes.push(win1252[code]);
      else bytes.push(...encodeUtf8(ch));
    }
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  };

  for (let i = 0; i < 4 && hasBroken(text); i++) {
    const next = decodeOnce(text);
    if (!next || next === text || score(next) > score(text)) break;
    text = next;
  }
  return text;
}

function normalizeUiText(value) {
  const bad = '\ufffd';
  const replacements = [
    [`Ng${bad}y`, 'Ngày'],
    [`ng${bad}y`, 'ngày'],
    [`Ph${bad}n`, 'Phân'],
    [`ph${bad}n`, 'phân'],
    [`gi${bad}`, 'giá'],
    [`Gi${bad}`, 'Giá'],
    [`Xo${bad}`, 'Xoá'],
    [`xo${bad}`, 'xoá'],
    [`h${bad}nh`, 'hành'],
    [`H${bad}nh`, 'Hành'],
    [`H${bad}ng`, 'Hàng'],
    [`h${bad}ng`, 'hàng'],
    [`v${bad}`, 'và'],
    [`V${bad}`, 'Và'],
    [`do${bad}n`, 'đoán'],
    [`đo${bad}n`, 'đoán'],
    [`Đ${bad}i`, 'Đái'],
    [`đ${bad}i`, 'đái'],
    [`th${bad}o`, 'tháo'],
    [`Th${bad}o`, 'Tháo'],
    ['Blc sĩ', 'Bác sĩ'],
    [`B${bad}c sĩ`, 'Bác sĩ'],
    [`b${bad}c sĩ`, 'bác sĩ'],
    [`Y t${bad}`, 'Y tá'],
    [`y t${bad}`, 'y tá'],
    [`s${bad}`, 'sĩ'],
    [`S${bad}`, 'Sĩ'],
    [`Đi${bad}u`, 'Điều'],
    [`đi${bad}u`, 'điều'],
    [`dư${bad}ng`, 'dưỡng'],
    [`dư${bad}${bad}ng`, 'dưỡng'],
    [`T${bad}NG`, 'TỔNG'],
    [`T${bad}ng`, 'Tổng'],
    [`T${bad}I`, 'TÀI'],
    [`T${bad}i`, 'Tài'],
    [`t${bad}i`, 'tài'],
    [`LI${bad}U`, 'LIỆU'],
    [`li${bad}u`, 'liệu'],
    [`DUY${bad}T`, 'DUYỆT'],
    [`duy${bad}t`, 'duyệt'],
    [`L${bad}U`, 'LƯU'],
    [`l${bad}u`, 'lưu'],
    [`TR${bad}`, 'TRỮ'],
    [`tr${bad}`, 'trữ'],
    [`B${bad}`, 'BỊ'],
    [`b${bad}`, 'bị'],
    [`T${bad} CH${bad}I`, 'TỪ CHỐI'],
    [`t${bad} ch${bad}i`, 'từ chối'],
    [`CH${bad}I`, 'CHỐI'],
    [`ch${bad}i`, 'chối'],
    [`đ${bad}y`, 'đây'],
    [`Đ${bad}`, 'ĐÃ'],
    [`đ${bad}`, 'đã'],
    [`g${bad}i`, 'gửi'],
    [`g${bad}n`, 'gần'],
    [`h${bad} th${bad}ng`, 'hệ thống'],
    [`th${bad}ng k${bad}`, 'thống kê'],
    [`t${bad}i kho${bad}n`, 'tài khoản'],
    [`to${bad}n b${bad}`, 'toàn bộ'],
    [`ngư${bad}i`, 'người'],
    [`d${bad}ng`, 'dùng'],
    [`T${bad}m ki${bad}m`, 'Tìm kiếm'],
    [`t${bad}m ki${bad}m`, 'tìm kiếm'],
    [`S${bad} điện thoại`, 'Số điện thoại'],
    [`s${bad} điện thoại`, 'số điện thoại'],
    [`Ng${bad}y sinh`, 'Ngày sinh'],
    [`ng${bad}y sinh`, 'ngày sinh'],
    [`Ch${bad}c vụ`, 'Chức vụ'],
    [`ch${bad}c vụ`, 'chức vụ'],
    [`Tr${bad}nh độ`, 'Trình độ'],
    [`tr${bad}nh độ`, 'trình độ'],
    [`Vai tr${bad}`, 'Vai trò'],
    [`vai tr${bad}`, 'vai trò'],
    [`Trạng th${bad}i`, 'Trạng thái'],
    [`trạng th${bad}i`, 'trạng thái'],
    [`Thao t${bad}c`, 'Thao tác'],
    [`thao t${bad}c`, 'thao tác'],
    [`Đ${bad}ng`, 'Đóng'],
    [`đ${bad}ng`, 'đóng'],
    [`Chỉnh s${bad}a`, 'Chỉnh sửa'],
    [`chỉnh s${bad}a`, 'chỉnh sửa'],
    [`Th${bad}m`, 'Thêm'],
    [`th${bad}m`, 'thêm'],
    [`Hu${bad}`, 'Huỷ'],
    [`Lưu thay đ${bad}i`, 'Lưu thay đổi'],
    [`lưu thay đ${bad}i`, 'lưu thay đổi']
  ];
  return replacements.reduce((text, [from, to]) => text.split(from).join(to), String(value ?? ''));
}

function repairPageMojibake() {
  if (!document.body) return;
  const repairValue = value => {
    const text = String(value ?? '');
    if (!looksMojibakeText(text)) return normalizeUiText(text);
    return normalizeUiText(repairMojibakeStrict(repairMojibake(text)));
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const fixed = repairValue(node.nodeValue);
    if (fixed !== node.nodeValue) node.nodeValue = fixed;
  });

  document.querySelectorAll('[title], [placeholder], [aria-label], [alt], [value]').forEach(el => {
    ['title', 'placeholder', 'aria-label', 'alt', 'value'].forEach(attr => {
      if (!el.hasAttribute(attr)) return;
      const current = el.getAttribute(attr);
      const fixed = repairValue(current);
      if (fixed !== current) el.setAttribute(attr, fixed);
    });
  });
}

function observePageMojibake() {
  if (!document.body || window.__lthsMojibakeObserver) return;
  let scheduled = false;
  window.__lthsMojibakeObserver = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      repairPageMojibake();
    });
  });
  window.__lthsMojibakeObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'placeholder', 'aria-label', 'alt', 'value']
  });
}

function esc(str) {
  if (str == null) return '';
  const text = looksMojibakeText(str)
    ? normalizeUiText(repairMojibakeStrict(repairMojibake(str)))
    : normalizeUiText(str);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isCorruptedText(value) {
  return looksMojibakeText(value);
}

function displayText(value, fallback = '') {
  const repaired = looksMojibakeText(value)
    ? normalizeUiText(repairMojibakeStrict(repairMojibake(value || '')))
    : normalizeUiText(value || '');
  if (repaired && !isCorruptedText(repaired)) return repaired;
  const repairedFallback = looksMojibakeText(fallback)
    ? normalizeUiText(repairMojibakeStrict(repairMojibake(fallback || '')))
    : normalizeUiText(fallback || '');
  if (repairedFallback && !isCorruptedText(repairedFallback)) return repairedFallback;
  return repaired || repairedFallback || '';
}

function displayDocTitle(doc = {}) {
  return displayText(doc.title || doc.originalFilename || '', doc.originalFilename || '—') || '—';
}

function displayDocFilename(doc = {}) {
  const filename = doc.originalFilename || '';
  const title = displayDocTitle(doc);
  const extension = String(filename).match(/\.[a-z0-9]+$/i)?.[0] || '';
  const fallback = title && title !== '—'
    ? (extension && !title.toLowerCase().endsWith(extension.toLowerCase()) ? title + extension : title)
    : filename;
  return displayText(filename, fallback);
}

const DOCUMENT_FILE_ACCEPT = [
  '.pdf',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.tgz',
  '.tar.gz',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip'
].join(',');

const DOCUMENT_FILE_EXTENSIONS = ['.pdf', '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.tar.gz'];
const ARCHIVE_FILE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.tar.gz'];

function getDocumentFileExtension(filename = '') {
  const name = String(filename).toLowerCase();
  if (name.endsWith('.tar.gz')) return '.tar.gz';
  return name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || '';
}

function isAllowedDocumentFile(fileOrName) {
  const filename = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name;
  return DOCUMENT_FILE_EXTENSIONS.includes(getDocumentFileExtension(filename));
}

function isPdfDocumentFile(fileOrName) {
  const filename = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name;
  return getDocumentFileExtension(filename) === '.pdf';
}

function isArchiveDocumentFile(fileOrName) {
  const filename = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name;
  return ARCHIVE_FILE_EXTENSIONS.includes(getDocumentFileExtension(filename));
}

function documentFileNameForType(doc = {}, fallback = '') {
  const metadata = doc.metadata || {};
  const file = doc.file || {};
  const candidates = [
    fallback,
    doc.originalFilename,
    doc.filename,
    doc.fileName,
    doc.name,
    doc.storagePath,
    doc.storageKey,
    doc.path,
    doc.url,
    doc.fileUrl,
    file.originalFilename,
    file.filename,
    file.fileName,
    file.name,
    file.path,
    metadata.originalFilename,
    metadata.filename,
    metadata.fileName,
    metadata.storagePath,
    metadata.storageKey
  ];

  return candidates.find(value => getDocumentFileExtension(value)) || fallback || '';
}

function documentMimeType(doc = {}) {
  const metadata = doc.metadata || {};
  const file = doc.file || {};
  return String(
    doc.mimeType ||
    doc.mimetype ||
    doc.contentType ||
    doc.fileType ||
    file.mimeType ||
    file.mimetype ||
    file.contentType ||
    metadata.mimeType ||
    metadata.mimetype ||
    metadata.contentType ||
    ''
  ).toLowerCase();
}

function isArchiveMimeType(type = '') {
  return /(zip|rar|7z|x-tar|tar|gzip|x-gzip)/i.test(String(type));
}

function normalizeSearchText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenDocumentSearchValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return flattenDocumentSearchValue(JSON.parse(trimmed));
      } catch (_) {}
    }
  }
  if (Array.isArray(value)) return value.flatMap(flattenDocumentSearchValue);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(flattenDocumentSearchValue);
  }
  return [value];
}

function findDocumentSearchFieldValues(source, aliases) {
  if (!source || typeof source !== 'object') return [];
  const aliasKeys = new Set(aliases.map(alias => alias.toLowerCase().replace(/[^a-z0-9]/g, '')));
  return Object.entries(source).flatMap(([key, value]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    let nestedValue = value;
    if (typeof nestedValue === 'string' && /^[\[{]/.test(nestedValue.trim())) {
      try {
        nestedValue = JSON.parse(nestedValue);
      } catch (_) {}
    }
    const values = aliasKeys.has(normalizedKey)
      ? flattenDocumentSearchValue(nestedValue)
      : [];
    return nestedValue && typeof nestedValue === 'object'
      ? values.concat(findDocumentSearchFieldValues(nestedValue, aliases))
      : values;
  });
}

function docFieldValue(doc = {}, field) {
  const aliases = {
    title: ['title'],
    filename: ['originalFilename', 'filename', 'fileName'],
    description: ['description'],
    summary: ['summary', 'description'],
    referenceNo: ['referenceNo', 'referenceNumber', 'symbolNo', 'reference_no'],
    documentNumber: ['documentNumber', 'docNumber', 'number', 'document_number'],
    issuingUnit: ['issuingUnit', 'issuer', 'issuingAgency', 'issuing_unit'],
    receivedDate: ['receivedDate', 'received_date'],
    issuedDate: ['issuedDate', 'documentDate', 'document_date', 'issued_date'],
    securityLevel: ['securityLevel', 'security_level'],
    authorName: ['authorName', 'author', 'createdByName', 'author_name'],
    tags: ['tags']
  }[field] || [field];

  return findDocumentSearchFieldValues(doc, aliases)
    .filter(value => value != null && value !== '');
}

function docSearchText(doc = {}) {
  const values = [
    doc.title,
    doc.originalFilename,
    doc.filename,
    doc.fileName,
    doc.description,
    doc.summary,
    doc.referenceNo,
    doc.documentNumber,
    doc.issuingUnit,
    doc.receivedDate,
    doc.issuedDate,
    doc.documentDate,
    doc.securityLevel,
    doc.authorName,
    doc.visibility,
    doc.department?.name,
    doc.department?.code,
    doc.documentType?.name,
    doc.documentType?.code,
    doc.documentTypeId,
    doc.uploader?.fullName,
    doc.uploader?.email,
    ...(Array.isArray(doc.tags) ? doc.tags : []),
    ...['title', 'filename', 'description', 'summary', 'referenceNo', 'documentNumber',
      'issuingUnit', 'receivedDate', 'issuedDate', 'securityLevel',
      'authorName', 'tags'].flatMap(field => docFieldValue(doc, field)),
  ];

  values.push(...flattenDocumentSearchValue(doc.metadata));
  values.push(...flattenDocumentSearchValue(doc.documentMetadata));
  values.push(...flattenDocumentSearchValue(doc.file));

  return normalizeSearchText(values.filter(value => value != null && value !== '').join(' '));
}

function docMatchesKeyword(doc, keyword) {
  const kw = normalizeSearchText(keyword);
  if (!kw) return true;
  const haystack = docSearchText(doc);
  return kw.split(' ').every(term => haystack.includes(term));
}

function docMatchesAdvancedFields(doc, filters = {}) {
  return Object.entries(filters).every(([field, raw]) => {
    const value = normalizeSearchText(raw);
    if (!value) return true;
    const haystack = normalizeSearchText(docFieldValue(doc, field).join(' '));
    return haystack.includes(value);
  });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  // Nếu trong vòng 24h → hiển thị giờ
  if (diffDays === 0) {
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }
  // Nếu trong tuần này → hiển thị "X ngày trước"
  if (diffDays < 7) {
    return diffDays === 1 ? 'Hôm qua' : `${diffDays} ngày trước`;
  }
  // Còn lại → hiển thị dd/mm/yyyy
  return date.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function fmtSize(bytes) {
  // Handle invalid or extreme values
  if (!bytes || bytes === 0) return '0 B';
  if (typeof bytes !== 'number' || !isFinite(bytes) || bytes < 0) return '—';
  
  // Cap at reasonable maximum (1 PB = 1024 TB)
  if (bytes > 1024 * 1024 * 1024 * 1024 * 1024) return '> 1 PB';
  
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(2) + ' KB';
  if (bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(2) + ' MB';
  if (bytes < 1024*1024*1024*1024) return (bytes/1024/1024/1024).toFixed(2) + ' GB';
  return (bytes/1024/1024/1024/1024).toFixed(2) + ' TB';
}

function parseFileSizeValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = String(value).trim();
  if (!raw) return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;

  const match = raw.match(/^([\d.,]+)\s*(b|kb|kib|mb|mib|gb|gib|tb|tib)$/i);
  if (!match) return null;

  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount)) return null;

  const unit = match[2].toLowerCase();
  const factor = {
    b: 1,
    kb: 1024,
    kib: 1024,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
    tb: 1024 ** 4,
    tib: 1024 ** 4
  }[unit] || 1;

  return amount * factor;
}

function getFileSizeBytes(doc) {
  if (doc == null) return null;
  if (typeof doc !== 'object') return parseFileSizeValue(doc);

  const candidates = [
    doc.fileSizeBytes,
    doc.fileSize,
    doc.size,
    doc.sizeBytes,
    doc.bytes,
    doc.length,
    doc.contentLength,
    doc.file?.size,
    doc.file?.sizeBytes,
    doc.file?.fileSizeBytes,
    doc.metadata?.size,
    doc.metadata?.sizeBytes,
    doc.metadata?.fileSize,
    doc.metadata?.fileSizeBytes,
    doc.storage?.size,
    doc.storage?.sizeBytes,
    doc.storageSize,
    doc.storageSizeBytes
  ];

  for (const candidate of candidates) {
    const parsed = parseFileSizeValue(candidate);
    if (parsed != null) return parsed;
  }

  return null;
}

function fmtSize(value) {
  const parsed = (value && typeof value === 'object')
    ? getFileSizeBytes(value)
    : parseFileSizeValue(value);

  if (parsed == null || parsed < 0) return '—';
  const bytes = Math.round(parsed);
  if (bytes === 0) return '0 B';

  if (bytes > 1024 * 1024 * 1024 * 1024 * 1024) return '> 1 PB';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(2) + ' KB';
  if (bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(2) + ' MB';
  if (bytes < 1024*1024*1024*1024) return (bytes/1024/1024/1024).toFixed(2) + ' GB';
  return (bytes/1024/1024/1024/1024).toFixed(2) + ' TB';
}

function statusBadge(status) {
  const map = {
    pending:  ['badge-pending',  'Chờ duyệt'],
    approved: ['badge-approved', 'Đã duyệt'],
    stored:   ['badge-stored',   'Lưu trữ'],
    rejected: ['badge-rejected', 'Từ chối'],
  };
  const [cls, label] = map[status] || ['badge-pending', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function getRejectReason(doc = {}) {
  const candidates = [
    doc.rejectReason,
    doc.rejectionReason,
    doc.reason,
    doc.decisionNote,
    doc.note,
    doc.reviewNote,
    doc.moderationNote,
    doc.metadata?.rejectReason,
    doc.metadata?.rejectionReason,
    doc.metadata?.reason,
    doc.metadata?.decisionNote,
    doc.latestDecision?.reason,
    doc.latestDecision?.note,
    doc.decision?.reason,
    doc.decision?.note
  ];
  const found = candidates.find(value => String(value || '').trim());
  return found ? String(found).trim() : '';
}

function rejectPayload(reason) {
  const text = String(reason || '').trim();
  return {
    reason: text,
    rejectReason: text,
    rejectionReason: text,
    decisionNote: text,
    note: text
  };
}

async function submitDocumentReject(docId, reason) {
  const text = String(reason || '').trim();
  const attempts = [
    { reason: text },
    { rejectReason: text },
    { rejectionReason: text },
    { decisionNote: text },
    { note: text },
    rejectPayload(text)
  ];
  let firstError = null;
  for (const body of attempts) {
    try {
      return await api.patch(`/documents/${docId}/reject`, body);
    } catch (err) {
      firstError ||= err;
      const message = String(err?.message || '');
      if (!/reason|rejectReason|rejectionReason|decisionNote|note|should not exist|not allowed|không hợp lệ|khong hop le|400/i.test(message)) {
        throw err;
      }
    }
  }
  throw firstError || new Error('Không gửi được lý do từ chối.');
}

function stampHtml(status, size = '') {
  const map = {
    stored:   ['stamp-approved', 'ĐÃ\nDUYỆT'],
    approved: ['stamp-approved', 'ĐÃ\nDUYỆT'],
    pending:  ['stamp-pending',  'CHỜ\nDUYỆT'],
    rejected: ['stamp-rejected', 'TỪ\nCHỐI'],
  };
  const [cls, txt] = map[status] || ['stamp-pending', 'N/A'];
  return `<div class="stamp ${cls} ${size}">${txt.replace('\n','<br>')}</div>`;
}

/* ── Init on DOM ready ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  repairPageMojibake();
  observePageMojibake();
  // Áp dụng dark mode đã lưu trước khi render bất kỳ thứ gì khác
  DarkMode.init();
  Modal.init();
  _initKeyboardNav();
  if (document.querySelector('.main-content')) Auth.ensureFresh().then(() => Notif.init()).catch(Auth.showError);
  _initScrollTop();
  _initButtonLoading();
});

/* ── Scroll to top ───────────────────────────────────────────── */
function _initScrollTop() {
  // Bỏ qua trang login không có .main-content
  const main = document.querySelector('.main-content');
  if (!main) return;

  const btn = document.createElement('button');
  btn.id = 'scroll-top-btn';
  btn.title = 'Lên đầu trang';
  btn.setAttribute('aria-label', 'Lên đầu trang');
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>`;
  document.body.appendChild(btn);

  // Scroll xảy ra trên window, không phải main-content
  // (main-content không có overflow scroll riêng)
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 320);
  }, { passive: true });

  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ── Keyboard navigation ─────────────────────────────────────── */
function _initKeyboardNav() {
  // Escape đóng modal đang mở
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const openModal = document.querySelector('.modal-overlay.open');
    if (openModal) {
      if (openModal.id === 'modal-detail' && returnToNotificationQueue()) return;
      openModal.classList.remove('open');
      return;
    }
    // Đóng sidebar mobile nếu đang mở
    const sidebar = document.querySelector('.sidebar.open');
    if (sidebar) {
      sidebar.classList.remove('open');
      document.getElementById('sidebar-backdrop')?.classList.remove('open');
    }
  });
}

/* ── Auto loading state on btn-submit ────────────────────────── */
function _initButtonLoading() {
  document.querySelectorAll('form').forEach(form => {
    if (form.hasAttribute('data-managed-loading')) return;
    form.addEventListener('submit', () => {
      const btn = form.querySelector('[type="submit"]');
      if (btn) btn.classList.add('loading');
    });
  });
}

/* ── Skeleton helpers ────────────────────────────────────────── */
function skeletonCards(count = 4) {
  return Array(count).fill(0).map(() => `
    <div class="skeleton-card">
      <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:14px">
        <div class="skeleton-avatar"></div>
        <div style="flex:1"><div class="skeleton-line title"></div><div class="skeleton-line short"></div></div>
      </div>
      <div class="skeleton-line full"></div>
      <div class="skeleton-line medium"></div>
      <div class="skeleton-line short"></div>
    </div>`).join('');
}

function skeletonTable(rows = 5) {
  const cols = 5;
  return `<div class="table-wrap">
    <table><thead><tr>${Array(cols).fill('<th><div class="skeleton-line" style="height:10px"></div></th>').join('')}</tr></thead>
    <tbody>${Array(rows).fill(0).map(() => `
      <tr>${Array(cols).fill('<td><div class="skeleton-line" style="height:12px"></div></td>').join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

function emptyStatePro(icon, title, desc, actionHtml = '') {
  return `<div class="empty-state-pro">
    <div class="empty-icon">${icon}</div>
    <h3>${title}</h3>
    <p>${desc}</p>
    ${actionHtml}
  </div>`;
}

/* ── Debounce ────────────────────────────────────────────────── */
function debounce(fn, delay = 400) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ── Copy to clipboard ───────────────────────────────────────── */
async function copyToClipboard(text, successMsg = 'Đã sao chép!') {
  try {
    await navigator.clipboard.writeText(text);
    Toast.success(successMsg);
  } catch {
    // Fallback cho môi trường không hỗ trợ clipboard API
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    Toast.success(successMsg);
  }
}

/* ── Dark mode ───────────────────────────────────────────────── */
const DarkMode = (() => {
  const KEY = 'lths_dark';

  function apply(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem(KEY, dark ? '1' : '0');
    // Cập nhật icon nút nếu đang hiển thị
    const btn = document.getElementById('dark-mode-btn');
    if (btn) {
      btn.title = dark ? 'Chế độ sáng' : 'Chế độ tối';
      btn.innerHTML = dark
        ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
        : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
    }
  }

  function toggle() { apply(!isDark()); }
  function isDark()  { return localStorage.getItem(KEY) === '1'; }
  function init()    { apply(isDark()); }

  return { toggle, isDark, init, apply };
})();

/* ── Share link ──────────────────────────────────────────────── */
function shareDocLink(docId) {
  const url = new URL(window.location.href);
  url.searchParams.set('doc', docId);
  copyToClipboard(url.toString(), 'Đã sao chép link tài liệu!');
}

/* ── Open doc from URL param ─────────────────────────────────── */
// Gọi hàm này sau khi dữ liệu đã load để mở detail từ ?doc=id
function openDocFromUrl(docs, showDetailFn) {
  const id = new URLSearchParams(window.location.search).get('doc');
  if (!id) return;
  const doc = docs.find(d => d.id === id);
  if (doc) showDetailFn(doc);
}

/* ── Breadcrumb ──────────────────────────────────────────────── */
function renderBreadcrumb(items) {
  // items = [{ label, href? }, ...]
  // Inject ngay trước .page-header nếu chưa có
  if (document.querySelector('.breadcrumb')) return;
  const nav = document.createElement('nav');
  nav.className = 'breadcrumb';
  nav.setAttribute('aria-label', 'Đường dẫn');
  nav.innerHTML = items.map((item, i) => {
    const isLast = i === items.length - 1;
    if (isLast || !item.href) {
      return `<span class="breadcrumb-item${isLast ? ' active' : ''}">${esc(item.label)}</span>`;
    }
    return `<a class="breadcrumb-item" href="${esc(item.href)}">${esc(item.label)}</a>`;
  }).join('<span class="breadcrumb-sep" aria-hidden="true">›</span>');

  const header = document.querySelector('.page-header');
  if (header) header.parentNode.insertBefore(nav, header);
  else document.querySelector('.main-content')?.prepend(nav);
}

/* ── Retention helpers ───────────────────────────────────────── */

/**
 * Tính ngày hết hạn lưu trữ từ metadata tài liệu.
 * Trả về Date hoặc null nếu vĩnh viễn / không đủ thông tin.
 */
function calcRetentionExpiry(doc) {
  if (!doc) return null;
  // Vĩnh viễn
  if (doc.valueType === 'permanent') return null;
  if (doc.documentType?.isPermanent) return null;

  const years = doc.retentionYears ?? doc.documentType?.retentionYears;
  if (!years) return null;

  // Mốc tính: ngày hình thành (issuedDate) hoặc ngày tạo (createdAt)
  const basis = doc.documentType?.retentionBasis || 'creation';
  let startDate = null;
  if (basis === 'death' && doc.patientDeathDate) {
    startDate = new Date(doc.patientDeathDate);
  } else {
    startDate = new Date(doc.issuedDate || doc.createdAt);
  }
  if (isNaN(startDate)) return null;

  const expiry = new Date(startDate);
  expiry.setFullYear(expiry.getFullYear() + parseInt(years, 10));
  return expiry;
}

/**
 * Render banner cảnh báo chỉnh lý tài liệu trước 01/7/2025.
 * Gọi sau khi load docs, inject vào container chỉ định.
 * @param {Array} docs - danh sách tài liệu đã load
 * @param {string} containerId - id của element để inject banner vào trước
 */
function renderRetentionBanner(docs, containerId) {
  const DEADLINE     = new Date('2030-07-01');
  const CUTOFF       = new Date('2025-07-01');
  const now          = new Date();
  const daysLeft     = Math.ceil((DEADLINE - now) / (1000 * 60 * 60 * 24));
  const container    = document.getElementById(containerId);
  if (!container) return;

  // Đếm tài liệu trước 01/7/2025 chưa chỉnh lý
  const needReview = docs.filter(d => {
    const issuedOrCreated = new Date(d.issuedDate || d.createdAt);
    return issuedOrCreated < CUTOFF &&
           d.reviewStatus !== 'completed' &&
           (d.status === 'stored' || d.status === 'approved');
  });

  // Xóa banner cũ nếu có
  document.getElementById('retention-banner')?.remove();
  if (!needReview.length) return;

  const urgency  = daysLeft < 365 ? 'var(--stamp-deny)' : daysLeft < 730 ? 'var(--stamp-wait)' : 'var(--brass)';
  const urgencyBg= daysLeft < 365 ? 'rgba(163,59,59,.08)' : daysLeft < 730 ? 'rgba(185,138,46,.08)' : 'rgba(156,107,46,.06)';
  const icon     = daysLeft < 365 ? '🚨' : daysLeft < 730 ? '⚠️' : '📋';

  const banner = document.createElement('div');
  banner.id    = 'retention-banner';
  banner.style.cssText = `
    background:${urgencyBg};border:1.5px solid ${urgency};border-radius:var(--radius-lg);
    padding:14px 18px;margin-bottom:20px;display:flex;align-items:flex-start;
    gap:12px;animation:pageFadeIn .3s ease both;
  `;
  banner.innerHTML = `
    <span style="font-size:1.3rem;flex-shrink:0;line-height:1">${icon}</span>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:.9rem;color:${urgency};margin-bottom:3px">
        Cảnh báo: ${needReview.length} tài liệu trước 01/7/2025 chưa hoàn thành chỉnh lý, xác định giá trị
      </div>
      <div style="font-size:.8rem;color:var(--gray-600)">
        Theo <strong>Luật Lưu trữ 01/2011/QH13</strong>: phải hoàn thành chỉnh lý trước <strong>01/7/2030</strong>
        — còn <strong style="color:${urgency}">${daysLeft} ngày</strong>.
        ${window.location.pathname.includes('/admin/')
          ? `<a href="monitor.html" style="color:${urgency};font-weight:600;margin-left:8px">Xem danh sách →</a>`
          : ''}
      </div>
    </div>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;
      color:var(--gray-400);font-size:1.1rem;padding:0;flex-shrink:0;line-height:1" title="Đóng">✕</button>
  `;

  container.parentNode.insertBefore(banner, container);
}

/**
 * Render danh sách tài liệu sắp hết hạn lưu trữ (trong vòng N ngày).
 * @param {Array} docs
 * @param {number} withinDays - cảnh báo nếu hết hạn trong vòng bao nhiêu ngày
 * @returns {Array} - mảng {doc, expiry, daysLeft}
 */
function getExpiringDocs(docs, withinDays = 365) {
  const now     = new Date();
  const results = [];
  for (const doc of docs) {
    if (doc.valueType === 'permanent') continue;
    if (doc.documentType?.isPermanent) continue;
    const expiry = calcRetentionExpiry(doc);
    if (!expiry) continue;
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    if (daysLeft <= withinDays) {
      results.push({ doc, expiry, daysLeft });
    }
  }
  return results.sort((a, b) => a.daysLeft - b.daysLeft);
}

// Pending queue helpers: all counters use the reviewable queue's server total.
window.PendingQueue = (() => {
  function normalize(payload, requestedPage = 1, requestedLimit = 20) {
    if (Array.isArray(payload)) return { data: payload, total: payload.length, page: 1, limit: Math.max(1, payload.length) };
    const data = payload?.data ?? payload?.items;
    if (!Array.isArray(data) || !Number.isSafeInteger(payload.total) || payload.total < 0
      || !Number.isSafeInteger(payload.page) || payload.page < 1 || !Number.isSafeInteger(payload.limit) || payload.limit < 1
      || data.length > payload.limit || data.length > payload.total || payload.page !== requestedPage || payload.limit !== requestedLimit)
      throw new Error('Dữ liệu hàng chờ từ máy chủ không hợp lệ.');
    return { data, total: payload.total, page: payload.page, limit: payload.limit };
  }
  async function load(page = 1, limit = 20) {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Trang hàng chờ không hợp lệ.');
    return normalize(await api.get('/documents/pending?page=' + page + '&limit=' + limit), page, limit);
  }
  function sync(total) {
    const badge = document.getElementById('sb-queue-badge');
    if (badge) {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.style.display = total > 0 ? 'inline-flex' : 'none';
      badge.setAttribute('aria-label', total + ' hồ sơ chờ duyệt');
      const group = badge.closest('.sb-nav-group');
      const dot = group?.querySelector('.sb-group-dot');
      if (dot) dot.hidden = !Array.from(group.querySelectorAll('.sb-badge')).some(el => el.style.display !== 'none' && el.textContent !== '0');
    }
  }
  function renderPager(element, payload, onPage) {
    const { page, limit, total, data } = payload;
    const last = Math.max(1, Math.ceil(total / limit));
    const from = data.length ? (page - 1) * limit + 1 : 0;
    const to = data.length ? from + data.length - 1 : 0;
    element.innerHTML = '<span role="status">Hiển thị ' + from + '–' + to + ' / ' + total + ' hồ sơ · Trang ' + page + '/' + last + '</span>'
      + '<button type="button" class="btn btn-ghost btn-sm" data-queue-prev ' + (page <= 1 ? 'disabled' : '') + '>← Trước</button>'
      + '<button type="button" class="btn btn-ghost btn-sm" data-queue-next ' + (page >= last ? 'disabled' : '') + '>Sau →</button>';
    element.querySelector('[data-queue-prev]').onclick = () => { if (page > 1) onPage(page - 1); };
    element.querySelector('[data-queue-next]').onclick = () => { if (page < last) onPage(page + 1); };
  }
  return { normalize, load, count: async () => (await load(1, 1)).total, sync, renderPager };
})();
// End pending queue helpers.
