import type { Server } from 'node:http';

export interface ServerOptions {
  homeDir: string;
  port?: number;
  host?: string;
  uiDir?: string;
}

export interface ServerInstance {
  server: Server;
  port: number;
  close(): Promise<void>;
}

export async function createServer(_opts: ServerOptions): Promise<ServerInstance> {
  throw new Error('not yet implemented');
}
