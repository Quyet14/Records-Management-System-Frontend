/* Aggregate reporting only: never count a truncated document search response. */
(function(root) {
  'use strict';
  const keys = ['overview','departments','monthly','types','classification','growth','uploaders','review','expiry'];
  function number(value) { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error('Số liệu báo cáo không hợp lệ.'); return value; }
  function rows(value, fields) { if (!Array.isArray(value)) throw Error('Danh sách báo cáo không hợp lệ.'); value.forEach(row => fields.forEach(field => number(row?.[field]))); return value; }
  function parameters(year, years, limit) {
    year = Number(year); years = Number(years); limit = Number(limit);
    if (!Number.isInteger(year) || year < 1900 || year > 9999 || !Number.isInteger(years) || years < 1 || years > 50 || ![10,25,50,100].includes(limit)) throw Error('Bộ lọc thống kê không hợp lệ.');
    return { year, days:years*365, limit };
  }
  function endpoint(key, options) {
    return { overview:'/stats/overview', departments:'/stats/by-department', monthly:'/stats/by-year?year='+options.year, types:'/stats/by-document-type', classification:'/stats/by-classification', growth:'/stats/storage-growth', uploaders:'/stats/top-uploaders?limit='+options.limit, review:'/stats/review-progress', expiry:'/stats/expiring-soon?days='+options.days }[key];
  }
  function validate(key, data, options) {
    if (key === 'overview') { ['totalDocuments','totalUsers','totalDepartments','storedSizeBytes'].forEach(field => number(data?.[field])); rows(data.byStatus,['count','totalBytes']); }
    else if (key === 'departments') rows(data,['totalDocuments','totalBytes','storedCount','pendingCount','rejectedCount']);
    else if (key === 'monthly') { rows(data?.monthly,['month','totalDocuments','totalBytes']); if (data.year !== options.year || data.monthly.length !== 12 || data.monthly.some((row,index) => row.month !== index+1)) throw Error('Báo cáo tháng không hợp lệ.'); }
    else if (key === 'types') { rows(data?.byType,['totalDocuments','totalBytes','storedCount']); number(data.unclassifiedCount); }
    else if (key === 'classification') rows(data,['count','totalBytes']);
    else if (key === 'growth') { rows(data,['year','month','addedBytes','addedDocs','cumulativeBytes','cumulativeDocs']); if (data.some(row => !Number.isInteger(row.month) || row.month < 1 || row.month > 12)) throw Error('Mốc tăng trưởng không hợp lệ.'); }
    else if (key === 'uploaders') { rows(data,['totalDocuments','totalBytes']); if (data.length > options.limit) throw Error('Báo cáo người tải lên không hợp lệ.'); }
    else if (key === 'review') { ['totalOldDocuments','completed','remaining','completionRate'].forEach(field => number(data?.[field])); if (data.completionRate > 100 || !data.byStatus || typeof data.byStatus !== 'object' || Array.isArray(data.byStatus)) throw Error('Tiến độ chỉnh lý không hợp lệ.'); Object.values(data.byStatus).forEach(number); }
    else if (key === 'expiry') { number(data?.total); if (data.withinDays !== options.days || !Array.isArray(data.data) || data.data.length !== data.total) throw Error('Danh sách thời hạn không hợp lệ.'); data.data.forEach(row => number(row.daysRemaining)); }
    return data;
  }
  async function load(get, options, selected = keys) {
    if (selected.some(key => !keys.includes(key))) throw Error('Báo cáo không hợp lệ.');
    const results = await Promise.allSettled(selected.map(async key => validate(key,await get(endpoint(key,options)),options)));
    return Object.fromEntries(selected.map((key,index) => [key,results[index]]));
  }
  const service = { keys, parameters, load, validate };
  if (typeof module !== 'undefined' && module.exports) { module.exports = service; return; }
  root.AdminStatistics = service;
  const $ = id => document.getElementById(id);
  if (!$('admin-stats-status')) return;
  let cache = {}, generation = 0;
  const charts = [];
  const metrics = { department:'count', monthly:'count', growth:'size' };
  const labels = { stored:'Đã lưu kho', approved:'Đã duyệt', pending:'Chờ duyệt', rejected:'Từ chối', destroyed:'Đã hủy' };
  const values = { permanent:'Vĩnh viễn', timed:'Có thời hạn', unclassified:'Chưa xác định' };
  const reviews = { pending:'Chưa chỉnh lý', in_progress:'Đang chỉnh lý', completed:'Đã hoàn thành' };
  const fmt = value => Number(value).toLocaleString('vi-VN',{maximumFractionDigits:2});
  const data = key => cache[key]?.status === 'fulfilled' ? cache[key].value : null;
  const controls = () => ['year-filter','expiry-years','admin-uploader-limit','admin-stats-refresh'].map($);
  const message = '<p class="admin-stats-note">Không tải được báo cáo này. Bấm Làm mới số liệu để thử lại.</p>';
  function table(headings, entries) {
    return entries.length ? '<div class="table-wrap"><table><thead><tr>'+headings.map(label=>'<th scope="col">'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+entries.map(row=>'<tr>'+row.map(value=>'<td>'+esc(value ?? '—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>' : '<p class="admin-stats-note">Chưa có số liệu trong phạm vi báo cáo.</p>';
  }
  function cards() {
    const overview = data('overview'), types = data('types');
    const count = status => overview ? overview.byStatus.find(row=>row.status === status)?.count || 0 : null;
    const bytes = overview ? overview.byStatus.reduce((sum,row)=>sum+row.totalBytes,0) : null;
    const items = [
      ['Tổng hồ sơ hiện có',overview?.totalDocuments,'brass','s-total'], ['Đã lưu kho',count('stored'),'ok','s-stored'], ['Chờ duyệt',count('pending'),'wait','s-pending'], ['Từ chối',count('rejected'),'deny','s-rejected'], ['Đã hủy',count('destroyed'),'deny','s-destroyed'],
      ['Người dùng',overview?.totalUsers,'brass','s-users'], ['Khoa',overview?.totalDepartments,'brass','s-departments'], ['Dung lượng đã lưu kho',overview ? fmtSize(overview.storedSizeBytes) : null,'ok','s-size'], ['Dung lượng hồ sơ hiện có',bytes === null ? null : fmtSize(bytes),'brass','s-all-size'], ['Chưa gán loại hồ sơ',types?.unclassifiedCount,'wait','s-unclassified']
    ];
    $('summary-stats').innerHTML = items.map(([label,value,variant,id])=>'<div class="stat-card stat-card--'+variant+'"><span class="stats-card-mark" aria-hidden="true">'+({"s-total":'▤',"s-stored":'✓',"s-pending":'◷',"s-rejected":'×',"s-destroyed":'−',"s-users":'♙',"s-departments":'▦',"s-size":'▥',"s-all-size":'▥',"s-unclassified":'!'}[id])+'</span><span class="stat-label">'+esc(label)+'</span><span class="stat-value" id="'+id+'">'+esc(value === null || value === undefined ? '—' : typeof value === 'number' ? fmt(value) : value)+'</span></div>').join('');
  }
  function chart(id,type,label,names,numbers,unit = 'count',horizontal = false) {
    const options = { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:type === 'doughnut'}}, scales:type === 'doughnut' ? {} : { x:{beginAtZero:true}, y:{beginAtZero:true} } };
    if (horizontal) options.indexAxis = 'y';
    if (type !== 'doughnut') {
      const axis = horizontal ? options.scales.x : options.scales.y;
      axis.ticks = unit === 'count' ? {precision:0} : {callback:value=>fmt(value)};
    }
    charts.push(new Chart($(id),{type,data:{labels:names,datasets:[{label,data:numbers}]},options}));
  }
  function render() {
    charts.splice(0).forEach(chart=>chart.destroy()); cards();
    document.querySelectorAll('[data-stats-metric]').forEach(button=>button.setAttribute('aria-pressed',String(metrics[button.dataset.statsMetric]===button.dataset.metric)));
    const summary=data('overview');
    const stored=summary?.byStatus.find(row=>row.status==='stored')?.count||0;
    const rate=summary&&summary.totalDocuments>0?Math.min(100,Math.round(stored/summary.totalDocuments*100)):0;
    $('admin-storage-insight').innerHTML=summary?'<div class="stats-rate-ring" style="--stats-rate:'+rate+'%"><div><strong>'+rate+'<small>%</small></strong><span>đã lưu kho</span></div></div><p class="stats-insight-caption">'+fmt(stored)+' / '+fmt(summary.totalDocuments)+' hồ sơ hiện có</p>':message;
    document.querySelectorAll('[data-admin-error]').forEach(element=>{ const failed=cache[element.dataset.adminError]?.status === 'rejected'; element.hidden=!failed; element.textContent=failed ? 'Không tải được báo cáo này. Bấm Làm mới số liệu để thử lại.' : ''; });
    const overview=data('overview'), departments=data('departments'), monthly=data('monthly'), types=data('types'), classification=data('classification'), growth=data('growth'), uploaders=data('uploaders'), review=data('review'), expiry=data('expiry');
    if (overview) chart('chart-by-status','doughnut','Số hồ sơ',overview.byStatus.map(row=>labels[row.status]||row.status),overview.byStatus.map(row=>row.count));
    $('admin-status-table').innerHTML=overview ? table(['Trạng thái','Số hồ sơ','Dung lượng hồ sơ hiện có'],overview.byStatus.map(row=>[labels[row.status]||row.status,fmt(row.count),fmtSize(row.totalBytes)])) : message;
    $('admin-classification-table').innerHTML=classification ? table(['Mức giá trị','Số hồ sơ (gồm đã hủy)','Dung lượng hồ sơ hiện có'],classification.map(row=>[values[row.classificationValue]||row.classificationValue||'Chưa xác định',fmt(row.count),fmtSize(row.totalBytes)])) : message;
    $('admin-growth-table').innerHTML=growth ? table(['Tháng tải lên','Hồ sơ đã lưu kho','Dung lượng đã lưu kho','Hồ sơ tích lũy','Dung lượng tích lũy'],growth.map(row=>[String(row.month).padStart(2,'0')+'/'+row.year,fmt(row.addedDocs),fmtSize(row.addedBytes),fmt(row.cumulativeDocs),fmtSize(row.cumulativeBytes)])) : message;
    if (departments) {
      const size=metrics.department==='size';
      chart('chart-by-dept','bar',size?'Dung lượng (MB)':'Hồ sơ hiện có',departments.map(row=>row.departmentName||'Chưa phân khoa'),departments.map(row=>size?row.totalBytes/1048576:row.totalDocuments),size?'size':'count');
      $('admin-department-table').innerHTML=table(['Khoa','Hồ sơ hiện có','Đã lưu kho','Chờ duyệt','Từ chối','Dung lượng'],departments.map(row=>[row.departmentName,fmt(row.totalDocuments),fmt(row.storedCount),fmt(row.pendingCount),fmt(row.rejectedCount),fmtSize(row.totalBytes)]));
    } else $('admin-department-table').innerHTML=message;
    if (types) {
      chart('chart-by-doctype','bar','Hồ sơ hiện có',types.byType.map(row=>row.typeName||'Chưa phân loại'),types.byType.map(row=>row.totalDocuments),'count',true);
      $('admin-type-table').innerHTML=table(['Mã loại','Loại hồ sơ','Hồ sơ hiện có','Đã lưu kho','Dung lượng','Bảo quản'],types.byType.map(row=>[row.code||'—',row.typeName,fmt(row.totalDocuments),fmt(row.storedCount),fmtSize(row.totalBytes),row.isPermanent ? 'Vĩnh viễn' : row.retentionYears ? row.retentionYears+' năm' : 'Chưa xác định']));
    } else $('admin-type-table').innerHTML=message;
    if (classification) chart('chart-by-value','doughnut','Số hồ sơ',classification.map(row=>values[row.classificationValue]||row.classificationValue),classification.map(row=>row.count));
    if (monthly) {
      const names=monthly.monthly.map(row=>'T'+row.month);
      const size=metrics.monthly==='size';
      chart('chart-by-month','line',size?'Dung lượng (MB)':'Hồ sơ tải lên',names,monthly.monthly.map(row=>size?row.totalBytes/1048576:row.totalDocuments),size?'size':'count');
    }
    if (growth) {
      const names=growth.map(row=>String(row.month).padStart(2,'0')+'/'+row.year);
      const size=metrics.growth==='size';
      chart('chart-growth-bytes','line',size?'Dung lượng tích lũy (MB)':'Hồ sơ tích lũy',names,growth.map(row=>size?row.cumulativeBytes/1048576:row.cumulativeDocs),size?'size':'count');
    }
    if (uploaders) {
      chart('chart-top-uploaders','bar','Hồ sơ hiện có',uploaders.map(row=>row.fullName||row.email||'Không ghi nhận'),uploaders.map(row=>row.totalDocuments),'count',true);
      $('admin-uploader-table').innerHTML=table(['Người tải lên','Email','Hồ sơ hiện có','Dung lượng'],uploaders.map(row=>[row.fullName||'Không ghi nhận',row.email||'—',fmt(row.totalDocuments),fmtSize(row.totalBytes)]));
    } else $('admin-uploader-table').innerHTML=message;
    if (review) {
      const entries=Object.entries(review.byStatus);
      chart('chart-review-status','bar','Số hồ sơ',entries.map(([status])=>reviews[status]||status),entries.map(([,count])=>count));
      $('review-progress-wrap').innerHTML='<div class="report-progress"><strong>Đã hoàn thành '+fmt(review.completed)+' / '+fmt(review.totalOldDocuments)+' hồ sơ</strong><progress max="100" value="'+review.completionRate+'" aria-label="Tiến độ chỉnh lý">'+review.completionRate+'%</progress><p>Hoàn thành '+fmt(review.completionRate)+'%. Còn '+fmt(review.remaining)+' hồ sơ. Hạn: '+esc(fmtDate(review.deadline))+'. '+(Number.isFinite(review.daysToDeadline) ? (review.daysToDeadline >= 0 ? 'Còn '+fmt(review.daysToDeadline)+' ngày đến hạn.' : 'Đã quá hạn '+fmt(Math.abs(review.daysToDeadline))+' ngày.') : '')+'</p></div>';
    } else $('review-progress-wrap').innerHTML=message;
    if (expiry) $('expiry-table-wrap').innerHTML='<p class="admin-stats-note">'+fmt(expiry.total)+' hồ sơ sắp hết hạn.</p>'+table(['Hồ sơ','Khoa','Loại hồ sơ','Hạn bảo quản','Ngày còn lại'],expiry.data.map(row=>[row.title,row.department,row.documentType,fmtDate(row.expiresAt),fmt(row.daysRemaining)]));
    else $('expiry-table-wrap').innerHTML=message;
  }
  function clear() { charts.splice(0).forEach(chart=>chart.destroy()); $('summary-stats').innerHTML=''; $('admin-storage-insight').innerHTML=''; ['admin-status-table','admin-classification-table','admin-growth-table','admin-department-table','admin-type-table','admin-uploader-table','review-progress-wrap','expiry-table-wrap'].forEach(id=>{$(id).innerHTML='';}); }
  async function reload(selected=keys) {
    const ticket=++generation; controls().forEach(control=>{control.disabled=true;}); $('admin-stats-status').textContent='Đang cập nhật báo cáo…';
    try {
      const options=parameters($('year-filter').value,$('expiry-years').value,$('admin-uploader-limit').value);
      await Auth.requireAdmin();
      const targets=Object.keys(cache).length===keys.length ? selected : keys;
      const results=await load(path=>api.get(path),options,targets);
      if (ticket !== generation) return;
      if (Auth.getUser()?.role !== 'admin') throw Error('Quyền tài khoản đã thay đổi. Vui lòng đăng nhập lại.');
      cache={...cache,...results}; render();
      const failed=keys.filter(key=>cache[key]?.status==='rejected').length;
      $('admin-stats-status').textContent=failed ? 'Có '+failed+' báo cáo chưa tải được. Các mục lỗi được đánh dấu, không tính thành số 0.' : 'Đã cập nhật '+keys.length+' nhóm báo cáo · '+new Date().toLocaleString('vi-VN')+'.';
    } catch(error) { if(ticket!==generation)return; cache={}; clear(); $('admin-stats-status').textContent=error.message||'Không tải được báo cáo.'; }
    finally { if(ticket===generation)controls().forEach(control=>{control.disabled=false;}); }
  }
  document.querySelectorAll('[data-stats-metric]').forEach(button=>button.addEventListener('click',()=>{
    metrics[button.dataset.statsMetric]=button.dataset.metric; render();
  }));
  $('year-filter').value=new Date().getFullYear();
  $('admin-stats-refresh').addEventListener('click',()=>reload());
  $('year-filter').addEventListener('change',()=>reload(['monthly']));
  $('expiry-years').addEventListener('change',()=>reload(['expiry']));
  $('admin-uploader-limit').addEventListener('change',()=>reload(['uploaders']));
  root.addEventListener('lths:session',event=>{ if(event.detail?.user?.role!=='admin'){ generation++; cache={}; clear(); $('admin-stats-status').textContent='Không còn quyền xem báo cáo admin. Vui lòng đăng nhập lại.'; } });
  onPageReady(()=>reload());
})(typeof window!=='undefined'?window:globalThis);
