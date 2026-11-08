import { Hono } from 'hono';

// Version is read from package.json at startup and injected via context.
// /api/health needs no token, so it answers liveness only; the version is behind auth.
export function healthRouter(version: string) {
  const app = new Hono();
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/version', (c) => c.json({ version }));
  return app;
}
