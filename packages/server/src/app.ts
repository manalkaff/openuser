import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { serveStatic } from '@hono/node-server/serve-static';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import type { Server } from 'node:http';
import { openDatabase, type DB } from './db/client.js';
import { SettingsService } from './services/settings.service.js';
import { healthRouter } from './routes/health.js';
import { projectsRouter } from './routes/projects.js';
import { personasRouter } from './routes/personas.js';
import { testsRouter } from './routes/tests.js';
import { runsRouter } from './routes/runs.js';
import { WsHub } from './ws/hub.js';
import type { ActiveSessions } from './routes/tester/auth.js';
import { beginRouter } from './routes/tester/begin.js';
import { snapshotRouter } from './routes/tester/snapshot.js';
import { actionRouter } from './routes/tester/action.js';
import { screenshotRouter } from './routes/tester/screenshot.js';
import { findingRouter } from './routes/tester/finding.js';
import { checkpointTesterRouter } from './routes/tester/checkpoint.js';
import { completeRouter } from './routes/tester/complete.js';
import { LogPipelineService } from './services/log-pipeline.service.js';
import type { RunnerSession } from './runner/types.js';

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
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      // Fix #4: bound the port search to startPort + 100
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
  app.route('/', projectsRouter(ctx));
  app.route('/', personasRouter(ctx));
  app.route('/', testsRouter(ctx));
  app.route('/', runsRouter(ctx));

  // Tester routes
  const logPipeline = new LogPipelineService(ctx.db, ctx.homeDir, ctx.wsHub);
  const watchdogReset = ctx.watchdogReset ?? ((_id: string) => {});
  const watchdogCancel = ctx.watchdogCancel ?? ((_id: string) => {});
  app.route('/', beginRouter(ctx, ctx.activeSessions, logPipeline));
  app.route('/', snapshotRouter(ctx, ctx.activeSessions));
  app.route('/', actionRouter(ctx, ctx.activeSessions, logPipeline, watchdogReset));
  app.route('/', screenshotRouter(ctx, ctx.activeSessions));
  app.route('/', findingRouter(ctx, ctx.activeSessions, logPipeline, watchdogReset));
  app.route('/', checkpointTesterRouter(ctx, ctx.activeSessions, watchdogReset));
  app.route('/', completeRouter(ctx, ctx.activeSessions, watchdogCancel));

  // Static artifact serving — Fix #5: use static imports, not dynamic import('node:fs')
  app.get('/artifacts/*', async (c) => {
    const url = new URL(c.req.url);
    const filePath = join(ctx.homeDir, 'artifacts', url.pathname.replace('/artifacts/', ''));
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

  // Fix #3: destructure both db and sqlite handle so we can close it on shutdown
  const { db, sqlite } = openDatabase(homeDir);
  const settingsService = new SettingsService(db);
  const wsHub = new WsHub();

  const activeSessions: Map<string, RunnerSession> = new Map();
  const ctx: ServerContext = { db, homeDir, settings: settingsService, wsHub, activeSessions };

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

  // Fix #2: wrap serve() in a Promise that resolves only after the listening callback fires,
  // and write daemon.json inside that callback so consumers never hit ECONNREFUSED.
  const server = await new Promise<Server>((resolve) => {
    const httpServer = serve(
      { fetch: app.fetch, port, hostname: host, createServer: createHttpServer },
      () => {
        // Server is now actually listening
        writeDaemonJson(homeDir, port, version);
        resolve(httpServer as unknown as Server);
      },
    ) as unknown as Server;
  });

  injectWebSocket(server);

  return {
    server,
    port,
    // Fix #3: close sqlite handle after the HTTP server closes
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
