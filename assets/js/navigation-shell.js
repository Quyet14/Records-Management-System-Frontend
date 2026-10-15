/* Restore the signed-in user's navigation before the main page is parsed. */
(function () {
  const VERSION = 29;
  const STORAGE_KEY = 'lths_navigation_shell';

  // Keep the outgoing snapshot until the destination's first data requests
  // have rendered. The normal page lifecycle and permission checks still run.
  let transition = null;
  let pending = 0;
  let ready = document.readyState !== 'loading';
  let finished = false;
  let quietTimer;
  let deadline;
  function reveal() {
    if (finished) return;
    finished = true;
    clearTimeout(quietTimer);
    clearTimeout(deadline);
    document.documentElement.classList.remove('navigation-pending');
    transition?.skipTransition();
  }
  function checkReady() {
    clearTimeout(quietTimer);
    if (!ready || pending || finished || !transition) return;
    // Promise continuations may start another request or render the result.
    quietTimer = setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!pending) reveal();
      }));
    }, 50);
  }
  function track(request) {
    if (finished) return request;
    pending++;
    clearTimeout(quietTimer);
    const settled = () => { pending--; checkReady(); };
    Promise.resolve(request).then(settled, settled);
    return request;
  }
  window.addEventListener('pagereveal', event => {
    if (!event.viewTransition) { finished = true; return; }
    transition = event.viewTransition;
    finished = false;
    document.documentElement.classList.add('navigation-pending');
    // Slow or unavailable APIs must never leave navigation blocked.
    deadline = setTimeout(reveal, 2500);
    transition.finished.then(() => {
      finished = true;
      clearTimeout(quietTimer);
      clearTimeout(deadline);
      document.documentElement.classList.remove('navigation-pending');
    }, reveal);
    checkReady();
  });
  document.addEventListener('DOMContentLoaded', () => { ready = true; checkReady(); }, { once: true });

  function signature(user) {
    if (!user) return '';
    const permissions = user.permissions || user.userPermissions || user.permissionKeys || [];
    return JSON.stringify([
      VERSION,
      user.id || user._id || user.userId || '',
      user.role || 'user',
      user.fullName || '',
      user.email || '',
      user.departmentId || user.department?.id || '',
      user.department?.name || '',
      Array.isArray(permissions) ? permissions.map(item => typeof item === 'string' ? item : item?.key || item?.name || item?.permission).filter(Boolean).sort() : []
    ]);
  }

  function readUser() {
    try { return JSON.parse(localStorage.getItem('lths_user') || 'null'); }
    catch (_) { return null; }
  }

  function restore(nav) {
    if (!nav || !localStorage.getItem('lths_token')) return;
    const userSignature = signature(readUser());
    if (!userSignature) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || saved.signature !== userSignature || typeof saved.html !== 'string') return;
      nav.innerHTML = saved.html;
      nav.dataset.navigationSignature = userSignature;
      const current = new URL(window.location.href);
      nav.querySelectorAll('a.nav-item').forEach(link => {
        const target = new URL(link.getAttribute('href'), current);
        const active = target.pathname === current.pathname
          && target.searchParams.get('feature') === current.searchParams.get('feature');
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
    } catch (_) {
      // Navigation remains available through the normal sidebar initializer.
    }
  }

  function remember(nav, user) {
    if (!nav || !user || !localStorage.getItem('lths_token')) return;
    try {
      // A department head also visits pages outside dept-head/. Resolve assets
      // before saving so the next page cannot interpret them at another depth.
      nav.querySelectorAll('img[src]').forEach(img => img.setAttribute('src', img.src));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ signature: signature(user), html: nav.innerHTML }));
    } catch (_) {}
  }

  window.NavigationShell = { signature, restore, remember, track };
  // This script runs in the head, before the first paint and pagereveal event.
  const nav = document.querySelector('nav.sidebar');
  if (nav) restore(nav);
  else {
    const observer = new MutationObserver(() => {
      const sidebar = document.querySelector('nav.sidebar');
      if (!sidebar) return;
      observer.disconnect();
      restore(sidebar);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => observer.disconnect(), { once: true });
  }
  window.addEventListener('pageswap', () => remember(document.querySelector('nav.sidebar'), readUser()));
})();
