import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { GuardConfig } from './services/settings.service.js';

/** `<home>/config.json`: the daemon settings that only the machine's owner may change. */
const DaemonConfigFile = z
  .object({
    seedCommand: z.string().optional(),
    teardownCommand: z.string().optional(),
    lockFile: z.string().optional(),
    denyHosts: z.array(z.string().min(1)).optional(),
    allowedHosts: z.array(z.string().min(1)).optional(),
  })
  .strict();

export interface DaemonConfig {
  guards: GuardConfig;
  allowedHosts: string[];
}

/** Read `<home>/config.json`. A missing file is empty config; an invalid one stops the daemon. */
export function readDaemonConfig(homeDir: string): DaemonConfig {
  const file = join(homeDir, 'config.json');
  if (!existsSync(file)) return { guards: {}, allowedHosts: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(
      `${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = DaemonConfigFile.safeParse(raw);
  if (!parsed.success) throw new Error(`${file} is invalid: ${parsed.error.message}`);
  const { allowedHosts = [], ...guards } = parsed.data;
  return { guards: guards as GuardConfig, allowedHosts };
}

const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
const WILDCARD = ['0.0.0.0', '::', ''];

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

/** Hostname part of a `Host` header or an `Origin` URL, or null when it cannot be parsed. */
function hostnameOf(value: string, isOrigin: boolean): string | null {
  try {
    return normalizeHost(new URL(isOrigin ? value : `http://${value}`).hostname);
  } catch {
    return null;
  }
}

/** Loopback names, the bound host unless it is a wildcard, and any configured extras. */
export function allowedHostnames(bindHost: string, extra: string[]): Set<string> {
  const hosts = [...LOOPBACK, ...extra];
  if (!WILDCARD.includes(bindHost)) hosts.push(bindHost);
  return new Set(hosts.map(normalizeHost));
}

/**
 * Refuse a request whose `Host` (or, when sent, `Origin`) is not an allowed hostname. This stops
 * DNS rebinding and cross-site pages from driving the unauthenticated manager API.
 */
export function hostAllowlist(allowed: Set<string>): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header('host');
    const hostName = host ? hostnameOf(host, false) : null;
    if (!hostName || !allowed.has(hostName)) {
      return c.json({ error: `Host ${host ?? '(none)'} is not allowed` }, 403);
    }
    const origin = c.req.header('origin');
    if (origin !== undefined) {
      const originName = hostnameOf(origin, true);
      if (!originName || !allowed.has(originName)) {
        return c.json({ error: `Origin ${origin} is not allowed` }, 403);
      }
    }
    return next();
  };
}
