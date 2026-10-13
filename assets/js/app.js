/* ============================================================
   LTHS — Shared JS: API, Auth, Toast, Modal, Drag-drop, Stamp
   ============================================================ */

// API endpoint - Dùng IP LAN thay vì localhost để đồng nhất
// Backend đang chạy trên: http://192.168.81.178:3000
const API = 'http://192.168.0.67:3002';

// Hoặc để auto-detect (uncomment nếu muốn):
/*
const API = (() => {
  const hostname = window.location.hostname;
  // Nếu truy cập từ localhost/127.0.0.1 → dùng IP LAN
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://192.168.81.178:3000'; // Thay IP này bằng IP máy bạn
  }
  // Nếu truy cập từ IP LAN → dùng IP đó cho backend
  return `http://${hostname}:3000`;
})();
*/

/* ── Auth helpers ────────────────────────────────────────────── */

// Resolve path to pages/ root regardless of current depth
function _pagesRoot() {
  const path = window.location.pathname;
  if (path.includes('/pages/admin/'))     return '../../pages/';
  if (path.includes('/pages/dept-head/')) return '../../pages/';
  if (path.includes('/pages/'))           return '../pages/';
  return 'pages/';
}

const Auth = {
  getToken:   () => localStorage.getItem('lths_token'),
  getUser:    () => JSON.parse(localStorage.getItem('lths_user') || 'null'),
  setSession: (token, user) => {
    localStorage.setItem('lths_token', token);
    localStorage.setItem('lths_user', JSON.stringify(user));
  },
  roleHome: (role) => {
    const root = _pagesRoot();
    if (role === 'admin') return root + 'admin/dashboard.html';
    if (role === 'department_head') return root + 'dept-head/dashboard.html';
    return root + 'dashboard.html';
  },
  clear: () => {
    localStorage.removeItem('lths_token');
    localStorage.removeItem('lths_user');
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
  refreshUser: async () => {
    const token = Auth.getToken();
    if (!token) return null;

    const cachedUser = Auth.getUser();
    const cachedUserId = cachedUser?.id || cachedUser?._id || cachedUser?.userId || cachedUser?.sub;
    const refreshEndpoints = ['/auth/refresh', '/auth/refresh-token'];
    for (const endpoint of refreshEndpoints) {
      try {
        const res = await fetch(API + endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          cache: 'no-store'
        });
        if (!res.ok) continue;
        const data = await res.json().catch(() => null);
        const payload = data?.data || data?.result || data || {};
        const nextToken = payload.access_token || payload.token;
        const nextUser = Auth.extractUser(payload);
        if (nextToken && nextUser?.role) {
          Auth.setSession(nextToken, nextUser);
          return nextUser;
        }
      } catch (_) {}
    }

    const endpoints = ['/auth/me', '/users/me', '/me', '/auth/profile', '/users/profile'];
    if (cachedUserId) endpoints.push(`/users/${encodeURIComponent(cachedUserId)}`);
    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(API + endpoint, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-store'
        });

        if (res.status === 401) {
          Auth.clear();
          window.location.href = _pagesRoot() + 'login.html';
          return null;
        }

        if (res.status === 404) continue;
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          lastError = new Error(err.message || `HTTP ${res.status}`);
          continue;
        }

        const data = await res.json().catch(() => null);
        const user = Auth.extractUser(data);
        if (user?.id || user?._id || user?.email) {
          const oldRole = cachedUser?.role;
          localStorage.setItem('lths_user', JSON.stringify(user));
          if (oldRole && user.role && oldRole !== user.role) {
            window.dispatchEvent(new CustomEvent('lths:user-refreshed', { detail: { user, oldRole } }));
          }
          return user;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) console.warn('[Auth] Could not refresh current user:', lastError);
    return Auth.getUser();
  },
  extractUser: (res) => {
    let payload = res;
    while (payload?.data || payload?.result) payload = payload.data || payload.result;
    return payload?.user || payload?.currentUser || payload?.profile || payload || null;
  },
  refreshReady: null,
  ensureFresh: () => {
    if (!Auth.refreshReady) {
      Auth.refreshReady = Auth.refreshUser().finally(() => {
        setTimeout(() => { Auth.refreshReady = null; }, 0);
      });
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
  require: () => {
    if (!Auth.getToken()) { window.location.href = _pagesRoot() + 'login.html'; return; }
    Auth.ensureFresh().then(() => Auth.syncRoleRoute());
  },
  requireAdmin: () => {
    if (!Auth.getToken()) { window.location.href = _pagesRoot() + 'login.html'; return; }
    Auth.ensureFresh().then(() => {
      if (!Auth.isAdmin()) window.location.href = _pagesRoot() + 'dashboard.html';
    });
  },
  requireDeptHead: () => {
    if (!Auth.getToken()) { window.location.href = _pagesRoot() + 'login.html'; return; }
    Auth.ensureFresh().then(() => {
      if (!Auth.isDeptHead()) window.location.href = _pagesRoot() + 'dashboard.html';
    });
  }
};

if (Auth.getToken()) Auth.ensureFresh().then(() => Auth.syncRoleRoute());

const AuthRoleChannel = (() => {
  const CHANNEL = 'lths_role_changed';
  const onMessage = (detail) => Auth.handleExternalRoleChange(detail);

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
async function http(method, path, body, isForm = false) {
  const headers = {};
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(API + path, {
    method,
    headers,
    cache: 'no-store',
    body: isForm ? body : (body ? JSON.stringify(body) : undefined)
  });

  if (res.status === 401) { Auth.clear(); window.location.href = _pagesRoot() + 'login.html'; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const api = {
  post:   (p, b)    => http('POST',   p, b),
  get:    (p)       => http('GET',    p),
  patch:  (p, b)    => http('PATCH',  p, b),
  del:    (p)       => http('DELETE', p),
  upload: (p, form) => http('POST',   p, form, true),
  
  // Download file as blob
  download: async (path, filename = 'document.pdf') => {
    const token = Auth.getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const res = await fetch(API + path, { method: 'GET', headers });
    
    if (res.status === 401) { 
      Auth.clear(); 
      window.location.href = _pagesRoot() + 'login.html'; 
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  },
  
  // View file in new tab
  view: (path) => {
    const token = Auth.getToken();
    const url = `${API}${path}${token ? `?token=${token}` : ''}`;
    window.open(url, '_blank');
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
  const canDownload = options.canDownload ?? Auth.isStaff();
  const endpoint = options.endpoint || (canDownload ? 'download' : 'view');
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

  document.getElementById('pdf-preview-title').textContent = filename || 'Xem tài liệu';
  document.getElementById('pdf-preview-body').innerHTML = '<div style="color:#fff;font-size:.9rem">Đang tải…</div>';
  const downloadBtn = document.getElementById('pdf-download-btn');
  downloadBtn.style.display = canDownload ? 'inline-flex' : 'none';
  downloadBtn.onclick = null;
  overlay.classList.add('open');

  try {
    const token = Auth.getToken();
    const res = await fetch(`${API}/documents/${docId}/${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMsg = errorData.message || `HTTP ${res.status}`;
      throw new Error(errorMsg);
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      const viewUrl = data.url || data.viewUrl || data.fileUrl || data.signedUrl;
      if (!viewUrl) throw new Error(data.message || 'Không nhận được liên kết xem tài liệu');
      const headers = {};
      if (token && (viewUrl.startsWith(API) || viewUrl.startsWith('/'))) {
        headers.Authorization = `Bearer ${token}`;
      }
      const fileRes = await fetch(viewUrl.startsWith('/') ? API + viewUrl : viewUrl, { headers });
      if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
      await renderPreviewBlob(await fileRes.blob(), filename, canDownload, downloadBtn, overlay);
      return;
    }

    const blob = await res.blob();
    await renderPreviewBlob(blob, filename, canDownload, downloadBtn, overlay);
  } catch (err) {
    document.getElementById('pdf-preview-body').innerHTML =
      `<div style="color:#f88;text-align:center;padding:40px">
        <div style="font-size:1.2rem;margin-bottom:12px">❌ Không thể tải tài liệu</div>
        <div style="font-size:0.9rem;color:#faa">${err.message}</div>
        <div style="font-size:0.8rem;color:#999;margin-top:16px">Tài liệu có thể chưa được lưu trữ hoặc file không tồn tại.</div>
      </div>`;
  }
}

async function ensurePdfJsLoaded() {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc ||= '../assets/js/vendor/pdf.worker.min.js';
    return;
  }
  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-pdfjs-loader]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = '../assets/js/vendor/pdf.min.js';
    s.dataset.pdfjsLoader = '1';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  pdfjsLib.GlobalWorkerOptions.workerSrc = '../assets/js/vendor/pdf.worker.min.js';
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

  if (canDownload) {
    const blobUrl = URL.createObjectURL(blob);
    overlay._previewBlobUrl = blobUrl;
    body.innerHTML = `<iframe src="${blobUrl}" style="width:100%;height:75vh;border:none"></iframe>`;
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || 'document.pdf';
      a.click();
    };
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
  docs = docs || [];
  const firstId = getDocumentId(docs[0]);
  if (firstId) {
    try {
      await api.get(`/documents/${firstId}/view-status`);
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        return loadViewStatusMapFromRequests(docs);
      }
    }
  }

  const entries = await Promise.all(docs.map(async doc => {
    const id = getDocumentId(doc);
    if (!id) return ['', { status: 'none' }];
    try {
      return [id, normalizeViewStatus(await api.get(`/documents/${id}/view-status`))];
    } catch (_) {
      return [id, { status: 'none' }];
    }
  }));
  return new Map(entries.filter(([id]) => id));
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
    const token = Auth.getToken();
    const res = await fetch(`${API}/documents/${docId}/download`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'document.pdf';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
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
    const token = Auth.getToken();
    if (!token || typeof EventSource === 'undefined') return;

    stream?.close();
    stream = new EventSource(`${API}/notifications/stream?token=${encodeURIComponent(token)}`);
    stream.onmessage = () => load();
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
  if (Auth.getToken()) Notif.init();
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
