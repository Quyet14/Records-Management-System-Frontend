/* Track page transitions; navigation uses only the restored in-memory session. */
(function () {
  const VERSION = 30;

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

  function readUser() { return window.Auth?.getUser() || null; }
  function restore(nav) {
    // No cached user/HTML is treated as an authenticated navigation snapshot.
    if (!nav || !window.Auth?.getToken()) return;
    nav.dataset.navigationSignature = signature(readUser());
  }
  function remember(nav, user) {
    if (nav && user && window.Auth?.getToken()) nav.dataset.navigationSignature = signature(user);
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
