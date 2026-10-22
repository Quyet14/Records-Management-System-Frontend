(async () => {
  const user = await Auth.require();
  const role = user?.role || 'user';
  document.querySelectorAll('[data-guide-section]').forEach(section => {
    section.hidden = section.dataset.guideSection !== role;
  });
  document.querySelectorAll('[data-guide-nav]').forEach(link => {
    link.hidden = link.dataset.guideNav !== role;
  });
  document.querySelectorAll('[data-guide-role]').forEach(link => {
    link.hidden = link.dataset.guideRole !== role;
  });
})().catch(Auth.showError);
