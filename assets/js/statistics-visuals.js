/* Chart presentation plugin. Does not fetch data or change report scope. */
(() => {
  'use strict';
  if (!window.Chart?.register) return;
  const charts = new Set();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const palette = ['#2185dd','#8265d5','#13a58c','#efa526','#dd5771','#3ba7c5','#af73c7','#627fb3'];
  const format = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('vi-VN', { maximumFractionDigits:2 }) : '—';
  const dark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  const colors = () => ({ text:dark() ? '#d0ddee' : '#33475b', muted:dark() ? '#b0c5da' : '#60788d', line:dark() ? 'rgba(184,210,238,.12)' : 'rgba(41,89,135,.09)', surface:dark() ? '#1e2939' : '#fff' });
  const descriptions = {
    'chart-by-dept':'So sánh khoa theo số hồ sơ hoặc dung lượng; chuyển chỉ số ngay bên dưới.',
    'chart-by-status':'Tỷ trọng hồ sơ theo trạng thái. Bấm chú giải để ẩn hoặc hiện từng nhóm.',
    'chart-by-month':'Theo dõi số hồ sơ hoặc dung lượng tải lên theo năm được chọn.',
    'chart-size-by-dept':'So sánh dung lượng theo khoa. Đơn vị: MB.',
    'chart-by-doctype':'Các loại hồ sơ có số lượng trong toàn bộ thời gian; xem bảng để đối chiếu đầy đủ.',
    'chart-by-value':'Tỷ trọng tài liệu theo mức giá trị, gồm thông tin hồ sơ đã hủy.',
    'chart-month-bytes':'Dung lượng hồ sơ tải lên theo năm được chọn. Đơn vị: MB.',
    'chart-growth-bytes':'Tăng trưởng tích lũy của hồ sơ hiện đã lưu kho, theo tháng tải lên.',
    'chart-growth-documents':'Số hồ sơ hiện đã lưu kho tích lũy theo tháng tải lên.',
    'chart-top-uploaders':'Xếp hạng theo số hồ sơ hiện có, không bao gồm hồ sơ đã hủy.',
    'chart-review-status':'Trạng thái chỉnh lý hồ sơ trước 01/07/2025.',
    'report-status-chart':'Phân bố trạng thái của toàn bộ hồ sơ trong khoa.',
    'report-types-chart':'So sánh số lượng hồ sơ theo từng loại trong khoa.',
    'report-value-chart':'Tỷ trọng hồ sơ vĩnh viễn, có thời hạn và chưa xác định.',
    'report-month-chart':'Số hồ sơ tải lên từng tháng theo năm được chọn.',
    'report-month-size-chart':'Dung lượng tải lên theo tháng. Đơn vị: MB.'
  };
  function theme(chart) {
    const c = colors(), options = chart.config.options;
    options.color = c.text;
    options.animation = reduced.matches ? false : { duration:700, easing:'easeOutQuart' };
    options.interaction = { ...options.interaction, mode:chart.config.type === 'line' ? 'index' : 'nearest', intersect:false };
    const plugins = options.plugins ||= {};
    const legend = plugins.legend ||= {};
    legend.labels = { ...legend.labels, color:c.text, usePointStyle:true, padding:18, font:{ family:'Inter, Segoe UI, sans-serif', size:12 } };
    if (chart.config.type === 'doughnut') legend.display = false;
    plugins.tooltip = { ...plugins.tooltip, backgroundColor:dark() ? '#101f31' : '#153958', titleColor:'#fff', bodyColor:'#e7f2fc', borderColor:dark() ? '#415d78' : '#37638c', borderWidth:1, padding:13, cornerRadius:10, boxPadding:5, titleFont:{ size:12, weight:'600' }, bodyFont:{ size:12 }, displayColors:true };
    Object.entries(options.scales || {}).forEach(([key, axis]) => {
      axis.border = { ...axis.border, display:false };
      axis.grid = { ...axis.grid, color:c.line, drawTicks:false };
      axis.ticks = { ...axis.ticks, color:c.muted, padding:10, font:{ size:11, family:'Inter, Segoe UI, sans-serif' } };
      const category = (options.indexAxis === 'y' ? key === 'y' : key === 'x');
      if (category) axis.grid.display = false;
      else { delete axis.ticks.stepSize; axis.ticks.maxTicksLimit = 6; }
    });
  }
  function donutColors(chart) {
    const status = chart.canvas.id.includes('status');
    return chart.data.labels.map((label, index) => {
      if (!status) { const text=String(label).toLowerCase(); return text.includes('v\u0129nh') ? palette[1] : text.includes('th\u1eddi h\u1ea1n') ? palette[0] : text.includes('ch\u01b0a') ? palette[3] : palette[index % palette.length]; }
      const text = String(label).toLowerCase();
      return text.includes('chờ') ? '#efa526' : text.includes('từ chối') ? '#dd5771' : text.includes('hủy') ? '#7a91a8' : text.includes('đã duyệt') ? '#31a9ba' : '#13a58c';
    });
  }
  function enhanceData(chart) {
    const type = chart.config.type;
    chart.data.datasets.forEach((dataset, index) => {
      if (type === 'doughnut') {
        dataset.backgroundColor = donutColors(chart); dataset.borderColor = colors().surface;
        dataset.borderWidth = 4; dataset.borderRadius = 5; dataset.hoverOffset = 9;
        chart.config.options.cutout = '74%'; chart.config.options.layout = { padding:12 };
      } else if (type === 'bar') {
        dataset.borderRadius = 7; dataset.borderSkipped = false; dataset.maxBarThickness = 38; dataset.borderWidth = 0;
        dataset.backgroundColor = context => {
          const base = palette[(context.dataIndex ?? index) % palette.length];
          const area = context.chart.chartArea;
          if (!area) return base;
          const gradient = context.chart.config.options.indexAxis === 'y' ? context.chart.ctx.createLinearGradient(area.left,0,area.right,0) : context.chart.ctx.createLinearGradient(0,area.bottom,0,area.top);
          gradient.addColorStop(0,base + 'a6'); gradient.addColorStop(1,base); return gradient;
        };
      } else if (type === 'line') {
        dataset.borderColor = '#2185dd'; dataset.borderWidth = 3; dataset.tension = .35;
        dataset.fill = true; dataset.pointRadius = 3; dataset.pointHoverRadius = 7; dataset.pointBackgroundColor = '#2185dd'; dataset.pointBorderColor = colors().surface; dataset.pointBorderWidth = 2;
        dataset.backgroundColor = context => {
          const area = context.chart.chartArea;
          if (!area) return 'rgba(33,133,221,.12)';
          const gradient = context.chart.ctx.createLinearGradient(0,area.top,0,area.bottom);
          gradient.addColorStop(0,'rgba(33,133,221,.27)'); gradient.addColorStop(1,'rgba(33,133,221,.015)'); return gradient;
        };
      }
    });
  }
  function panel(chart) { return chart.canvas.closest('.chart-card, .report-chart-panel'); }
  function exportChart(chart,title) {
    const width = Math.max(640,chart.width), plotHeight = chart.height * width / chart.width;
    const labels = chart.config.type === 'doughnut' ? chart.data.labels : [];
    const legendHeight = labels.length ? Math.ceil(labels.length / 2) * 32 + 28 : 0;
    const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = (plotHeight + 74 + legendHeight) * 2;
    const ctx = canvas.getContext('2d'); ctx.scale(2,2); ctx.fillStyle = colors().surface; ctx.fillRect(0,0,width,canvas.height/2);
    ctx.fillStyle = colors().text; ctx.font = '700 18px Inter, Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(title,24,32,width-48);
    ctx.drawImage(chart.canvas,0,58,width,plotHeight);
    const hues = donutColors(chart);
    labels.forEach((label,index) => {
      const column = index % 2, x = 24 + column * width / 2, y = 76 + plotHeight + Math.floor(index/2)*32;
      ctx.globalAlpha = chart.getDataVisibility(index) ? 1 : .45; ctx.fillStyle = hues[index]; ctx.fillRect(x,y-10,10,10);
      ctx.fillStyle = colors().text; ctx.font = '12px Inter, Segoe UI, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(String(label),x+19,y,width/2-105);
      ctx.textAlign = 'right'; ctx.font = '700 12px Inter, Segoe UI, sans-serif'; ctx.fillText(format(chart.data.datasets[0].data[index]),x+width/2-48,y);
    });
    ctx.globalAlpha = 1;
    const link = document.createElement('a'); link.download = chart.canvas.id + '.png'; link.href = canvas.toDataURL('image/png'); link.click();
  }
  function controls(chart) {
    const container = panel(chart);
    if (!container) return;
    const heading = container.querySelector('h2, h3');
    if (!heading) return;
    let header = heading.closest('.stats-chart-header');
    if (!header) { header = document.createElement('div'); header.className = 'stats-chart-header'; heading.before(header); header.append(heading); }
    const button = document.createElement('button'); button.className = 'stats-chart-export'; button.type = 'button';
    button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></svg> PNG';
    button.setAttribute('aria-label','Tải biểu đồ ' + heading.textContent.trim() + ' dưới dạng PNG');
    button.onclick = () => exportChart(chart,heading.textContent.trim());
    header.append(button); chart.$statsExport = button;
    let subtitle = container.querySelector('.stats-chart-subtitle');
    if (!subtitle) { subtitle = document.createElement('p'); subtitle.className = 'stats-chart-subtitle'; header.after(subtitle); }
    subtitle.textContent = descriptions[chart.canvas.id] || 'Di chuyển con trỏ để xem số liệu chi tiết.';
    if (chart.config.type === 'doughnut') {
      chart.canvas.parentElement.classList.add('stats-donut-wrap');
      const legend = document.createElement('div'); legend.className = 'stats-html-legend'; legend.setAttribute('aria-label','Chú giải biểu đồ'); chart.canvas.parentElement.after(legend); chart.$statsLegend = legend;
    } else if (chart.config.type === 'bar' && chart.config.options.indexAxis === 'y') {
      chart.canvas.parentElement.style.height = Math.min(720,Math.max(300,chart.data.labels.length * 33 + 50)) + 'px';
    }
    if (!container.querySelector('details')) {
      const details = document.createElement('details'); details.className = 'stats-chart-data';
      const summary = document.createElement('summary'); summary.textContent = 'Xem bảng số liệu'; details.append(summary);
      const wrap = document.createElement('div'); wrap.className = 'table-wrap'; details.append(wrap); container.append(details); chart.$statsTable = details;
    }
    chart.canvas.setAttribute('role','img'); chart.canvas.setAttribute('aria-label',heading.textContent.trim());
  }
  function renderLegend(chart) {
    const container = chart.$statsLegend;
    if (!container) return;
    const focused = container.contains(document.activeElement) ? Number(document.activeElement.dataset.index) : -1;
    container.replaceChildren();
    const hues = donutColors(chart);
    chart.data.labels.forEach((label,index) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.index = index; button.setAttribute('aria-pressed',String(chart.getDataVisibility(index)));
      const swatch = document.createElement('span'); swatch.className = 'stats-legend-swatch'; swatch.style.backgroundColor = hues[index]; swatch.setAttribute('aria-hidden','true');
      const text = document.createElement('span'); text.className = 'stats-legend-label'; text.textContent = label;
      const value = document.createElement('strong'); value.textContent = format(chart.data.datasets[0].data[index]);
      button.append(swatch,text,value); button.onclick = () => { chart.toggleDataVisibility(index); chart.update(); }; container.append(button);
      if (focused === index) button.focus();
    });
  }
  function renderTable(chart) {
    if (!chart.$statsTable) return;
    const wrap = chart.$statsTable.querySelector('.table-wrap'); wrap.replaceChildren();
    const table = document.createElement('table'), head = document.createElement('thead'), body = document.createElement('tbody'), row = document.createElement('tr');
    ['Nội dung',...chart.data.datasets.map(dataset => dataset.label || 'Số hồ sơ')].forEach(label => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; row.append(th); }); head.append(row);
    chart.data.labels.forEach((label,index) => { const tr = document.createElement('tr'); [label,...chart.data.datasets.map(dataset => format(dataset.data[index]))].forEach(value => { const td = document.createElement('td'); td.textContent = value; tr.append(td); }); body.append(tr); });
    table.append(head,body); wrap.append(table);
  }
  const plugin = {
    id:'lthsStatistics',
    beforeInit(chart) {
      theme(chart); enhanceData(chart);
      if (chart.config.type === 'doughnut') {
        const tooltip = chart.config.options.plugins.tooltip;
        const original = tooltip.callbacks?.label;
        tooltip.callbacks = { ...tooltip.callbacks, label(context) {
          const values = context.dataset.data.map(Number); const total = values.reduce((sum,value) => sum + (Number.isFinite(value) ? value : 0),0);
          const text = original ? original.call(this,context) : context.label + ': ' + format(context.raw) + ' hồ sơ';
          const pct = total > 0 ? (Number(context.raw) / total * 100).toLocaleString('vi-VN',{maximumFractionDigits:1}) : '0';
          return [...(Array.isArray(text) ? text : [text]), pct + '% tổng số hồ sơ'];
        } };
      }
    },
    afterInit(chart) { charts.add(chart); controls(chart); },
    beforeUpdate(chart) { theme(chart); },
    afterUpdate(chart) { renderLegend(chart); renderTable(chart); },
    beforeDatasetsDraw(chart) { chart.ctx.save(); chart.ctx.shadowColor = dark() ? 'rgba(0,0,0,.2)' : 'rgba(34,79,125,.1)'; chart.ctx.shadowBlur = 7; chart.ctx.shadowOffsetY = 3; },
    afterDatasetsDraw(chart) { chart.ctx.restore(); },
    afterDraw(chart) {
      if (!chart.chartArea) return;
      if (chart.config.type !== 'doughnut') {
        const hasData = chart.data.datasets.some(dataset => dataset.data.some(value => Number.isFinite(Number(value)) && Number(value) !== 0));
        if (!hasData) {
          const ctx = chart.ctx; ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = colors().muted; ctx.font = '12px Inter, Segoe UI, sans-serif';
          ctx.fillText('Ch\u01b0a c\u00f3 d\u1eef li\u1ec7u trong ph\u1ea1m vi n\u00e0y', (chart.chartArea.left + chart.chartArea.right) / 2, (chart.chartArea.top + chart.chartArea.bottom) / 2); ctx.restore();
        }
        return;
      }
      const meta = chart.getDatasetMeta(0), arc = meta.data[0];
      const x = arc?.x ?? (chart.chartArea.left + chart.chartArea.right) / 2, y = arc?.y ?? (chart.chartArea.top + chart.chartArea.bottom) / 2;
      const total = chart.data.datasets[0].data.reduce((sum,value,index) => sum + (chart.getDataVisibility(index) && Number.isFinite(Number(value)) ? Number(value) : 0),0);
      const ctx = chart.ctx; ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = colors().text;
      if (total === 0 && arc?.outerRadius > 0) {
        ctx.beginPath(); ctx.arc(x,y,(arc.outerRadius + arc.innerRadius)/2,0,Math.PI*2); ctx.strokeStyle = colors().line; ctx.lineWidth = Math.max(1,arc.outerRadius-arc.innerRadius); ctx.stroke();
      }
      const room = (arc?.innerRadius ?? 65) * 1.65, text = format(total); let size = 31; ctx.font = '750 ' + size + 'px Inter, Segoe UI, sans-serif';
      while (ctx.measureText(text).width > room && size > 13) { size--; ctx.font = '750 ' + size + 'px Inter, Segoe UI, sans-serif'; }
      ctx.fillText(text,x,y-8); ctx.font = '12px Inter, Segoe UI, sans-serif'; ctx.fillStyle = colors().muted; ctx.fillText('hồ sơ',x,y+20); ctx.restore();
    },
    afterDestroy(chart) { charts.delete(chart); chart.$statsExport?.remove(); chart.$statsLegend?.remove(); chart.$statsTable?.remove(); }
  };
  Chart.register(plugin);
  const update = () => charts.forEach(chart => { theme(chart); chart.update('none'); });
  new MutationObserver(update).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  reduced.addEventListener('change',update);
})();
