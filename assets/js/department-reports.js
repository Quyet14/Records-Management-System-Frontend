/* Report endpoints enforce the current department on the server. Never fall back to global document search. */
(function (root) {
  'use strict';
  const identity = value => String(typeof value === 'object' ? value?.id || value?._id || '' : value || '');
  function scope(user) {
    if (user?.role !== 'department_head') throw new Error('Chỉ Trưởng khoa được xem báo cáo khoa.');
    const id = identity(user.departmentId || user.department);
    if (!id) throw new Error('Tài khoản chưa được gán khoa. Vui lòng liên hệ quản trị viên.');
    return id;
  }
  function number(value) {
    if (value === null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0)
      throw new Error('Số liệu báo cáo từ máy chủ không hợp lệ.');
    return Number(value);
  }
  function array(value) {
    if (!Array.isArray(value)) throw new Error('Danh sách báo cáo từ máy chủ không hợp lệ.');
    return value;
  }
  function page(value) {
    array(value?.data);
    if (!Number.isInteger(value.total) || value.total < 0 || !Number.isInteger(value.page) || value.page < 1
      || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100)
      throw new Error('Dữ liệu phân trang báo cáo không hợp lệ.');
    return value;
  }
  function yearValue(value) {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error('Năm phải là số nguyên từ 1900 đến 9999.');
    return year;
  }
  function overview(value) {
    ['totalDocuments', 'totalUsers', 'storedSizeBytes'].forEach(key => number(value?.[key]));
    array(value.byStatus).forEach(row => number(row.count));
    return value;
  }
  function expiryDays(value = 365) {
    const days = Number(value);
    if (![180, 365, 730, 1825].includes(days)) throw new Error('Khoảng thời gian cảnh báo không hợp lệ.');
    return days;
  }
  function reviewProgress(value) {
    ['totalOldDocuments', 'completed', 'remaining', 'completionRate'].forEach(key => number(value?.[key]));
    if (number(value.completionRate) > 100) throw new Error('Tiến độ chỉnh lý từ máy chủ không hợp lệ.');
    return value;
  }
  async function loadStats(user, get, year, days = 365) {
    scope(user);
    const targetYear = yearValue(year);
    const warningDays = expiryDays(days);
    const [summary, types, monthly, values, progress, expiring] = await Promise.all([
      get('/stats/overview'), get('/stats/by-document-type'), get('/stats/by-year?year=' + targetYear),
      get('/stats/by-classification'), get('/retention/review-summary'), get('/retention/expiring?days=' + warningDays)
    ]);
    overview(summary);
    array(types?.byType).forEach(row => number(row.totalDocuments));
    if (monthly?.year !== targetYear || array(monthly?.monthly).length !== 12
      || monthly.monthly.some((row, index) => row.month !== index + 1)) throw new Error('Báo cáo tháng từ máy chủ không hợp lệ.');
    monthly.monthly.forEach(row => { number(row.totalDocuments); number(row.totalBytes); });
    array(values).forEach(row => number(row.count));
    reviewProgress(progress); array(expiring);
    return { summary, types, monthly, values, progress, expiring };
  }
  async function loadMonitor(user, get, pages, action = '', days = 365) {
    scope(user);
    if (!['', 'approve', 'reject', 'auto-approve (private)'].includes(action)) throw new Error('Bộ lọc lịch sử không hợp lệ.');
    const query = kind => {
      const current = pages[kind] || 1;
      if (!Number.isInteger(current) || current < 1 || current > 1000000) throw new Error('Trang báo cáo không hợp lệ.');
      return new URLSearchParams({ page: current, limit: 20 });
    };
    const warningDays = expiryDays(days);
    const historyQuery = query('history');
    if (action) historyQuery.set('action', action);
    const [summary, missing, review, progress, expiring, history] = await Promise.all([
      get('/stats/overview'), get('/system/missing-checksums?' + query('checksums')),
      get('/retention/pending-review?' + query('review')), get('/retention/review-summary'),
      get('/retention/expiring?days=' + warningDays), get('/system/audit-logs?' + historyQuery)
    ]);
    overview(summary); page(missing); page(review); page(history); array(expiring);
    reviewProgress(progress);
    return { summary, missing, review, progress, expiring, history };
  }
  const reports = { scope, loadStats, loadMonitor };
  if (typeof module !== 'undefined' && module.exports) { module.exports = reports; return; }
  root.DepartmentReports = reports;

  const $ = id => document.getElementById(id);
  const mode = document.querySelector('[data-department-report]')?.dataset.departmentReport;
  if (!mode) return;
  let serial = 0;
  let activeScope = null;
  const charts = [];
  const pages = { checksums: 1, review: 1, history: 1 };
  const labels = { stored: 'Đã lưu kho', approved: 'Đã duyệt', pending: 'Chờ duyệt', rejected: 'Từ chối', destroyed: 'Đã hủy' };
  const actions = { approve: 'Duyệt', reject: 'Từ chối', 'auto-approve (private)': 'Tự động duyệt (riêng tư)' };
  const icons = {
    documents: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></svg>',
    stored: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h18v5H3zM5 9v11h14V9M9 13h6"/></svg>',
    pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    rejected: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6m0-6 6 6"/></svg>',
    size: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>',
    checksum: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3 7 21M17 3l-2 18M4 8h16M3 16h16"/></svg>',
    review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    expiry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
  };
  const date = value => value ? fmtDate(value) : '—';
  function table(headings, rows) {
    return rows.length ? `<div class="table-wrap"><table><thead><tr>${headings.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
      : '<p class="report-empty">Chưa có dữ liệu phù hợp trong khoa.</p>';
  }
  function cards(items) {
    return items.map(([label, value, variant, icon]) => `<div class="stat-card stat-card--${variant}"><div class="stat-icon" aria-hidden="true">${icons[icon]}</div><span class="stat-label">${esc(label)}</span><span class="stat-value">${esc(value)}</span></div>`).join('');
  }
  function themeChart(options) {
    const dark = document.documentElement?.getAttribute('data-theme') === 'dark';
    const color = dark ? '#d0ddee' : '#33475b';
    options.color = color;
    if (options.plugins?.legend?.labels) options.plugins.legend.labels.color = color;
    Object.values(options.scales || {}).forEach(axis => {
      axis.ticks = { ...axis.ticks, color };
      axis.grid = { ...axis.grid, color: dark ? 'rgba(190,210,235,.15)' : 'rgba(51,71,91,.12)' };
    });
  }
  if (typeof MutationObserver === 'function') new MutationObserver(() => {
    charts.forEach(chart => { themeChart(chart.config.options); chart.update('none'); });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  function createChart(id, config) {
    if (typeof Chart === 'undefined') throw new Error('Không tải được thư viện biểu đồ. Vui lòng tải lại trang.');
    themeChart(config.options);
    charts.push(new Chart($(id), config));
  }
  function destroyCharts() {
    charts.splice(0).forEach(chart => chart.destroy());
  }
  function chartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { usePointStyle: true, boxWidth: 10, padding: 18 } }
      }
    };
  }
  function pager(kind, payload) {
    const pages = Math.max(1, Math.ceil(payload.total / payload.limit));
    return `<div class="report-toolbar report-pagination"><button type="button" class="btn btn-ghost btn-sm" data-report-page="${kind}" data-page="${payload.page - 1}" ${payload.page <= 1 ? 'disabled' : ''}>Trước</button><span>Trang ${payload.page}/${pages} · ${payload.total} kết quả</span><button type="button" class="btn btn-ghost btn-sm" data-report-page="${kind}" data-page="${payload.page + 1}" ${payload.page >= pages ? 'disabled' : ''}>Sau</button></div>`;
  }
  function renderStats(data) {
    const { summary, types, monthly, values, progress, expiring } = data;
    const count = status => summary.byStatus.find(row => row.status === status)?.count || 0;
    const statusRows = summary.byStatus.map(row => ({ label: labels[row.status] || row.status, count: number(row.count) }));
    const typeRows = types.byType.map(row => ({ label: row.typeName || 'Chưa phân loại', count: number(row.totalDocuments) }));
    const monthLabels = monthly.monthly.map(row => `T${row.month}`);
    const colors = ['#26734d', '#bd8b2d', '#b54747', '#44536f', '#4791c3', '#7a65a8'];
    $('report-summary').innerHTML = cards([
      ['Tổng hồ sơ hiện có', summary.totalDocuments, 'brass', 'documents'],
      ['Đã lưu kho', count('stored'), 'ok', 'stored'],
      ['Chờ duyệt', count('pending'), 'wait', 'pending'],
      ['Từ chối', count('rejected'), 'deny', 'rejected'],
      ['Dung lượng đã lưu kho', fmtSize(summary.storedSizeBytes), 'brass', 'size']
    ]);
    $('report-stats-progress').innerHTML = progressMarkup(progress);
    $('report-stats-expiry').innerHTML = expiryMarkup(expiring);
    const valueLabels = { permanent: 'Vĩnh viễn', timed: 'Có thời hạn', unclassified: 'Chưa xác định' };
    $('report-values').innerHTML = table(['Mức giá trị', 'Số hồ sơ'], values.map(row => '<tr><td>' + esc(valueLabels[row.classificationValue] || row.classificationValue) + '</td><td>' + number(row.count) + '</td></tr>'));
    $('report-year-label').textContent = monthly.year;
    $('report-status').innerHTML = table(['Trạng thái', 'Số hồ sơ'], statusRows.map(row => `<tr><td>${esc(row.label)}</td><td>${row.count}</td></tr>`));
    $('report-types').innerHTML = table(['Loại hồ sơ', 'Số hồ sơ'], typeRows.map(row => `<tr><td>${esc(row.label)}</td><td>${row.count}</td></tr>`));
    $('report-months').innerHTML = table(['Tháng', 'Hồ sơ', 'Dung lượng'], monthly.monthly.map(row => `<tr><td>Tháng ${row.month}</td><td>${number(row.totalDocuments)}</td><td>${esc(fmtSize(row.totalBytes))}</td></tr>`));
    createChart('report-status-chart', {
      type: 'doughnut',
      data: { labels: statusRows.map(row => row.label), datasets: [{ data: statusRows.map(row => row.count), backgroundColor: summary.byStatus.map(row => ({ stored: '#2F6F4E', approved: '#287b85', pending: '#B98A2E', rejected: '#A33B3B', destroyed: '#64748b' })[row.status] || '#64748b'), borderColor: '#fff', borderWidth: 2, hoverOffset: 6 }] },
      options: { ...chartOptions(), cutout: '62%', plugins: { ...chartOptions().plugins, legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 10, padding: 16 } } } }
    });
    createChart('report-value-chart', {
      type: 'doughnut',
      data: { labels: values.map(row => valueLabels[row.classificationValue] || row.classificationValue), datasets: [{ data: values.map(row => number(row.count)), backgroundColor: values.map(row => ({ permanent: '#2F6F4E', timed: '#1B2A4A', unclassified: '#B98A2E' })[row.classificationValue] || '#64748b'), borderWidth: 3, borderColor: '#fff' }] },
      options: { ...chartOptions(), cutout: '62%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 18 } } } }
    });
    createChart('report-types-chart', {
      type: 'bar',
      data: { labels: typeRows.map(row => row.label), datasets: [{ data: typeRows.map(row => row.count), backgroundColor: typeRows.map((_, index) => colors[(index + 3) % colors.length]), borderRadius: 6, borderSkipped: false }] },
      options: { ...chartOptions(), indexAxis: 'y', plugins: { ...chartOptions().plugins, legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } }
    });
    createChart('report-month-chart', {
      type: 'line',
      data: { labels: monthLabels, datasets: [{ label: 'Hồ sơ tải lên', data: monthly.monthly.map(row => number(row.totalDocuments)), borderColor: '#263b63', backgroundColor: 'rgba(38,59,99,.10)', fill: true, tension: .35, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: '#bd8b2d', pointBorderColor: '#263b63' }] },
      options: { ...chartOptions(), plugins: { ...chartOptions().plugins, legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
    createChart('report-month-size-chart', {
      type: 'bar',
      data: { labels: monthLabels, datasets: [{ label: 'Dung lượng (MB)', data: monthly.monthly.map(row => number(row.totalBytes) / 1048576), backgroundColor: '#598b73', borderRadius: 6, borderSkipped: false }] },
      options: { ...chartOptions(), indexAxis: 'y', plugins: { ...chartOptions().plugins, legend: { display: false }, tooltip: { callbacks: { label: context => `${context.parsed.x.toFixed(2)} MB` } } }, scales: { x: { beginAtZero: true, ticks: { callback: value => `${Number(value).toFixed(2)} MB` } }, y: { grid: { display: false } } } }
    });
  }
  function progressMarkup(progress) { return `<div class="report-progress"><div class="report-progress-heading"><strong>Tiến độ chỉnh lý</strong><strong>${number(progress.completed)}/${number(progress.totalOldDocuments)}</strong></div><progress max="100" value="${number(progress.completionRate)}" aria-label="Tiến độ chỉnh lý">${number(progress.completionRate)}%</progress><p>Đã hoàn thành ${number(progress.completionRate)}%. Còn ${number(progress.remaining)} hồ sơ. Hạn hoàn thành: ${esc(date(progress.deadline))}.</p></div>`; }
  function expiryMarkup(expiring) { return table(['Hồ sơ', 'Loại hồ sơ', 'Hạn bảo quản', 'Số ngày còn lại'], expiring.map(doc => `<tr><td>${esc(doc.title)}</td><td>${esc(doc.documentType || '—')}</td><td>${esc(date(doc.expiresAt))}</td><td>${esc(doc.daysRemaining)}</td></tr>`)); }
  function renderMonitor(data) {
    const { summary, missing, review, progress, expiring, history } = data;
    $('report-summary').innerHTML = cards([
      ['Dung lượng đã lưu kho', fmtSize(summary.storedSizeBytes), 'brass', 'size'],
      ['Thiếu checksum', missing.total, 'deny', 'checksum'],
      ['Chờ chỉnh lý', review.total, 'wait', 'review'],
      ['Sắp hết hạn trong ' + ({ 180: '6 tháng', 365: '1 năm', 730: '2 năm', 1825: '5 năm' })[expiryDays($('report-expiry-days').value || 365)], expiring.length, 'wait', 'expiry']
    ]);
    $('report-count-review').textContent = review.total;
    $('report-count-expiry').textContent = expiring.length;
    $('report-count-checksums').textContent = missing.total;
    $('report-checksum-status').innerHTML = missing.total
      ? `<div class="report-warning">${number(missing.total)} hồ sơ chưa có SHA-256 trong danh sách theo dõi.</div>`
      : '<div class="report-success">✓ Không có hồ sơ thiếu SHA-256 trong danh sách theo dõi.</div>';
    $('report-checksums').innerHTML = table(['Hồ sơ thiếu checksum', 'Mã hồ sơ', 'Trạng thái', 'Ngày tải'], missing.data.map(doc => `<tr><td>${esc(doc.title)}</td><td>${esc(doc.documentNumber || doc.id)}</td><td>${esc(labels[doc.status] || doc.status)}</td><td>${esc(date(doc.createdAt))}</td></tr>`)) + pager('checksums', missing);
    $('report-review-progress').innerHTML = progressMarkup(progress);
    $('report-review').innerHTML = table(['Hồ sơ cần chỉnh lý', 'Loại hồ sơ', 'Ngày hình thành'], review.data.map(doc => `<tr><td>${esc(doc.title)}</td><td>${esc(doc.documentType || '—')}</td><td>${esc(date(doc.documentDate))}</td></tr>`)) + pager('review', review);
    $('report-expiry').innerHTML = expiryMarkup(expiring);
    $('report-history').innerHTML = table(['Thời gian', 'Người xử lý', 'Hành động', 'Hồ sơ', 'Lý do'], history.data.map(log => {
      const action = actions[log.action] || log.action;
      const badge = log.action === 'reject' ? ' report-action-badge--reject' : log.action === 'auto-approve (private)' ? ' report-action-badge--auto' : '';
      return `<tr><td>${esc(log.createdAt ? new Date(log.createdAt).toLocaleString('vi-VN') : '—')}</td><td>${esc(log.actorName || 'Không ghi nhận')}</td><td><span class="report-action-badge${badge}">${esc(action)}</span></td><td>${esc(log.documentTitle || log.documentId || '—')}</td><td>${esc(log.metadata?.reason || '—')}</td></tr>`;
    })) + pager('history', history);
  }
  function clear() {
    destroyCharts();
    $('report-summary').innerHTML = '';
    ['review', 'expiry', 'checksums'].forEach(kind => { const count = $('report-count-' + kind); if (count) count.textContent = '—'; });
    document.querySelectorAll('[data-report-content]').forEach(el => { el.innerHTML = ''; });
  }
  async function reload() {
    const ticket = ++serial;
    clear();
    $('report-message').textContent = 'Đang tải báo cáo khoa…';
    $('report-refresh').disabled = true;
    try {
      const user = await Auth.requireDeptHead();
      const id = scope(user);
      activeScope = id;
      $('report-department').textContent = user.department?.name || 'Khoa của bạn';
      const get = path => api.get(path);
      const data = mode === 'stats' ? await loadStats(user, get, $('report-year').value, $('report-expiry-days').value || 365)
        : await loadMonitor(user, get, pages, $('report-history-filter').value, $('report-expiry-days').value || 365);
      if (ticket !== serial) return;
      if (scope(Auth.getUser()) !== id) throw new Error('Khoa của tài khoản đã thay đổi. Vui lòng tải lại trang.');
      mode === 'stats' ? renderStats(data) : renderMonitor(data);
      $('report-message').textContent = `Dữ liệu thuộc khoa của bạn. Cập nhật: ${new Date().toLocaleString('vi-VN')}.`;
    } catch (error) {
      if (ticket !== serial) return;
      clear();
      $('report-message').textContent = error.status === 403
        ? `Không được phép xem báo cáo khoa. ${error.message || 'Kiểm tra quyền Trưởng khoa và khoa được gán cho tài khoản.'}`
        : error.message || 'Không tải được báo cáo. Bấm Tải lại để thử lại.';
    } finally { if (ticket === serial) $('report-refresh').disabled = false; }
  }
  $('report-expiry-days')?.addEventListener('change', reload);
  const tabKinds = ['review', 'expiry', 'checksums'];
  function activateTab(kind) {
    tabKinds.forEach(key => {
      const selected = key === kind;
      $('report-tab-' + key).setAttribute('aria-selected', String(selected));
      $('report-tab-' + key).tabIndex = selected ? 0 : -1;
      $('report-tab-' + key).classList.toggle('active', selected);
      $('report-panel-' + key).hidden = !selected;
    });
  }
  if (mode === 'monitor') tabKinds.forEach((kind, index) => {
    const button = $('report-tab-' + kind);
    button.addEventListener('click', () => activateTab(kind));
    button.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
      if (next < 0) return;
      event.preventDefault(); activateTab(tabKinds[next]); $('report-tab-' + tabKinds[next]).focus();
    });
  });
  $('report-year')?.addEventListener('change', reload);
  $('report-history-filter')?.addEventListener('change', () => { pages.history = 1; reload(); });
  $('report-refresh').addEventListener('click', reload);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-report-page]');
    if (!button || button.disabled || $('report-refresh').disabled) return;
    const kind = button.dataset.reportPage;
    if (!Object.hasOwn(pages, kind)) return;
    pages[kind] = Number(button.dataset.page);
    reload();
  });
  if ($('report-year')) $('report-year').value = new Date().getFullYear();
  root.addEventListener('lths:session', event => {
    const user = event.detail?.user;
    if (!user) {
      serial++;
      activeScope = null;
      clear();
      $('report-message').textContent = 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.';
      return;
    }
    try {
      const nextScope = scope(user);
      if (activeScope && activeScope !== nextScope) reload();
    } catch (error) {
      serial++;
      activeScope = null;
      clear();
      $('report-message').textContent = error.message || 'Không thể xác định khoa của tài khoản.';
    }
  });
  onPageReady(reload);
})(typeof window !== 'undefined' ? window : globalThis);
