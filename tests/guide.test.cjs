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

for (const role of ['user', 'department_head', 'admin']) {
  test(`guide displays only the ${role} role-specific sections`, async () => {
    const sections = ['user', 'department_head', 'admin'].map(value => ({
      dataset: { guideSection: value }, hidden: true
    }));
    const links = ['department_head', 'admin'].map(value => ({
      dataset: { guideNav: value, guideRole: value }, hidden: true
    }));
    const collections = [...sections, ...links];
    let reported;
    const context = {
      Auth: {
        require: async () => ({ role }),
        showError: error => { reported = error; }
      },
      document: {
        querySelectorAll(selector) {
          if (selector === '[data-guide-section]') return sections;
          if (selector === '[data-guide-nav]') return links;
          if (selector === '[data-guide-role]') return links;
          return [];
        }
      }
    };
    vm.runInNewContext(script, context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reported, undefined);
    assert.deepEqual(sections.map(section => section.hidden), sections.map(section => section.dataset.guideSection !== role));
    assert.deepEqual(links.map(link => link.hidden), links.map(link => (link.dataset.guideNav || link.dataset.guideRole) !== role));
    assert.equal(collections.length, 5);
  });
}

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
