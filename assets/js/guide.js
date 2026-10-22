(async () => {
  'use strict';
  const user = await Auth.require();
  const role = user?.role || 'user';
  const routes = {
    user: { home: 'dashboard.html', documents: 'documents.html', mine: 'my-documents.html' },
    department_head: { home: 'dept-head/dashboard.html', documents: 'dept-head/documents.html', mine: 'dept-head/documents.html' },
    admin: { home: 'admin/dashboard.html', documents: 'admin/search.html', mine: 'admin/search.html' }
  };
  const links = routes[role] || routes.user;
  document.querySelectorAll('[data-guide-link]').forEach(link => { link.href = links[link.dataset.guideLink] || links.home; });
  document.getElementById('guide-role').textContent = ({ user: 'Dành cho nhân viên', department_head: 'Dành cho Trưởng khoa', admin: 'Dành cho Admin' })[role] || 'Hướng dẫn sử dụng';
  const topics = [...document.querySelectorAll('[data-guide-topic]')];
  const nav = [...document.querySelectorAll('.guide-toc a')];
  const search = document.getElementById('guide-search');
  const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
  const allowed = topic => !topic.dataset.guideSection || topic.dataset.guideSection === role;
  const indexed = new Map(topics.map(topic => [topic, normalize(topic.textContent)]));
  function filter() {
    const words = normalize(search.value).split(' ').filter(Boolean);
    let count = 0;
    topics.forEach(topic => {
      topic.hidden = !allowed(topic) || !words.every(word => indexed.get(topic).includes(word));
      if (!topic.hidden) count++;
    });
    nav.forEach(link => { link.hidden = !!document.getElementById(link.hash.slice(1))?.hidden; });
    document.getElementById('guide-no-results').hidden = count > 0;
    document.getElementById('guide-search-status').textContent = words.length
      ? `Tìm thấy ${count} mục hướng dẫn phù hợp.` : 'Tra cứu theo chức năng hoặc tình huống bạn đang gặp.';
  }
  document.getElementById('guide-search-form').addEventListener('submit', event => { event.preventDefault(); filter(); });
  search.addEventListener('input', filter);
  document.getElementById('guide-search-clear').addEventListener('click', () => { search.value = ''; filter(); search.focus(); });
  function revealTarget(hash) {
    if (!hash || !topics.some(topic => '#' + topic.id === hash && allowed(topic))) return;
    if (search.value) { search.value = ''; filter(); }
  }
  document.querySelectorAll('[data-guide] a[href^="#"]').forEach(link => link.addEventListener('click', () => revealTarget(link.hash)));
  window.addEventListener('hashchange', () => revealTarget(location.hash));
  document.getElementById('guide-print').addEventListener('click', () => window.print());
  let closedBeforePrint = [];
  window.addEventListener('beforeprint', () => {
    closedBeforePrint = [...document.querySelectorAll('.guide-faq details:not([open])')];
    closedBeforePrint.forEach(detail => { detail.open = true; });
  });
  window.addEventListener('afterprint', () => { closedBeforePrint.forEach(detail => { detail.open = false; }); closedBeforePrint = []; });
  filter();
  if (typeof IntersectionObserver === 'function') {
    const visible = new Set();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target); });
      const current = topics.find(topic => !topic.hidden && visible.has(topic));
      if (!current) return;
      nav.forEach(link => { link.hash === '#' + current.id ? link.setAttribute('aria-current', 'location') : link.removeAttribute('aria-current'); });
    }, { rootMargin: '-10% 0px -45% 0px', threshold: 0 });
    topics.filter(allowed).forEach(topic => observer.observe(topic));
  }
})().catch(Auth.showError);
