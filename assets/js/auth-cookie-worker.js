/* One network queue for browsers without Web Locks. Cookie rotation stays serialized
   even if the requesting tab closes while a request is in progress. */
'use strict';
let queue = Promise.resolve();
onconnect = event => {
  const port = event.ports[0];
  port.onmessage = ({ data }) => {
    queue = queue.catch(() => {}).then(async () => {
      try {
        const url = new URL(data.url);
        if (!/\/auth\/(refresh|refresh-token|logout|logout-all|verify-otp|complete-login)$/.test(url.pathname)) throw new Error('Invalid authentication route');
        const response = await fetch(url.href, { ...data.init, credentials: 'include', cache: 'no-store' });
        const body = response.status === 204 ? null : await response.json().catch(() => null);
        port.postMessage({ id: data.id, status: response.status, body });
      } catch (error) { port.postMessage({ id: data.id, error: error.message }); }
    });
  };
  port.start();
};
