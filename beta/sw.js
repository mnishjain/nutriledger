// Retirement worker for the finished beta: removes itself so the old beta copy is never shown again,
// then sends open beta pages to the live app. Beta data stays on the device and is copied by the live app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) c.navigate(new URL('../', self.registration.scope).href).catch(() => {});
  })());
});
