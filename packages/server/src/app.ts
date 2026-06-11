import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import type { Server } from 'node:http';
import { openDatabase, type DB } from './db/client.js';
import { SettingsService } from './services/settings.service.js';
import { WatchdogService } from './services/watchdog.service.js';
import { LogPipelineService } from './services/log-pipeline.service.js';
import { WsHub } from './ws/hub.js';
import { healthRouter } from './routes/health.js';
import { projectsRouter } from './routes/projects.js';
import { personasRouter } from './routes/personas.js';
import { testsRouter } from './routes/tests.js';
import { runsRouter } from './routes/runs.js';
import { findingsRouter } from './routes/findings.js';
import { checkpointsRouter } from './routes/checkpoints.js';
import { settingsRouter } from './routes/settings.js';
import { beginRouter } from './routes/tester/begin.js';
import { snapshotRouter } from './routes/tester/snapshot.js';
import { actionRouter } from './routes/tester/action.js';
import { screenshotRouter } from './routes/tester/screenshot.js';
import { findingRouter } from './routes/tester/finding.js';
import { checkpointTesterRouter } from './routes/tester/checkpoint.js';
import { completeRouter } from './routes/tester/complete.js';
import type { RunnerSession } from './runner/types.js';

export type ActiveSessions = Map<string, RunnerSession>;

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
  activeSessions: ActiveSessions;
  watchdogReset?: (runId: string) => void;
  watchdogCancel?: (runId: string) => void;
}

export interface ServerInstance {
  server: Server;
  port: number;
  close(): Promise<void>;
}

export const DEFAULT_PORT = 8737;

async function findFreePort(startPort: number, host: string): Promise<number> {
  // If startPort is 0, let the OS pick an ephemeral port
  if (startPort === 0) {
    const net = await import('node:net');
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, host, () => {
        const addr = srv.address() as { port: number } | null;
        srv.close(() => {
          if (addr) resolve(addr.port);
          else reject(new Error('Could not determine ephemeral port'));
        });
      });
      srv.on('error', reject);
    });
  }
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      if (port > startPort + 100) {
        reject(new Error(`No free port found in range ${startPort}-${startPort + 100}`));
        return;
      }
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
  writeFileSync(
    join(homeDir, 'daemon.json'),
    JSON.stringify({ port, pid: process.pid, version, startedAt: new Date().toISOString() }, null, 2),
  );
}

export function buildApp(ctx: ServerContext, version: string, uiDir?: string) {
  const app = new Hono();

  // Shared services passed to routes
  const logPipeline = new LogPipelineService(ctx.db, ctx.homeDir, ctx.wsHub);
  const watchdogReset = (runId: string) => ctx.watchdogReset?.(runId);
  const watchdogCancel = (runId: string) => ctx.watchdogCancel?.(runId);

  // Manager routes (no auth)
  app.route('/', healthRouter(version));
  app.route('/', projectsRouter(ctx));
  app.route('/', personasRouter(ctx));
  app.route('/', testsRouter(ctx));
  app.route('/', runsRouter(ctx));
  app.route('/', findingsRouter(ctx));
  app.route('/', checkpointsRouter(ctx));
  app.route('/', settingsRouter(ctx));

  // Tester routes (Bearer token auth)
  app.route('/', beginRouter(ctx, ctx.activeSessions, logPipeline));
  app.route('/', snapshotRouter(ctx, ctx.activeSessions));
  app.route('/', actionRouter(ctx, ctx.activeSessions, logPipeline, watchdogReset));
  app.route('/', screenshotRouter(ctx, ctx.activeSessions));
  app.route('/', findingRouter(ctx, ctx.activeSessions, logPipeline, watchdogReset));
  app.route('/', checkpointTesterRouter(ctx, ctx.activeSessions, watchdogReset));
  app.route('/', completeRouter(ctx, ctx.activeSessions, watchdogCancel));

  // Static artifact serving
  app.get('/artifacts/*', async (c) => {
    const { existsSync, readFileSync } = await import('node:fs');
    const urlPath = new URL(c.req.url).pathname;
    const filePath = join(ctx.homeDir, 'artifacts', urlPath.replace('/artifacts/', ''));
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

  // Static SPA (when uiDir is set via OPENUSER_UI_DIR env)
  if (uiDir) {
    app.use('/*', async (c) => {
      const { existsSync, readFileSync } = await import('node:fs');
      const urlPath = new URL(c.req.url).pathname;
      let filePath = join(uiDir, urlPath === '/' ? 'index.html' : urlPath);
      if (!existsSync(filePath)) {
        filePath = join(uiDir, 'index.html'); // SPA fallback
      }
      if (!existsSync(filePath)) return c.json({ error: 'Not found' }, 404);
      const buf = readFileSync(filePath);
      const ext = filePath.split('.').pop() ?? 'html';
      const mimeMap: Record<string, string> = {
        html: 'text/html',
        js: 'application/javascript',
        css: 'text/css',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
      };
      return new Response(buf, { headers: { 'Content-Type': mimeMap[ext] ?? 'application/octet-stream' } });
    });
  }

  return app;
}

export async function createServer(opts: ServerOptions): Promise<ServerInstance> {
  const homeDir = opts.homeDir;
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(join(homeDir, 'artifacts'), { recursive: true });
  mkdirSync(join(homeDir, 'checkpoints'), { recursive: true });

  const { db, sqlite } = openDatabase(homeDir);
  const settingsService = new SettingsService(db);
  const wsHub = new WsHub();
  const activeSessions: ActiveSessions = new Map();

  // Watchdog needs to know about activeSessions at construction time
  const watchdog = new WatchdogService(
    db,
    homeDir,
    wsHub,
    activeSessions,
    () => settingsService.get('watchdogMinutes'),
  );

  const ctx: ServerContext = {
    db,
    homeDir,
    settings: settingsService,
    wsHub,
    activeSessions,
    watchdogReset: (id) => watchdog.reset(id),
    watchdogCancel: (id) => watchdog.cancel(id),
  };

  let version = '0.0.1';
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const pkg = req('../package.json') as { version: string };
    version = pkg.version;
  } catch {
    // fallback
  }

  const uiDir = opts.uiDir ?? process.env['OPENUSER_UI_DIR'];
  const app = buildApp(ctx, version, uiDir);

  const host = opts.host ?? '127.0.0.1';
  const startPort = opts.port ?? DEFAULT_PORT;
  const listenPort = startPort === 0 ? 0 : await findFreePort(startPort, host);

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

  // Wrap serve() in a Promise to ensure the server is listening before resolving.
  // When listenPort is 0 (OS-assigned), read the actual port from server.address().
  const { server, port } = await new Promise<{ server: Server; port: number }>((resolve) => {
    const httpServer = serve(
      { fetch: app.fetch, port: listenPort, hostname: host, createServer: createHttpServer },
      () => {
        const addr = (httpServer as unknown as Server).address() as { port: number } | null;
        const actualPort = addr?.port ?? listenPort;
        writeDaemonJson(homeDir, actualPort, version);
        resolve({ server: httpServer as unknown as Server, port: actualPort });
      },
    ) as unknown as Server;
  });

  injectWebSocket(server);

  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          sqlite.close();
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
