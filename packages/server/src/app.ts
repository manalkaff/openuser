import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { serveStatic } from '@hono/node-server/serve-static';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import type { Server } from 'node:http';
import { openDatabase, type DB } from './db/client.js';
import { SettingsService } from './services/settings.service.js';
import { healthRouter } from './routes/health.js';
import { WsHub } from './ws/hub.js';

export interface ServerOptions {
  homeDir: string;
  port?: number;
  host?: string;
  uiDir?: string;
}

export interface ServerContext {
  db: DB;
  homeDir: string;
  settings: SettingsService;
  wsHub: WsHub;
}

export interface ServerInstance {
  server: Server;
  port: number;
  close(): Promise<void>;
}

export const DEFAULT_PORT = 8737;

async function findFreePort(startPort: number, host: string): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const srv = net.createServer();
      srv.listen(port, host, () => {
        srv.close(() => resolve(port));
      });
      srv.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
    };
    tryPort(startPort);
  });
}

function writeDaemonJson(homeDir: string, port: number, version: string): void {
  const daemonJson = {
    port,
    pid: process.pid,
    version,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(join(homeDir, 'daemon.json'), JSON.stringify(daemonJson, null, 2));
}

export function buildApp(ctx: ServerContext, version: string, uiDir?: string) {
  const app = new Hono();

  // Health
  app.route('/', healthRouter(version));

  // Static artifact serving
  app.get('/artifacts/*', async (c) => {
    const url = new URL(c.req.url);
    const filePath = join(ctx.homeDir, 'artifacts', url.pathname.replace('/artifacts/', ''));
    const { existsSync, readFileSync } = await import('node:fs');
    if (!existsSync(filePath)) {
      return c.json({ error: 'Not found' }, 404);
    }
    const buf = readFileSync(filePath);
    const ext = filePath.split('.').pop() ?? '';
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      webm: 'video/webm',
      jsonl: 'application/jsonl',
      json: 'application/json',
    };
    return new Response(buf, {
      headers: { 'Content-Type': mimeMap[ext] ?? 'application/octet-stream' },
    });
  });

  // Static SPA (when uiDir is set)
  if (uiDir) {
    app.use('/*', serveStatic({ root: uiDir }));
  }

  return app;
}

export async function createServer(opts: ServerOptions): Promise<ServerInstance> {
  const homeDir = opts.homeDir;
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(join(homeDir, 'artifacts'), { recursive: true });
  mkdirSync(join(homeDir, 'checkpoints'), { recursive: true });

  const db = openDatabase(homeDir);
  const settingsService = new SettingsService(db);
  const wsHub = new WsHub();

  const ctx: ServerContext = { db, homeDir, settings: settingsService, wsHub };

  // Read version from package.json (bundled at build time)
  let version = '0.0.1';
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const pkg = req('../package.json') as { version: string };
    version = pkg.version;
  } catch {
    // fallback
  }

  const app = buildApp(ctx, version, opts.uiDir);
  const host = opts.host ?? '127.0.0.1';
  const startPort = opts.port ?? DEFAULT_PORT;
  const port = await findFreePort(startPort, host);

  writeDaemonJson(homeDir, port, version);

  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: app as never });

  // Wire WS endpoint
  app.get(
    '/ws',
    upgradeWebSocket((_c) => ({
      onOpen(_event, ws) {
        wsHub.addConnection(ws);
      },
      onMessage(event, ws) {
        wsHub.handleMessage(ws, String(event.data));
      },
      onClose(_event, ws) {
        wsHub.removeConnection(ws);
      },
    })),
  );

  const server = serve({ fetch: app.fetch, port, hostname: host, createServer: createHttpServer }, () => {
    // listening
  }) as unknown as Server;
  injectWebSocket(server);

  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
