const fs=require('node:fs');
function edit(file,fn){const source=fs.readFileSync(file,'utf8');const nl=source.includes('\r\n')?'\r\n':'\n';fs.writeFileSync(file,fn(source.replace(/\r\n/g,'\n')).replace(/\n/g,nl));}
function replace(s,a,b){if(!s.includes(a))throw Error('Missing marker: '+a);return s.replace(a,b);}
edit('pages/documents.html',s=>{
 s=replace(s,'  const viewStatusByDocId = new Map();',`  const viewStatusByDocId = new Map();
  let viewStatusesLoading = false;
  let documentLoadVersion = 0;
  const ensureSearchContent = createDocumentContentSearch(() => allDocs, renderFiltered);`);
 s=replace(s,'async function loadViewStatusesFromRequests(docs) {','async function loadViewStatusesFromRequests(docs, target = viewStatusByDocId) {');
 const begin=s.indexOf('  async function loadViewStatusesFromRequests');const end=s.indexOf('  async function loadViewStatuses(docs)',begin);
 s=s.slice(0,begin)+s.slice(begin,end).replace('viewStatusByDocId.set(', 'target.set(')+s.slice(end);
 const start=s.indexOf('  async function loadViewStatuses(docs) {');const finish=s.indexOf('  async function loadDocs()',start);
 s=s.slice(0,start)+`  async function loadViewStatuses(docs) {
    const statuses = new Map();
    const candidates = docs.filter(doc => canAccessDocumentSecurity(doc) && !isOwnDocument(doc) && !hasDirectDepartmentViewAccess(doc));
    if (!candidates.length) return statuses;
    const first = candidates[0];
    try {
      statuses.set(getDocumentId(first), normalizeViewStatus(await api.get('/documents/' + getDocumentId(first) + '/view-status')));
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        await loadViewStatusesFromRequests(candidates, statuses);
        return statuses;
      }
      statuses.set(getDocumentId(first), { status: 'none' });
    }
    const entries = await mapWithConcurrency(candidates.slice(1), async doc => {
      const id = getDocumentId(doc);
      try { return [id, normalizeViewStatus(await api.get('/documents/' + id + '/view-status'))]; }
      catch (_) { return [id, { status: 'none' }]; }
    });
    entries.forEach(([id, status]) => statuses.set(id, status));
    return statuses;
  }

`+s.slice(finish);
 s=replace(s,'  async function loadDocs() {\n    await Auth.ensureFresh();',`  async function loadDocs() {
    const version = ++documentLoadVersion;
    await Auth.ensureFresh();
    if (version !== documentLoadVersion) return;`);
 s=replace(s,"api.get('/documents/search?includeContent=true&limit=10000')", "api.get('/documents/search?limit=10000')");
 s=replace(s,'      allDocs = normalizeList(res).filter(d =>','      if (version !== documentLoadVersion) return;\n      allDocs = normalizeList(res).filter(d =>');
 const statusStart=s.indexOf('      await loadViewStatuses(allDocs.filter');const statusEnd=s.indexOf('      renderFiltered();',statusStart)+'      renderFiltered();'.length;
 if(statusStart<0||statusEnd<0)throw Error('Missing status gate');
 s=s.slice(0,statusStart)+`      viewStatusByDocId.clear();
      viewStatusesLoading = true;
      renderFiltered();
      loadViewStatuses(allDocs.filter(d => ['stored', 'approved'].includes(String(d.status || '').toLowerCase())))
        .then(statuses => {
          if (version !== documentLoadVersion) return;
          statuses.forEach((status, id) => viewStatusByDocId.set(id, status));
          viewStatusesLoading = false;
          renderFiltered();
        }).catch(err => {
          if (version !== documentLoadVersion) return;
          viewStatusesLoading = false;
          console.warn('[View status]', err);
          renderFiltered();
        });`+s.slice(statusEnd);
 s=replace(s,"    const kw = document.getElementById('kw-input').value;", "    const kw = document.getElementById('kw-input').value;\n    ensureSearchContent(kw);");
 s=replace(s,"    if (st === 'pending') {\n      return '<span", "    if (viewStatusesLoading && !viewStatusByDocId.has(docId)) return '<span>Đang kiểm tra quyền xem…</span>';\n    if (st === 'pending') {\n      return '<span");
 return s;
});
edit('pages/my-documents.html',s=>{
 s=s.replace('  let   _viewStatuses = new Map();\n','');
 s=s.replace(/^.*_viewStatuses = await loadViewStatusMap.*\n/gm,'');
 s=s.replace(/^.*const nextStatuses = await loadViewStatusMap.*\n/gm,'').replace(/^.*nextStatuses.forEach.*\n/gm,'');
 s=replace(s,'      const responseDocs = normalizeRes(res);',`      const responseDocs = normalizeRes(res);
      if (!_activeTab) _allDocs = responseDocs.filter(canViewDocumentInList);`);
 s=s.replaceAll("'/documents/search?includeContent=true&' + buildParams", "'/documents/search?' + (document.getElementById('kw-input').value.trim() ? 'includeContent=true&' : '') + buildParams");
 const begin=s.indexOf("    api.get('/documents/search?includeContent=true&limit=9999')");
 const end=s.indexOf('    }).catch(() => {});',begin)+'    }).catch(() => {});'.length;
 if(begin<0||end<0)throw Error('Missing duplicate initial request');
 s=s.slice(0,begin)+s.slice(end);
 return s;
});
for(const file of ['pages/admin/search.html','pages/dept-head/documents.html'])edit(file,s=>{
 s=replace(s,"api.get('/documents/search?includeContent=true&limit=10000')", "api.get('/documents/search?limit=10000')");
 s=replace(s,'  function renderFiltered() {',`  const ensureSearchContent = createDocumentContentSearch(() => _allDocs, renderFiltered);

  function renderFiltered() {`);
 s=replace(s,"    const kw = document.getElementById('kw-input').value;", "    const kw = document.getElementById('kw-input').value;\n    ensureSearchContent(kw + ' ' + (document.getElementById('adv-summary')?.value || ''));");
 return s;
});
edit('pages/my-storage.html',s=>{
 s=replace(s,"api.get('/documents?includeContent=true&limit=10000')", "api.get('/documents?limit=10000')");
 s=replace(s,'  function renderFiles() {',`  const ensureSearchContent = createDocumentContentSearch(() => allFiles, renderFiles);

  function renderFiles() {`);
 return replace(s,"    const searchTerm = document.getElementById('search-input').value.trim().toLowerCase();", "    const searchTerm = document.getElementById('search-input').value.trim().toLowerCase();\n    ensureSearchContent(searchTerm);");
});
edit('pages/admin/archive.html',s=>{
 s=replace(s,"api.get('/documents/search?includeContent=true&limit=10000')", "api.get('/documents/search?limit=10000')");
 s=replace(s,'  function performSearch() {',`  const ensureSearchContent = createDocumentContentSearch(() => allDocs, performSearch);

  function performSearch() {`);
 return replace(s,'    searchQuery = query;','    searchQuery = query;\n    ensureSearchContent(query);');
});
console.log('Updated document loading: compact initial payloads, lazy full-content search, nonblocking bounded status checks, removed unused requests.');
