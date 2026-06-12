import { Hono } from 'hono';

// Version is read from package.json at startup and injected via context
export function healthRouter(version: string) {
  const app = new Hono();
  app.get('/api/health', (c) => c.json({ ok: true, version }));
  return app;
}
