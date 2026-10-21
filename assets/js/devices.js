(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let sessions = [], busy = false;
  const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('vi-VN') : '—';
  const current = session => session.isCurrent === true || session.current === true || session.isCurrentSession === true;
  async function work(task) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('main button').forEach(button => { button.disabled = true; });
    $('sessions-status').textContent = 'Đang xử lý…';
    try { await task(); $('sessions-status').textContent = ''; }
    catch (error) { $('sessions-status').textContent = error.message; }
    finally { busy = false; document.querySelectorAll('main button').forEach(button => { button.disabled = false; }); }
  }
  async function load() {
    const response = await api.get('/auth/sessions'), data = response?.data ?? response;
    const items = Array.isArray(data) ? data : data?.items || data?.sessions;
    if (!Array.isArray(items)) throw new Error('Danh sách thiết bị không hợp lệ.');
    sessions = items;
    $('sessions-list').innerHTML = items.length ? `<div class="table-wrap"><table><thead><tr><th>Trình duyệt / IP</th><th>Hoạt động gần nhất</th><th>Hết hạn phiên</th><th></th></tr></thead><tbody>${items.map(session => `<tr>
      <td>${esc(session.userAgent || 'Không rõ trình duyệt')}${current(session) ? ' · Thiết bị hiện tại' : ''}<br>${esc(session.ipAddress || session.ip || '—')}</td>
      <td>${esc(stamp(session.lastSeenAt || session.lastActivityAt))}</td><td>${esc(stamp(session.expiresAt || session.absoluteExpiresAt))}</td>
      <td><button type="button" class="btn btn-ghost" data-revoke="${esc(session.id)}">Đăng xuất thiết bị</button></td></tr>`).join('')}</tbody></table></div>` : '<p>Không có phiên đăng nhập.</p>';
  }
  $('sessions-reload').addEventListener('click', () => work(load));
  $('sessions-list').addEventListener('click', event => {
    const button = event.target.closest('[data-revoke]');
    if (!button || busy) return;
    const session = sessions.find(item => String(item.id) === button.dataset.revoke);
    if (!session) return;
    work(async () => {
      await api.del('/auth/sessions/' + encodeURIComponent(session.id));
      if (current(session)) { Auth.clear(); window.location.href = _pagesRoot() + 'login.html'; }
      else await load();
    });
  });
  $('sessions-logout-all').addEventListener('click', () => work(async () => {
    await Auth.logoutAll(); window.location.href = _pagesRoot() + 'login.html';
  }));
  onPageReady(() => work(async () => { await Auth.require(); await load(); }));
})();
