/* Decorative effects only; works with dynamically rendered cards. */
(() => {
  'use strict';
  const main = document.querySelector('.main-content');
  if (!main) return;
  main.querySelectorAll('[style*="grid-template-columns"]').forEach(grid => grid.classList.add('interface-responsive-grid'));
  main.querySelectorAll('.interface-responsive-grid').forEach(grid => {
    const panel = grid.parentElement;
    if (grid.querySelector('input, select') && panel?.tagName === 'DIV' && panel.children.length === 1 && panel !== main) panel.classList.add('interface-filter-panel');
  });
  main.querySelectorAll('#pagination-controls').forEach(pagination => pagination.parentElement.classList.add('interface-results-bar'));
  const pointer = matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let active = null, bounds = null, frame = 0;
  const selector = '.stat-card, .doc-card, .chart-card, .monitor-card, .dept-card';
  function reset() {
    cancelAnimationFrame(frame); frame = 0;
    if (active) { active.classList.remove('interface-depth-active'); active.style.removeProperty('--interface-rx'); active.style.removeProperty('--interface-ry'); active.style.removeProperty('--interface-x'); active.style.removeProperty('--interface-y'); }
    active = null; bounds = null;
  }
  main.addEventListener('pointermove', event => {
    if (!pointer.matches || reduced.matches || event.pointerType !== 'mouse') { reset(); return; }
    const card = event.target.closest(selector);
    if (!card || !main.contains(card) || (main.hasAttribute('data-dashboard') && card.classList.contains('stat-card')) || event.target.closest('button, input, select, textarea, a, canvas, [role="button"]')) { reset(); return; }
    if (card !== active) { reset(); active = card; bounds = card.getBoundingClientRect(); active.classList.add('interface-surface-3d', 'interface-depth-active'); }
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { if (!active) return; active.style.setProperty('--interface-rx', ((.5 - y) * 4).toFixed(2) + 'deg'); active.style.setProperty('--interface-ry', ((x - .5) * 4).toFixed(2) + 'deg'); active.style.setProperty('--interface-x', (x * 100).toFixed(1) + '%'); active.style.setProperty('--interface-y', (y * 100).toFixed(1) + '%'); frame = 0; });
  }, { passive: true });
  main.addEventListener('pointerleave', reset); main.addEventListener('pointercancel', reset); main.addEventListener('pointerdown', reset, { passive: true });
  main.addEventListener('focusin', reset); window.addEventListener('scroll', reset, { passive: true }); window.addEventListener('resize', reset);
  if (!reduced.matches && typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('interface-stage-enter'); observer.unobserve(entry.target); } });
    }, { threshold: .06 });
    Array.from(main.children).filter(element => element.matches('.page-header, .dashboard-hero, .table-wrap, .card, .report-grid')).forEach(element => observer.observe(element));
  }
  pointer.addEventListener('change', reset); reduced.addEventListener('change', reset); window.addEventListener('blur', reset);
})();
