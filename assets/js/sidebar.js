/* ============================================================
   LTHS — Sidebar component v2
   - Render sidebar động theo role
   - Mobile-topbar title động theo active link
   - _pagesRoot() nội bộ (không phụ thuộc app.js load order)
   ============================================================ */

(function () {

  /* ── Nav config ───────────────────────────────────────────── */
  // href là đường dẫn tương đối từ thư mục pages/
  // user: pages/*.html  → prefix rỗng
  // admin: pages/admin/*.html → prefix 'admin/'
  // dept-head: pages/dept-head/*.html → prefix 'dept-head/'
  const NAV = {
    user: {
      section: 'Người dùng',
      prefix: '',
      links: [
        { href: 'dashboard.html',    icon: 'grid',      label: 'Tổng quan' },
        { href: 'documents.html',    icon: 'search',    label: 'Tài liệu' },
        { href: 'upload.html',       icon: 'upload',    label: 'Tải lên tài liệu' },
        { href: 'my-documents.html', icon: 'file',      label: 'Tài liệu của tôi' },
        { href: 'destruction.html', icon: 'archive', label: 'Yêu cầu hủy hồ sơ' },
        { href: 'approval.html', icon: 'check', label: 'Chờ phê duyệt', permission: 'approve_documents', badgeId: 'sb-queue-badge' },
        { href: 'guide.html', icon: 'help', label: 'Hướng dẫn sử dụng' },
      ],
    },
    admin: {
      section: 'Quản trị',
      prefix: 'admin/',
      links: [
        { href: 'dashboard.html',       icon: 'grid',       label: 'Tổng quan' },
        { href: 'queue.html',           icon: 'check',      label: 'Hàng chờ duyệt', badgeId: 'sb-queue-badge' },
        { href: '../view-requests-admin.html?v=view-requests-2', icon: 'clock', label: 'Yêu cầu xem', badgeId: 'sb-view-requests-badge' },
        { href: 'search.html',          icon: 'search',     label: 'Tìm kiếm toàn hệ thống' },
        { href: 'archive.html',         icon: 'archive',    label: 'Kho lưu trữ' },
        { href: '../destruction.html',  icon: 'archive',    label: 'Hủy hồ sơ' },
        { href: 'users.html',           icon: 'users',      label: 'Quản lý người dùng' },
        { href: 'departments.html',     icon: 'briefcase',  label: 'Quản lý Khoa' },
        { href: 'document-types.html',  icon: 'clock',      label: 'Danh mục loại hồ sơ' },
        { href: 'stats.html',           icon: 'bar-chart',  label: 'Thống kê' },
        { href: 'monitor.html',         icon: 'monitor',    label: 'Giám sát' },
        { href: '../guide.html',        icon: 'help',       label: 'Hướng dẫn sử dụng' },
      ],
    },
    department_head: {
      section: 'Quản lý khoa',
      prefix: 'dept-head/',
      links: [
        { href: 'dashboard.html',  icon: 'grid',   label: 'Tổng quan' },
        { href: '../upload.html',  icon: 'upload', label: 'Tải lên tài liệu' },
        { href: 'queue.html',      icon: 'check',  label: 'Hàng chờ duyệt', badgeId: 'sb-queue-badge' },
        { href: '../view-requests-admin.html?v=view-requests-2', icon: 'clock', label: 'Yêu cầu xem', badgeId: 'sb-view-requests-badge' },
        { href: 'members.html',    icon: 'users',  label: 'Thành viên khoa' },
        { href: 'documents.html',  icon: 'file',   label: 'Tài liệu khoa' },
        { href: '../destruction.html', icon: 'archive', label: 'Hủy hồ sơ' },
        { href: 'document-types.html', icon: 'clock', label: 'Danh mục hồ sơ' },
        { href: 'stats.html', icon: 'bar-chart', label: 'Thống kê' },
        { href: 'monitor.html', icon: 'monitor', label: 'Giám sát' },
        { href: '../guide.html', icon: 'help', label: 'Hướng dẫn sử dụng' },
      ],
    },
  };

  /* ── SVG icons ────────────────────────────────────────────── */
  const ICONS = {
    grid:        `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>`,
    upload:      `<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>`,
    file:        `<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
    clock:       `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
    check:       `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>`,
    search:      `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
    users:       `<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>`,
    briefcase:   `<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>`,
    'bar-chart': `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
    monitor:     `<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
    help:        `<circle cx="12" cy="12" r="10"/><path d="M9.6 9a2.5 2.5 0 014.85.85c0 1.7-2.45 2.1-2.45 3.65M12 17h.01"/>`,
    settings:    `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.34 1.88l.06.06-1.42 1.42-.06-.06a1.7 1.7 0 00-1.88-.34 1.7 1.7 0 00-1.03 1.56V20h-2v-.48a1.7 1.7 0 00-1.03-1.56 1.7 1.7 0 00-1.88.34l-.06.06-1.42-1.42.06-.06A1.7 1.7 0 009.4 15a1.7 1.7 0 00-1.56-1.03H7v-2h.84A1.7 1.7 0 009.4 11a1.7 1.7 0 00-.34-1.88L9 9.06l1.42-1.42.06.06a1.7 1.7 0 001.88.34A1.7 1.7 0 0013.39 6.5V6h2v.5a1.7 1.7 0 001.03 1.54 1.7 1.7 0 001.88-.34l.06-.06 1.42 1.42-.06.06A1.7 1.7 0 0019.4 11a1.7 1.7 0 001.56 1.03H21v2h-.04A1.7 1.7 0 0019.4 15z"/>`,
    archive:     `<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>`,
    logout:      `<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>`,
    menu:        `<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>`,
  };

  function svgIcon(name, w = 18) {
    return `<svg class="icon" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICONS[name] || ''}</svg>`;
  }

  /* ── Helpers nội bộ ───────────────────────────────────────── */

  /** Lấy tên file hiện tại */
  function currentFile() {
    return window.location.pathname.split('/').pop() || 'dashboard.html';
  }

  /** Escape HTML */
  function e(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Subtitle dưới logo */
  function subtitle(role, user) {
    if (role === 'admin')            return 'Quản Trị Viên';
    if (role === 'department_head')  return e(user?.department?.name || 'Trưởng Khoa');
    return 'BỆNH VIỆN HỮU NGHỊ VIỆT XÔ';
  }

  /** Label vai trò hiển thị */
  function roleLabel(role) {
    return role === 'admin'            ? 'Quản trị viên'
         : role === 'department_head'  ? 'Trưởng Khoa'
         : 'Người dùng';
  }

  /* ── Build HTML ───────────────────────────────────────────── */
  function buildSidebar(role, user) {
    const cfg     = NAV[role] || NAV.user;
    const current = currentFile();
    const canUseLink = link => {
      if (!link.permission || role !== 'user') return true;
      if (window.Auth?.hasPermission) return Auth.hasPermission(link.permission);
      const raw = user?.permissions || user?.userPermissions || user?.permissionKeys || [];
      return Array.isArray(raw) && raw.some(item =>
        (typeof item === 'string' ? item : item?.key || item?.name || item?.permission) === link.permission
      );
    };
    
    // Use absolute paths from root /pages/ instead of relative
    // This prevents URL issues when navigating between pages
    const pathPrefix = '/pages/';
    
    const entries = [...cfg.links, { href: '../'.repeat(cfg.prefix ? 1 : 0) + 'devices.html', icon: 'users', label: 'Thiết bị đăng nhập' }].filter(canUseLink).map(link => {
      const target = new URL(pathPrefix + cfg.prefix + link.href, window.location.origin);
      const isActive = target.pathname.split('/').pop() === current
        && target.searchParams.get('feature') === new URLSearchParams(window.location.search).get('feature');
      const href = target.pathname + target.search;
      const badge    = link.badgeId
        ? `<span class="sb-badge" id="${link.badgeId}" style="display:none">0</span>`
        : '';
      const html = `
        <a href="${href}" class="nav-item${isActive ? ' active' : ''}"${isActive ? ' aria-current="page"' : ''}
           data-label="${e(link.label)}">
          ${svgIcon(link.icon)}
          <span>${e(link.label)}</span>
          ${badge}
        </a>`;
      const filename = target.pathname.split('/').pop();
      const group = filename === 'dashboard.html' ? 'home'
        : ['guide.html', 'devices.html'].includes(filename) ? 'account'
        : ['stats.html', 'monitor.html'].includes(filename) ? 'reports'
        : ['users.html', 'departments.html', 'members.html', 'document-types.html'].includes(filename) ? 'management'
        : 'documents';
      return { html, group, isActive };
    });
    const groups = [
      { key: 'documents', label: 'Hồ sơ & phê duyệt', icon: 'archive' },
      { key: 'management', label: role === 'admin' ? 'Quản lý hệ thống' : 'Quản lý khoa', icon: 'briefcase' },
      { key: 'reports', label: 'Báo cáo & giám sát', icon: 'bar-chart' },
      { key: 'account', label: 'Hỗ trợ & tài khoản', icon: 'help' },
    ];
    const activeGroup = entries.find(entry => entry.isActive)?.group || 'home';
    const links = entries.filter(entry => entry.group === 'home').map(entry => entry.html).join('') + groups.map(group => {
      const children = entries.filter(entry => entry.group === group.key);
      if (!children.length) return '';
      const open = activeGroup === group.key || (activeGroup === 'home' && group.key === 'documents');
      return `<details class="sb-nav-group" data-nav-group="${group.key}"${open ? ' open' : ''}>
        <summary class="sb-group-toggle" title="Mở hoặc thu gọn nhóm ${e(group.label)}">
          ${svgIcon(group.icon)}<span class="sb-group-label">${e(group.label)}</span><span class="sb-group-dot" hidden aria-hidden="true"></span>
          <svg class="sb-group-chevron" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 5 7 7-7 7"/></svg>
        </summary>
        <div class="sb-group-links">${children.map(entry => entry.html).join('')}</div>
      </details>`;
    }).join('');

    const avatarLetter = e((user?.fullName || user?.email || 'U')[0].toUpperCase());

    return `
      <a class="sidebar-logo" href="${pathPrefix}${cfg.prefix}dashboard.html" id="sb-logo" aria-label="Về trang chủ">
        <img src="/assets/images/logo.png" alt="Logo bệnh viện" class="sidebar-logo-img" />
        <div class="sidebar-logo-text">
          <h2>HỆ THỐNG</h2>
          <span>LƯU TRỮ HỒ SƠ</span>
        </div>
      </a>

      <nav class="sidebar-nav" aria-label="Menu chính">
        <span class="nav-section">${e(cfg.section)}</span>
        ${links}
      </nav>

      <div class="sidebar-user">
        <div class="user-avatar">${avatarLetter}</div>
        <div class="user-info">
          <strong>${e(user?.fullName || user?.email || 'Người dùng')}</strong>
          <span>${roleLabel(role)}</span>
        </div>
        <button class="btn-logout" id="btn-logout" title="Đăng xuất" aria-label="Đăng xuất">
          ${svgIcon('logout', 16)}
        </button>
      </div>`;
  }

  /* ── Inject mobile-topbar ─────────────────────────────────── */
  function buildMobileTopbar(activeLabel) {
    // Tìm hoặc tạo mobile-topbar
    let topbar = document.querySelector('.mobile-topbar');
    if (!topbar) {
      topbar = document.createElement('div');
      topbar.className = 'mobile-topbar';
      const main = document.querySelector('.main-content');
      if (main) main.insertBefore(topbar, main.firstChild);
    }

    topbar.innerHTML = `
      <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Mở menu"
        aria-expanded="false" aria-controls="sidebar">
        ${svgIcon('menu')}
      </button>
      <strong>${e(activeLabel)}</strong>`;
  }

  /* ── Wire events ──────────────────────────────────────────── */
  let sidebarCloseOnEscape = null;
  function wireEvents(nav, role) {
    const sidebar  = nav;
    const backdrop = document.getElementById('sidebar-backdrop');

    // Logout
    document.getElementById('btn-logout')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      if (button.disabled) return;
      button.disabled = true;
      try {
        await Auth.logout();
        window.location.href = _pagesRoot() + 'login.html';
      } catch (error) { Toast.error(error.message); button.disabled = false; }
    });

    // Mobile toggle
    const openSidebar  = () => { sidebar.classList.add('open');    backdrop?.classList.add('open');    document.getElementById('mobile-menu-btn')?.setAttribute('aria-expanded','true'); };
    const closeSidebar = () => { sidebar.classList.remove('open'); backdrop?.classList.remove('open'); document.getElementById('mobile-menu-btn')?.setAttribute('aria-expanded','false'); };

    document.getElementById('mobile-menu-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });
    if (backdrop) backdrop.onclick = closeSidebar;

    // Close sidebar on nav-item click (mobile)
    nav.querySelectorAll('a[href]').forEach(a => a.addEventListener('click', closeSidebar));

    // Escape key
    if (sidebarCloseOnEscape) document.removeEventListener('keydown', sidebarCloseOnEscape);
    sidebarCloseOnEscape = e => {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
    };
    document.addEventListener('keydown', sidebarCloseOnEscape);
  }

  /* ── Queue badge ──────────────────────────────────────────── */
  function setSidebarBadge(el, count) {
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.style.display = 'inline-flex';
    } else {
      el.textContent = '0';
      el.style.display = 'none';
    }
    const group = el.closest('.sb-nav-group');
    const dot = group?.querySelector('.sb-group-dot');
    if (dot) dot.hidden = !Array.from(group.querySelectorAll('.sb-badge')).some(badge => badge.style.display !== 'none' && badge.textContent !== '0');
  }

  async function loadQueueBadge(el) {
    // api có thể chưa sẵn sàng nếu sidebar.js load trước app.js
    // dùng setTimeout nhỏ để đảm bảo api đã được khai báo
    await new Promise(r => setTimeout(r, 0));
    if (typeof api === 'undefined') return;
    try {
      const res  = await api.get('/documents/pending');
      const list = Array.isArray(res) ? res : (res.data || res.items || []);
      setSidebarBadge(el, list.length);
    } catch (_) { /* không hiển thị lỗi badge */ }
  }

  async function loadViewRequestsBadge(el) {
    await new Promise(r => setTimeout(r, 0));
    if (typeof api === 'undefined') return;
    try {
      const res = await api.get('/view-requests?status=pending');
      const list = Array.isArray(res) ? res
        : Array.isArray(res?.data) ? res.data
        : Array.isArray(res?.requests) ? res.requests
        : Array.isArray(res?.items) ? res.items
        : [];
      setSidebarBadge(el, list.length);
    } catch (_) { /* không hiển thị lỗi badge */ }
  }

  /* ── Main inject ──────────────────────────────────────────── */
  async function inject() {
    const nav = document.querySelector('nav.sidebar');
    if (!nav) return; // trang không có sidebar (login, etc.)

    const readUser = () => Auth.getUser();
    const renderShell = user => {
      const role = user?.role || 'user';
      const signature = window.NavigationShell?.signature(user) || JSON.stringify([
        user?.id || user?._id || '', role, user?.fullName || '', user?.email || '',
        user?.departmentId || user?.department?.id || '', user?.department?.name || '',
        (Array.isArray(user?.permissions) ? user.permissions : []).map(item => typeof item === 'string' ? item : item?.key || item?.name || item?.permission).filter(Boolean).sort()
      ]);
      if (nav.dataset.navigationSignature !== signature) {
        nav.innerHTML = buildSidebar(role, user);
        nav.dataset.navigationSignature = signature;
      }
      const activeEl = nav.querySelector('.nav-item.active');
      buildMobileTopbar(activeEl?.dataset.label || 'LTHS');
      wireEvents(nav, role);
      _injectDarkModeBtn();
      _injectBreadcrumb(role);
      window.NavigationShell?.remember(nav, user);
      return signature;
    };
    try { await Auth.require(); } catch (error) { Auth.showError(error); return; }
    const initialUser = readUser();
    const initialSignature = renderShell(initialUser);

    if (typeof Auth !== 'undefined' && Auth.ensureFresh) {
      try {
        await Auth.ensureFresh();
      } catch (_) {}
      if (Auth.enforceRoute && !Auth.enforceRoute()) return;
    }

    const refreshedUser = readUser();
    const refreshedSignature = window.NavigationShell?.signature(refreshedUser);
    if (refreshedSignature ? refreshedSignature !== initialSignature : JSON.stringify(refreshedUser) !== JSON.stringify(initialUser)) renderShell(refreshedUser);

    // Load queue badge nếu có
    const badge = document.getElementById('sb-queue-badge');
    if (badge) loadQueueBadge(badge);
    const viewBadge = document.getElementById('sb-view-requests-badge');
    if (viewBadge) loadViewRequestsBadge(viewBadge);

  }

  const prefetchedPages = new Set();
  let navigationIndicator;
  function navigationLink(event) {
    const link = event.target?.closest?.('.sidebar a[href], .main-content a[href]');
    if (!link || link.target || link.hasAttribute('download')) return null;
    const url = new URL(link.href, window.location.href);
    return url.origin === window.location.origin && url.pathname.endsWith('.html') ? { link, url } : null;
  }
  function prefetchNavigation(event) {
    const target = navigationLink(event);
    if (!target || window.navigator?.connection?.saveData || prefetchedPages.has(target.url.href)) return;
    if (target.url.pathname === window.location.pathname && target.url.search === window.location.search) return;
    prefetchedPages.add(target.url.href);
    const hint = document.createElement('link');
    hint.rel = 'prefetch';
    hint.as = 'document';
    hint.href = target.url.href;
    document.head.appendChild(hint);
  }
  document.addEventListener('pointerover', prefetchNavigation, { passive: true });
  document.addEventListener('focusin', prefetchNavigation);
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = navigationLink(event);
    if (!target) return;
    if (target.url.pathname === window.location.pathname && target.url.search === window.location.search) {
      event.preventDefault();
      return;
    }
    clearTimeout(navigationIndicator);
    navigationIndicator = setTimeout(() => document.documentElement.classList.add('page-is-navigating'), 120);
  });
  window.addEventListener('pageshow', () => {
    clearTimeout(navigationIndicator);
    document.documentElement.classList.remove('page-is-navigating');
  });

  /* ── Dark mode button ─────────────────────────────────────── */
  function _injectDarkModeBtn() {
    if (document.getElementById('dark-mode-btn')) return; // đã có
    const btn = document.createElement('button');
    btn.id = 'dark-mode-btn';
    btn.setAttribute('aria-label', 'Chế độ tối');

    // Dùng DarkMode từ app.js nếu có, không thì tự quản lý
    const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark'
                      || localStorage.getItem('lths_dark') === '1';

    const sunSvg  = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
    const moonSvg = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;

    const render = () => {
      const dark = isDark();
      btn.innerHTML = dark ? sunSvg : moonSvg;
      btn.title     = dark ? 'Chế độ sáng' : 'Chế độ tối';
    };

    btn.addEventListener('click', () => {
      if (typeof DarkMode !== 'undefined') {
        DarkMode.toggle();
      } else {
        const dark = !isDark();
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        localStorage.setItem('lths_dark', dark ? '1' : '0');
      }
      render();
    });

    // Áp dụng theme đã lưu khi load
    const saved = localStorage.getItem('lths_dark');
    if (saved === '1') document.documentElement.setAttribute('data-theme', 'dark');

    render();
    document.body.appendChild(btn);
  }

  /* ── Auto breadcrumb theo trang ───────────────────────────── */
  // href dùng đường dẫn tương đối từ vị trí trang hiện tại
  // Từ admin/ hoặc dept-head/ cần '../' để về pages/
  // Từ pages/ dùng './'
  function _makeBreadcrumbItems(role) {
    const file  = currentFile();
    const inSub = window.location.pathname.includes('/admin/') ||
                  window.location.pathname.includes('/dept-head/');
    const base  = inSub ? '../' : './';
    const cfg   = NAV[role] || NAV.user;
    const home  = base + cfg.prefix + 'dashboard.html';
    const homeLabel = role === 'admin'           ? 'Admin'
                    : role === 'department_head' ? 'Trưởng Khoa'
                    : 'LTHS';

    if (file === 'dashboard.html' || file === 'login.html') return null;

    // Tìm label từ NAV config
    const feature = new URLSearchParams(window.location.search).get('feature');
    const navLink = cfg.links.find(link => {
      const target = new URL(link.href, window.location.origin + '/pages/');
      return target.pathname.split('/').pop() === file && target.searchParams.get('feature') === feature;
    });
    const pageLabel = navLink?.label || file.replace('.html', '');

    return [
      { label: homeLabel, href: home },
      { label: pageLabel },
    ];
  }

  function _injectBreadcrumb(role) {
    const items = _makeBreadcrumbItems(role);
    if (!items) return;
    if (typeof renderBreadcrumb === 'function') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => renderBreadcrumb(items));
      } else {
        renderBreadcrumb(items);
      }
    }
  }

  /* ── Run ──────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

})();
