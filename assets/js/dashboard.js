/* Presentation only: report data and permissions remain with the page. */
(() => {
  'use strict';
  const dashboard = document.querySelector('[data-dashboard]');
  if (!dashboard) return;
  const date = dashboard.querySelector('#dashboard-date');
  if (date) { const now = new Date(); date.textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }); date.dateTime = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-'); }
  const pointer = matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  dashboard.querySelectorAll('.stat-card').forEach(card => {
    let frame = 0, bounds = null;
    const reset = () => {
      cancelAnimationFrame(frame); frame = 0; bounds = null;
      ['--tilt-x', '--tilt-y', '--light-x', '--light-y'].forEach(key => card.style.removeProperty(key));
    };
    card.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse' && pointer.matches && !reduced.matches) bounds = card.getBoundingClientRect(); });
    card.addEventListener('pointermove', event => {
      if (!bounds || event.pointerType !== 'mouse' || !pointer.matches || reduced.matches) return;
      const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        card.style.setProperty('--tilt-x', ((.5 - y) * 7).toFixed(2) + 'deg');
        card.style.setProperty('--tilt-y', ((x - .5) * 7).toFixed(2) + 'deg');
        card.style.setProperty('--light-x', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--light-y', (y * 100).toFixed(1) + '%');
        frame = 0;
      });
    });
    card.addEventListener('pointerleave', reset);
    card.addEventListener('pointercancel', reset);
    pointer.addEventListener('change', reset); reduced.addEventListener('change', reset);
    window.addEventListener('resize', reset); window.addEventListener('scroll', reset, { passive: true });
  });
})();
