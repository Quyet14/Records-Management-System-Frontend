(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rules = window.DestructionRules;
  const state = {
    ready: false, capabilities: null, selected: new Map(), eligible: [], detail: null,
    pages: { requests: 1, eligible: 1, destroyed: 1 }, serial: {}, serverOffset: 0,
    activeTab: 'requests', previewUrl: null, busy: false, challenge: null
  };
  const now = () => Date.now() + state.serverOffset;
  const date = value => value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
  const id = value => encodeURIComponent(String(value));
  const key = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const unwrap = response => response?.data ?? response;
  const size = bytes => Number.isFinite(Number(bytes)) ? `${(Number(bytes) / 1048576).toFixed(2)} MB` : '—';
  const attachmentLabels = { decision: 'Quyết định hủy', council_minutes: 'Biên bản họp', destruction_minutes: 'Biên bản hủy' };
  function attachmentName(file) {
    // A sanitized name may have lost bytes permanently; never guess the original name.
    for (const raw of [file.originalFilename, file.filename, file.displayName, file.title]) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const name = repairMojibakeStrict(raw).trim();
      if (!looksMojibakeText(name) && !/[ÃÂÄÆ][ _\u0080-\u00bf]/.test(name)) return name;
    }
    return '';
  }
  const statusHtml = status => `<span class="destruction-status" data-status="${esc(status)}">${esc(rules.labels[status] || status || 'Chưa xác định')}</span>`;
  function approvalText(item) {
    const count = Number.isInteger(item.approvalCount) ? item.approvalCount
      : Array.isArray(item.approvals) ? item.approvals.length : null;
    return count !== null && Number.isInteger(item.requiredApprovals) && item.requiredApprovals > 0
      ? `${count}/${item.requiredApprovals} lượt duyệt` : 'Chưa có đủ thông tin lượt duyệt';
  }
  function failureText(item) {
    return item.failureReason || 'Chưa có nguyên nhân lỗi từ hệ thống. Cần quản trị viên kiểm tra nhật ký xử lý hủy trên máy chủ.';
  }
  const can = action => state.ready && rules.canAction(state.detail, action, Auth.getUser(), now());

  async function request(path, options = {}, base = '/destruction') {
    const headers = { Authorization: `Bearer ${Auth.getToken()}`, ...options.headers };
    if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await Auth.fetch(API + base + path, { ...options, headers, cache: 'no-store' });
    if (response.status === 401) {
      Auth.clear(); window.location.href = _pagesRoot() + 'login.html';
      throw new Error('Phiên đăng nhập đã hết hạn.');
    }
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const fallback = base === '/destruction' && [404, 501].includes(response.status)
        ? 'Backend chưa cung cấp API hủy hồ sơ. Chức năng chưa thể sử dụng.' : `Không thể xử lý yêu cầu (HTTP ${response.status}).`;
      const error = new Error(Array.isArray(body?.message) ? body.message.join('; ') : body?.message || fallback);
      error.status = response.status; error.code = body?.code || body?.error?.code;
      throw error;
    }
    return unwrap(body);
  }

  function message(container, text, error = false) {
    container.innerHTML = `<p class="destruction-notice${error ? ' destruction-error' : ''}">${esc(text)}</p>`;
  }
  function table(headings, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headings.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  function pagination(kind, payload) {
    const target = $(`${kind}-pagination`);
    const pages = Math.max(1, Math.ceil(payload.total / payload.pageSize));
    target.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" data-page-kind="${kind}" data-page="${payload.page - 1}" ${payload.page <= 1 ? 'disabled' : ''}>Trước</button>
      <span>Trang ${payload.page}/${pages} · ${payload.total} kết quả</span>
      <button type="button" class="btn btn-ghost btn-sm" data-page-kind="${kind}" data-page="${payload.page + 1}" ${payload.page >= pages ? 'disabled' : ''}>Sau</button>`;
  }
  async function list(kind, path, params, render, fetchPage) {
    const serial = (state.serial[kind] || 0) + 1;
    state.serial[kind] = serial;
    const button = $(`${kind}-filter`).querySelector('[type="submit"]');
    button.classList.add('loading');
    button.setAttribute('aria-busy', 'true');
    message($(`${kind}-list`), 'Đang tải…');
    $(`${kind}-pagination`).innerHTML = '';
    try {
      const query = new URLSearchParams({ ...params, page: state.pages[kind], pageSize: 20 });
      const data = fetchPage ? await fetchPage() : await request(`${path}?${query}`);
      if (serial !== state.serial[kind]) return;
      if (!Array.isArray(data?.items) || !Number.isInteger(data.total) || data.total < 0
        || !Number.isInteger(data.page) || data.page < 1 || !Number.isInteger(data.pageSize) || data.pageSize < 1) {
        throw new Error('Dữ liệu phân trang từ backend không hợp lệ.');
      }
      render(data.items);
      pagination(kind, data);
    } catch (error) {
      if (serial === state.serial[kind]) message($(`${kind}-list`), error.message, true);
    } finally {
      if (serial === state.serial[kind]) {
        button.classList.remove('loading');
        button.removeAttribute('aria-busy');
      }
    }
  }
  function loadRequests() {
    return list('requests', '/requests', { status: $('request-status').value }, items => {
      items = items.filter(item => rules.canViewRequest(item, Auth.getUser()));
      if (!items.length) return message($('requests-list'), 'Chưa có đề nghị phù hợp.');
      $('requests-list').innerHTML = table(['Mã đề nghị / Quyết định', 'Người lập', 'Trạng thái', 'Lịch hủy', ''], items.map(item => `<tr>
        <td><strong>${esc(item.code)}</strong><br>${esc(item.decisionNumber)}</td><td>${esc(item.createdBy?.fullName || '—')}</td>
        <td>${statusHtml(item.status)}<br><small>${esc(approvalText(item))}</small>${item.status === 'failed' ? `<p class="destruction-error">${esc(item.failureReason || 'Hủy chưa hoàn tất. Bấm Chi tiết để xem nguyên nhân và lịch sử xử lý.')}</p>` : ''}</td>
        <td>${esc(date(item.executeAfter))}</td><td><button type="button" class="btn btn-ghost btn-sm" data-detail="${esc(item.id)}">Chi tiết</button></td></tr>`));
    });
  }
  function loadEligible() {
    const query = $('eligible-query').value.trim();
    const page = state.pages.eligible;
    return list('eligible', '/eligible-documents', { q: query }, items => {
      state.eligible = items;
      if (!items.length) return message($('eligible-list'), query
        ? 'Không tìm thấy hồ sơ khớp với từ khóa. Thử tìm theo tên, mã hoặc loại hồ sơ khác.'
        : 'Không có hồ sơ đã duyệt hoặc lưu kho phù hợp với quyền lập đề nghị của bạn.');
      $('eligible-list').innerHTML = table(['Chọn', 'Hồ sơ / Loại hồ sơ', 'Hết hạn bảo quản', 'Độ mật', 'Điều kiện'], items.map(doc => {
        const blocked = rules.proposalBlockReason(doc, Auth.getUser());
        const allowed = !blocked;
        return `<tr><td><input type="checkbox" data-select-document="${esc(doc.id)}" aria-label="Chọn ${esc(doc.title)}" ${state.selected.has(String(doc.id)) ? 'checked' : ''} ${allowed ? '' : 'disabled'} /></td>
          <td><strong>${esc(doc.title)}</strong><br>${esc(doc.code || doc.id)} · ${esc(doc.documentType?.name || '—')}</td>
          <td>${esc(date(doc.retentionUntil))}</td><td>${esc(documentSecurityLabel(doc.securityLevel))}</td>
          <td>${esc(blocked || (rules.eligible(doc, now()) ? 'Đủ điều kiện' : 'Có thể chọn lập đề nghị; điều kiện hủy sẽ được kiểm tra khi gửi.'))}</td></tr>`;
      }));
    }, async () => {
      // Proposing uses the same warehouse as the archive. The destruction
      // endpoint only lists documents that already meet execution conditions.
      const data = await request('/search?limit=10000', {}, '/documents');
      const documents = Array.isArray(data) ? data : data?.documents ?? data?.items;
      if (!Array.isArray(documents)) throw new Error('Dữ liệu hồ sơ trong kho từ backend không hợp lệ.');
      const actor = Auth.getUser();
      const keyword = normalizeSearchText(query);
      const items = documents.map(doc => ({ ...doc, id: getDocumentId(doc) }))
        .filter(doc => ['stored', 'approved'].includes(doc.status))
        .filter(doc => actor?.role !== 'user' || !rules.proposalBlockReason(doc, actor))
        .filter(doc => !keyword || normalizeSearchText([doc.title, doc.code, doc.documentType?.name].join(' ')).includes(keyword));
      return { items: items.slice((page - 1) * 20, page * 20), total: items.length, page, pageSize: 20 };
    });
  }

  function loadDestroyed() {
    return list('destroyed', '/destroyed-documents', { q: $('destroyed-query').value.trim() }, items => {
      if (!items.length) return message($('destroyed-list'), $('destroyed-query').value.trim()
        ? 'Không tìm thấy hồ sơ đã hủy khớp với từ khóa.'
        : 'Chưa có hồ sơ được xác nhận hủy thành công trong phạm vi bạn được xem. Đề nghị đang chờ, đang xử lý hoặc hủy lỗi không đồng nghĩa hồ sơ đã hủy. Xem tab “Đề nghị hủy” và bấm “Chi tiết” để kiểm tra trạng thái.');
      $('destroyed-list').innerHTML = table(['Hồ sơ', 'Ngày hủy', 'Quyết định / Người duyệt', 'SHA-256 lúc hủy', 'Đề nghị'], items.map(doc => `<tr>
        <td><strong>${esc(doc.title)}</strong><br>${esc(doc.code || doc.id)}<br>${esc(size(doc.sizeBytes))}</td>
        <td>${esc(date(doc.destroyedAt))}</td><td>${esc(doc.decisionNumber)}<br>${esc((doc.approvers || []).map(a => a.fullName).join(', '))}</td>
        <td><code>${esc(doc.checksumAtDestruction || '—')}</code></td>
        <td>${doc.requestId ? `<button type="button" class="btn btn-ghost btn-sm" data-destroyed-request="${esc(doc.requestId)}">Xem thông tin hủy</button>` : '—'}</td></tr>`));
    });
  }
  async function switchTab(tab) {
    if (!['requests', 'create', 'destroyed'].includes(tab) || state.busy) return;
    if (tab === 'create' && (!state.ready || state.capabilities.canCreate !== true)) return;
    state.activeTab = tab;
    document.querySelectorAll('[data-tab]').forEach(button => {
      button.classList.toggle('btn-primary', button.dataset.tab === tab);
      button.classList.toggle('btn-ghost', button.dataset.tab !== tab);
      button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
    });
    for (const name of ['requests', 'create', 'destroyed']) $(`panel-${name}`).hidden = name !== tab;
    const url = new URL(location.href); url.searchParams.set('view', tab); history.replaceState(null, '', url);
    if (tab === 'requests') await loadRequests();
    if (tab === 'create') await loadEligible();
    if (tab === 'destroyed') await loadDestroyed();
  }
  function renderSelection() {
    $('selection-count').textContent = `Đã chọn ${state.selected.size}/${state.capabilities.maxItemsPerRequest} hồ sơ`;
    $('selected-documents').innerHTML = [...state.selected.values()].map(doc => `<button type="button" class="btn btn-ghost btn-sm" data-remove-document="${esc(doc.id)}" aria-label="Bỏ chọn ${esc(doc.title)}">${esc(doc.title)} ×</button>`).join('');
  }
  function policyText(policy) {
    if (!policy) return 'Chưa có thông tin chính sách backup.';
    return `Chính sách bản sao lưu: ${policy.version}\n` + policy.targets.map(target =>
      `${target.label}: loại khỏi các lần sao lưu mới ngay khi hủy; bản sao cũ được xóa trong tối đa ${target.purgeWithinDays} ngày. ${target.notes || ''}`
    ).join('\n');
  }
  function attachmentHtml(attachments) {
    if (!attachments?.length) return '<p>Chưa có chứng từ.</p>';
    return table(['Chứng từ', 'SHA-256', 'Người tải / Ngày tải', ''], attachments.map(file => `<tr>
      <td>${esc(attachmentLabels[file.type] || file.type)}<br>${esc(attachmentName(file) || 'Tên tệp chưa khả dụng')}</td><td><code>${esc(file.sha256)}</code></td>
      <td>${esc(file.uploadedBy?.fullName || '—')}<br>${esc(date(file.createdAt))}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-preview="${esc(file.id)}">Xem PDF</button>
      <button type="button" class="btn btn-ghost btn-sm" data-download="${esc(file.id)}">Tải chứng từ</button></td></tr>`));
  }
  function renderDetail() {
    const d = state.detail;
    if (!d) return;
    const items = d.items || [];
    $('request-detail').innerHTML = `
      <div class="destruction-toolbar"><h2 class="destruction-grow">Đề nghị ${esc(d.code)}</h2><button type="button" class="btn btn-ghost" data-refresh-detail>Tải lại chi tiết</button><button type="button" class="btn btn-ghost" data-close-detail>Đóng</button></div>
      <p>${statusHtml(d.status)} · ${esc(approvalText(d))}</p>
      <div class="destruction-fields"><p><strong>Người lập:</strong> ${esc(d.createdBy?.fullName)}<br><strong>Ngày lập:</strong> ${esc(date(d.createdAt))}</p>
        <p><strong>Quyết định:</strong> ${esc(d.decisionNumber)}<br><strong>Ngày quyết định:</strong> ${esc(d.decisionDate || '—')}</p></div>
      <p><strong>Lý do:</strong> <span style="white-space:pre-wrap">${esc(d.reason)}</span></p>
      ${d.executeAfter ? `<div class="destruction-notice">Lịch hủy: ${esc(date(d.executeAfter))}<br><span id="destruction-countdown"></span></div>` : ''}
      ${d.status === 'failed' ? `<p class="destruction-notice destruction-error" role="alert"><strong>Hủy chưa hoàn tất.</strong> ${esc(failureText(d))}<br>Kiểm tra kết quả từng hồ sơ và lịch sử xử lý bên dưới. Nếu đã hủy được một phần, các hồ sơ được xác nhận hủy thành công vẫn nằm trong “Đã hủy”.</p>`
        : d.failureReason ? `<p class="destruction-notice destruction-error">${esc(d.failureReason)}</p>` : ''}
      <h3>Hồ sơ trong đề nghị</h3>
      ${table(['Tên / Mã hồ sơ', 'Dung lượng', 'SHA-256', 'Kết quả'], items.map(item => `<tr><td>${esc(item.title)}<br>${esc(item.code || item.documentId)}</td>
        <td>${esc(size(item.sizeBytes))}</td><td><code>${esc(item.checksumAtDestruction || item.checksum || '—')}</code></td>
        <td>${esc(item.status || '—')}<br>${esc(date(item.destroyedAt))}</td></tr>`))}
      <h3>Chứng từ lưu bất biến</h3>${attachmentHtml(d.attachments)}
      <h3>Lịch sử xử lý</h3><ol class="destruction-timeline">${(d.events || []).map(event => `<li>${esc(date(event.createdAt))} · ${esc(event.actorName || 'Hệ thống')} · ${esc(event.description)}</li>`).join('') || '<li>Chưa có sự kiện.</li>'}</ol>
      <div id="detail-actions">${actionForms()}</div>`;
    $('request-detail').hidden = false;
    state.challenge = null;
    updateCountdown();
  }
  function actionForms() {
    let html = '';
    if (['admin', 'department_head'].includes(Auth.getUser()?.role) && ['pending', 'partially_approved'].includes(state.detail?.status) && !can('approve')) {
      html += `<p class="destruction-notice" role="status"><strong>Chưa thể xác nhận duyệt:</strong> ${esc(!state.ready ? 'Dịch vụ chưa sẵn sàng cho thao tác duyệt. Xem trạng thái dịch vụ ở đầu trang.' : rules.approvalBlockReason(state.detail, Auth.getUser()))}</p>`;
    }
    if (can('approve')) html += `<form data-action-form="approve" class="destruction-detail">
      <h3>Duyệt đề nghị</h3>
      <label class="destruction-check"><input type="checkbox" name="reviewed" required />Tôi đã xem quyết định hủy, kiểm tra dấu, chữ ký và danh sách hồ sơ.</label>
      <button type="button" class="btn btn-ghost" data-send-otp>Yêu cầu mã OTP</button><p id="otp-status" class="destruction-muted" role="status"></p>
      <label class="form-label form-label-required" for="approval-otp">Mã OTP *</label>
      <input id="approval-otp" class="form-control" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" maxlength="8" required />
      <button type="submit" class="btn btn-primary" style="margin-top:12px">Xác nhận duyệt</button>
      <p class="destruction-muted">Chờ ${state.capabilities.waitHours} giờ tính từ lượt duyệt cuối cùng. Mã OTP chỉ dùng cho đề nghị và phiên duyệt này.</p>
    </form>`;
    for (const [action, label] of [['reject', 'Từ chối đề nghị'], ['withdraw', 'Thu hồi đề nghị']]) {
      if (can(action)) html += `<form data-action-form="${action}" class="destruction-detail"><h3>${label}</h3>
        <label class="form-label form-label-required" for="${action}-reason">Lý do *</label>
        <textarea id="${action}-reason" class="form-control" name="reason" maxlength="4000" required></textarea>
        <button type="submit" class="btn btn-reject" style="margin-top:12px">${label}</button></form>`;
    }
    if (can('complete')) html += `<form data-action-form="complete" class="destruction-detail"><h3>Đóng hồ sơ</h3>
      <label class="form-label form-label-required" for="completion-file">Biên bản hủy — PDF scan có dấu, chữ ký *</label>
      <input id="completion-file" class="form-control" type="file" name="minutes" accept=".pdf,application/pdf" required />
      <label class="form-label form-label-required" for="backup-notes">Ghi nhận việc xử lý bản sao lưu *</label>
      <textarea id="backup-notes" class="form-control" name="backupNotes" maxlength="4000" placeholder="Ghi rõ từng đích: ổ ngoài, cloud, NAS; đã xóa hay còn chờ đến hạn, thời hạn theo chính sách…" required></textarea>
      <label class="destruction-check"><input type="checkbox" name="confirmed" required />Biên bản có dấu, chữ ký và ghi nhận đúng tình trạng bản sao lưu ở từng đích.</label>
      <button type="submit" class="btn btn-primary">Đính kèm và hoàn tất</button></form>`;
    return html || '<p class="destruction-muted">Không có thao tác khả dụng cho tài khoản ở trạng thái hiện tại.</p>';
  }
  async function showDetail(requestId, focus = true) {
    if (state.busy) return;
    const serial = (state.serial.detail || 0) + 1; state.serial.detail = serial;
    state.detail = null; state.challenge = null;
    $('request-detail').hidden = false; message($('request-detail'), 'Đang tải chi tiết…');
    try {
      const data = await request(`/requests/${id(requestId)}`);
      if (serial !== state.serial.detail) return;
      if (!data?.id || !Number.isInteger(data.version)) throw new Error('Chi tiết đề nghị thiếu mã hoặc phiên bản dữ liệu.');
      if (!rules.canViewRequest(data, Auth.getUser())) throw new Error('Bạn chỉ được xem yêu cầu hủy và chứng từ của mình.');
      state.detail = data; renderDetail();
      if (focus) $('request-detail').focus();
    } catch (error) {
      if (serial === state.serial.detail) message($('request-detail'), error.message, true);
    }
  }
  function updateCountdown() {
    const target = $('destruction-countdown');
    if (!target || !state.detail) return;
    if (state.detail.status !== 'scheduled') { target.textContent = 'Trạng thái do hệ thống xử lý và xác nhận.'; return; }
    const remaining = Date.parse(state.detail.executeAfter) - now();
    if (remaining > 0) {
      const minutes = Math.ceil(remaining / 60000);
      target.textContent = `Còn khoảng ${Math.floor(minutes / 60)} giờ ${minutes % 60} phút. Có thể thu hồi trước thời điểm hủy nếu được cấp quyền.`;
    } else {
      target.textContent = 'Đã đến lịch hủy; đang chờ backend xác nhận kết quả. Bấm tải lại chi tiết để cập nhật.';
      const button = document.querySelector('[data-action-form="withdraw"] button[type="submit"]');
      if (button) button.disabled = true;
    }
  }
  async function validatePdf(file) {
    if (!file) throw new Error('Vui lòng đính kèm chứng từ PDF.');
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) throw new Error('Chứng từ phải là file PDF.');
    if (file.size === 0 || file.size > state.capabilities.maxPdfBytes) throw new Error(`PDF phải có dung lượng lớn hơn 0 và tối đa ${size(state.capabilities.maxPdfBytes)}.`);
    const header = new TextDecoder('ascii').decode(await file.slice(0, 5).arrayBuffer());
    if (header !== '%PDF-') throw new Error('File không có định dạng PDF hợp lệ.');
    return file;
  }
  async function busy(container, work) {
    if (state.busy) return false;
    state.busy = true;
    const button = container.querySelector('[type="submit"]');
    button?.classList.add('loading');
    const controls = [...new Set([...container.querySelectorAll('button, input, select, textarea'),
      ...document.querySelectorAll('.destruction-page button, .destruction-page input, .destruction-page select, .destruction-page textarea')])];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try { await work(); return true; }
    catch (error) { Toast.error(error.message); return false; }
    finally { button?.classList.remove('loading'); controls.forEach((control, index) => { control.disabled = disabled[index]; }); state.busy = false; updateCountdown(); }
  }
  function mutationOptions(form, body, version) {
    form.dataset.idempotencyKey ||= key();
    return { method: 'POST', headers: {
      'Idempotency-Key': form.dataset.idempotencyKey,
      ...(Number.isInteger(version) ? { 'If-Match': `"${version}"` } : {})
    }, body: body instanceof FormData ? body : JSON.stringify(body) };
  }
  async function createRequest(event) {
    event.preventDefault();
    const form = event.target;
    if (!state.ready || state.capabilities.canCreate !== true || !form.reportValidity() || state.busy) return;
    if (!state.selected.size) return Toast.warning('Chọn ít nhất một hồ sơ để lập đề nghị.');
    if (!['admin', 'department_head', 'user'].includes(Auth.getUser()?.role)) return;
    if ([...state.selected.values()].some(doc => rules.proposalBlockReason(doc, Auth.getUser())))
      return Toast.warning('Hồ sơ đã chọn không thuộc phạm vi được gửi yêu cầu hủy.');
    const reason = $('destruction-reason').value.trim(), number = $('decision-number').value.trim();
    if (!reason || !number) return Toast.warning('Nhập số quyết định và lý do, không chỉ khoảng trắng.');
    const decision = $('decision-file').files[0], council = $('council-file').files[0];
    const body = new FormData();
    body.append('documentIds', JSON.stringify([...state.selected.keys()]));
    body.append('reason', reason); body.append('decisionNumber', number); body.append('decisionDate', $('decision-date').value);
    body.append('backupPolicyVersion', state.capabilities.backupPolicy.version); body.append('signedDocumentConfirmed', 'true');
    let createdId;
    const succeeded = await busy(form, async () => {
      await validatePdf(decision); if (council) await validatePdf(council);
      body.append('decisionFile', decision); if (council) body.append('councilMinutesFile', council);
      const result = await request('/requests', mutationOptions(form, body));
      if (!result?.id) throw new Error('Backend chưa trả mã đề nghị. Tải lại danh sách trước khi thử gửi lại.');
      createdId = result.id;
      state.selected.clear(); renderSelection(); form.reset(); delete form.dataset.idempotencyKey;
      Toast.success('Đã gửi đề nghị hủy và lưu chứng từ.');
    });
    if (succeeded) { await switchTab('requests'); await showDetail(createdId); }
  }
  async function sendOtp(button) {
    if (!can('approve') || state.busy) return;
    const form = button.closest('form');
    if (!form.elements.reviewed.checked) return Toast.warning('Xem chứng từ và xác nhận đã kiểm tra trước khi yêu cầu OTP.');
    const detail = state.detail;
    state.challenge = null;
    await busy(form, async () => {
      const result = await request(`/requests/${id(detail.id)}/otp-challenges`, {
        method: 'POST', headers: { 'If-Match': `"${detail.version}"` }, body: JSON.stringify({ purpose: 'approve' })
      });
      if (!result?.challengeId || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('Phản hồi OTP không hợp lệ.');
      state.challenge = { ...result, requestId: detail.id, version: detail.version };
      form.elements.otp.value = ''; delete form.dataset.idempotencyKey;
      $('otp-status').textContent = `${result.message || 'Dùng mã OTP được backend cấp hoặc từ ứng dụng xác thực.'} Hết hạn: ${date(result.expiresAt)}`;
    });
  }
  async function submitAction(event) {
    const form = event.target.closest('[data-action-form]');
    if (!form) return;
    event.preventDefault();
    const action = form.dataset.actionForm;
    if (!can(action) || state.busy) return Toast.warning('Thao tác không còn khả dụng. Tải lại chi tiết để cập nhật.');
    if (!form.reportValidity()) return;
    const detail = state.detail;
    let body;
    if (action === 'approve') {
      const challenge = state.challenge;
      if (!challenge || challenge.requestId !== detail.id || challenge.version !== detail.version || Date.parse(challenge.expiresAt) <= now()) {
        return Toast.warning('Yêu cầu mã OTP mới trước khi duyệt.');
      }
      body = { challengeId: challenge.challengeId, otp: form.elements.otp.value.trim(), documentsReviewed: true };
    } else if (action === 'complete') {
      const notes = form.elements.backupNotes.value.trim();
      if (!notes) return Toast.warning('Ghi nhận tình trạng xử lý bản sao lưu.');
      body = new FormData(); body.append('backupDispositionNotes', notes); body.append('signedDocumentConfirmed', 'true');
    } else {
      const reason = form.elements.reason.value.trim();
      if (!reason) return Toast.warning('Nhập lý do, không chỉ khoảng trắng.');
      body = { reason };
    }
    const file = action === 'complete' ? form.elements.minutes.files[0] : null;
    const succeeded = await busy(form, async () => {
      if (file) body.append('destructionMinutesFile', await validatePdf(file));
      if (action === 'complete' && !file) throw new Error('Cần đính kèm biên bản hủy.');
      await request(`/requests/${id(detail.id)}/${action}`, mutationOptions(form, body, detail.version));
      if (action === 'approve') form.elements.otp.value = '';
      state.challenge = null;
      Toast.success('Đã ghi nhận thao tác. Đang tải trạng thái từ hệ thống.');
    });
    if (succeeded) await Promise.all([loadRequests(), showDetail(detail.id, false)]);
  }
  async function openAttachment(attachmentId, download) {
    const detail = state.detail;
    const file = detail?.attachments?.find(attachment => String(attachment.id) === attachmentId);
    if (!file || !rules.canViewRequest(detail, Auth.getUser())) return;
    try {
      const response = await Auth.fetch(`${API}/destruction/requests/${id(detail.id)}/attachments/${id(attachmentId)}/content`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }, cache: 'no-store'
      });
      if (!response.ok) throw new Error('Không thể đọc chứng từ hoặc bạn không còn quyền truy cập.');
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf')) throw new Error('Chứng từ trả về không phải PDF.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement('a'); link.href = url; link.download = attachmentName(file);
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        closePreview(); state.previewUrl = url;
        $('attachment-preview-title').textContent = attachmentName(file) || 'Xem chứng từ';
        $('attachment-frame').src = url; $('attachment-preview').showModal();
      }
    } catch (error) { Toast.error(error.message); }
  }
  function closePreview() {
    $('attachment-preview').close(); $('attachment-frame').removeAttribute('src');
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
  function bindEvents() {
    document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
    for (const [formId, kind, load] of [['requests-filter', 'requests', loadRequests], ['eligible-filter', 'eligible', loadEligible], ['destroyed-filter', 'destroyed', loadDestroyed]]) {
      $(formId).addEventListener('submit', event => { event.preventDefault(); if (state.busy || (kind === 'eligible' && !state.ready)) return; state.pages[kind] = 1; load(); });
    }
    $('create-form').addEventListener('submit', createRequest);
    $('request-detail').addEventListener('submit', submitAction);
    document.addEventListener('input', event => {
      const form = event.target.closest('form'); if (form) delete form.dataset.idempotencyKey;
    });
    document.addEventListener('change', event => {
      const form = event.target.closest('form'); if (form) delete form.dataset.idempotencyKey;
      const checkbox = event.target.closest('[data-select-document]');
      if (!checkbox || !state.ready || state.busy) return;
      const doc = state.eligible.find(item => String(item.id) === checkbox.dataset.selectDocument);
      if (!doc) return;
      if (!checkbox.checked) state.selected.delete(String(doc.id));
      else if (!rules.proposalBlockReason(doc, Auth.getUser()) && state.selected.size < state.capabilities.maxItemsPerRequest) state.selected.set(String(doc.id), doc);
      else { checkbox.checked = false; Toast.warning(rules.proposalBlockReason(doc, Auth.getUser()) || 'Đã đạt giới hạn lựa chọn hồ sơ.'); }
      delete $('create-form').dataset.idempotencyKey; renderSelection();
    });
    document.addEventListener('click', async event => {
      const button = event.target.closest('button'); if (!button || button.disabled || state.busy) return;
      if (button.dataset.pageKind) {
        const kind = button.dataset.pageKind; state.pages[kind] = Number(button.dataset.page);
        await ({ requests: loadRequests, eligible: loadEligible, destroyed: loadDestroyed })[kind]();
      } else if (button.dataset.detail) await showDetail(button.dataset.detail);
      else if (button.dataset.destroyedRequest) { await switchTab('requests'); await showDetail(button.dataset.destroyedRequest); }
      else if (button.hasAttribute('data-close-detail')) {
        state.serial.detail = (state.serial.detail || 0) + 1; state.detail = null; state.challenge = null; $('request-detail').hidden = true;
      } else if (button.hasAttribute('data-refresh-detail') && state.detail) await showDetail(state.detail.id, false);
      else if (button.hasAttribute('data-send-otp')) await sendOtp(button);
      else if (button.dataset.removeDocument) {
        state.selected.delete(button.dataset.removeDocument); delete $('create-form').dataset.idempotencyKey; renderSelection();
        document.querySelectorAll('[data-select-document]').forEach(input => { input.checked = state.selected.has(input.dataset.selectDocument); });
      } else if (button.dataset.preview) await openAttachment(button.dataset.preview, false);
      else if (button.dataset.download) await openAttachment(button.dataset.download, true);
    });
    $('close-preview').addEventListener('click', closePreview);
    $('attachment-preview').addEventListener('cancel', event => { event.preventDefault(); closePreview(); });
    window.addEventListener('pagehide', closePreview);
  }
  async function init() {
    await Auth.require();
    if (!['admin', 'department_head', 'user'].includes(Auth.getUser()?.role)) {
      $('service-status').textContent = 'Tài khoản không có quyền sử dụng chức năng hủy hồ sơ.';
      $('service-status').classList.add('destruction-error');
      document.querySelectorAll('.destruction-tabs button').forEach(button => { button.disabled = true; }); return;
    }
    bindEvents();
    const view = new URLSearchParams(location.search).get('view');
    const initialTab = view === 'destroyed' ? 'destroyed' : 'requests';
    // Render the tab and start its read request while capabilities checks run.
    const initialRead = switchTab(initialTab);
    try {
      const caps = await request('/capabilities');
      if (caps?.enabled !== true) {
        throw new Error(Array.isArray(caps?.unavailableReasons) && caps.unavailableReasons.length
          ? caps.unavailableReasons.join('; ') : 'Dịch vụ hủy hồ sơ chưa sẵn sàng.');
      }
      if (caps?.enabled !== true || !Number.isFinite(Date.parse(caps.serverTime))
        || !Number.isInteger(caps.maxPdfBytes) || caps.maxPdfBytes <= 0
        || !Number.isInteger(caps.maxItemsPerRequest) || caps.maxItemsPerRequest <= 0
        || (!Number.isSafeInteger(caps.waitHours) || caps.waitHours <= 0) || !caps.backupPolicy?.version || !Array.isArray(caps.backupPolicy.targets)
        || !['external', 'cloud', 'nas'].every(target => caps.backupPolicy.targets.some(item => item.key === target && Number.isInteger(item.purgeWithinDays) && item.purgeWithinDays >= 0))) {
        throw new Error('Dịch vụ chưa sẵn sàng hoặc thiếu cấu hình thời gian chờ, chứng từ và chính sách backup.');
      }
      state.capabilities = caps; state.ready = true; state.serverOffset = Date.parse(caps.serverTime) - Date.now();
      $('destruction-wait-title').textContent = `2. Duyệt và chờ ${caps.waitHours} giờ`;
      $('service-status').textContent = '';
      $('service-status').hidden = true;
      document.querySelector('[data-tab="create"]').disabled = caps.canCreate !== true;
      $('create-submit').disabled = caps.canCreate !== true;
      $('pdf-limit').textContent = `PDF tối đa ${size(caps.maxPdfBytes)}/tệp.`;
      $('backup-policy').textContent = policyText(caps.backupPolicy); renderSelection();
      if (state.detail) renderDetail();
      await initialRead;
      if (view === 'create' && caps.canCreate === true) await switchTab('create');
      setInterval(updateCountdown, 15000);
    } catch (error) {
      $('service-status').hidden = false;
      $('service-status').textContent = error.message; $('service-status').classList.add('destruction-error');
      await initialRead;
    }
  }
  init().catch(error => { $('service-status').hidden = false; $('service-status').textContent = error.message; });
})();
