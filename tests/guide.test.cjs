const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('pages/guide.html', 'utf8');
const sidebar = fs.readFileSync('assets/js/sidebar.js', 'utf8');
const script = fs.readFileSync('assets/js/guide.js', 'utf8');

test('guide page is linked from every role navigation and uses the shared shell', () => {
  assert.match(sidebar, /href: 'guide\.html', icon: 'help', label: 'Hướng dẫn sử dụng'/);
  assert.equal((sidebar.match(/href: '\.\.\/guide\.html'.*label: 'Hướng dẫn sử dụng'/g) || []).length, 2);
  assert.match(html, /<nav class="sidebar"><\/nav>/);
  assert.match(html, /assets\/js\/guide\.js/);
  for (const id of ['getting-started', 'documents', 'upload', 'requests', 'department-guide', 'admin-guide', 'account-security']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

async function setupGuide(role) {
  const elements = new Map();
  const element = (id, values = {}) => {
    const result = { id, value: '', textContent: '', hidden: false, dataset: {}, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; }, focus() { this.focused = true; }, ...values };
    elements.set(id, result); return result;
  };
  ['guide-role', 'guide-search', 'guide-search-form', 'guide-search-clear', 'guide-no-results', 'guide-search-status', 'guide-print'].forEach(id => element(id));
  const topics = [element('upload', { textContent: 'Tải hồ sơ lên và gửi duyệt' }),
    element('security', { textContent: 'Bảo mật tài khoản OTP' }),
    element('department-guide', { textContent: 'Thống kê khoa', dataset: { guideSection: 'department_head' } }),
    element('admin-guide', { textContent: 'Quản trị hệ thống', dataset: { guideSection: 'admin' } })];
  const nav = topics.map(topic => element('nav-' + topic.id, { hash: '#' + topic.id }));
  const routes = ['home', 'documents', 'mine'].map(key => element('route-' + key, { dataset: { guideLink: key } }));
  const events = {};
  let reported;
  const context = {
    Auth: { require: async () => ({ role }), showError: error => { reported = error; } },
    document: {
      getElementById: id => elements.get(id),
      querySelectorAll: selector => ({ '[data-guide-topic]': topics, '.guide-toc a': nav, '[data-guide-link]': routes })[selector] || []
    },
    window: { addEventListener: (name, fn) => { events[name] = fn; }, print() {} }, location: { hash: '' }
  };
  vm.runInNewContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reported, undefined);
  return { topics, nav, routes, elements, events };
}

for (const role of ['user', 'department_head', 'admin']) {
  test(`guide displays only the ${role} role-specific sections`, async () => {
    const { topics, nav, routes } = await setupGuide(role);
    assert.deepEqual(topics.map(topic => topic.hidden), topics.map(topic => !!topic.dataset.guideSection && topic.dataset.guideSection !== role));
    assert.deepEqual(nav.map(link => link.hidden), topics.map(topic => topic.hidden));
    const prefix = role === 'admin' ? 'admin/' : role === 'department_head' ? 'dept-head/' : '';
    assert.equal(routes[0].href, prefix + 'dashboard.html');
  });
}

test('accent-insensitive guide search keeps other roles hidden and supports clearing', async () => {
  const { topics, elements } = await setupGuide('user');
  const search = elements.get('guide-search');
  search.value = 'tai ho so'; search.listeners.input();
  assert.equal(topics[0].hidden, false);
  assert.ok(topics.slice(1).every(topic => topic.hidden));
  search.value = 'quan tri'; search.listeners.input();
  assert.ok(topics.every(topic => topic.hidden));
  assert.equal(elements.get('guide-no-results').hidden, false);
  elements.get('guide-search-clear').listeners.click();
  assert.equal(search.value, '');
  assert.equal(search.focused, true);
  assert.equal(topics[0].hidden, false);
  assert.equal(topics[3].hidden, true);
});

test('guide reports authentication failures through the shared error handler', async () => {
  const error = new Error('Session expired');
  let reported;
  const context = {
    Auth: { require: async () => { throw error; }, showError: value => { reported = value; } },
    document: { querySelectorAll: () => [] }
  };
  vm.runInNewContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reported, error);
});
