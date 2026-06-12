import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Per-agent MCP config writing.
 *
 * Each supported agent stores stdio MCP server definitions in a different file and
 * a different JSON shape. This module computes the right project-local target file
 * for an agent and merges the two OpenUser servers (manager + tester) into whatever
 * is already there — never clobbering unrelated keys or other servers.
 */

export type Agent = 'claude' | 'codex' | 'opencode' | 'cursor';

/** The two MCP servers OpenUser registers, by role. */
const SERVERS = {
  'openuser-manager': ['mcp', '--role', 'manager'],
  'openuser-tester': ['mcp', '--role', 'tester'],
} as const;

/** Project-local config file each agent reads stdio MCP servers from. */
export function mcpConfigPath(agent: Agent, cwd: string): string {
  switch (agent) {
    case 'claude':
      return join(cwd, '.mcp.json');
    case 'codex':
      return join(cwd, '.codex', 'config.json');
    case 'opencode':
      return join(cwd, '.opencode', 'config.json');
    case 'cursor':
      return join(cwd, '.cursor', 'mcp.json');
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(path: string): JsonObject {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? parsed : {};
  } catch {
    // Missing or unparseable file → start from an empty object.
    return {};
  }
}

/**
 * Merge the OpenUser servers into `existing` for the given agent, returning the new
 * config object. Pure — does not touch the filesystem. Existing servers and unrelated
 * keys are preserved; the two OpenUser entries are overwritten (idempotent re-run).
 */
export function mergeMcpConfig(agent: Agent, existing: JsonObject): JsonObject {
  const out: JsonObject = { ...existing };

  if (agent === 'opencode') {
    // { mcp: { servers: { name: { type: 'stdio', command, args } } } }
    const mcp = isObject(out['mcp']) ? { ...out['mcp'] } : {};
    const servers = isObject(mcp['servers']) ? { ...mcp['servers'] } : {};
    for (const [name, args] of Object.entries(SERVERS)) {
      servers[name] = { type: 'stdio', command: 'openuser', args };
    }
    mcp['servers'] = servers;
    out['mcp'] = mcp;
    return out;
  }

  // claude | codex | cursor → { mcpServers: { name: { command, args } } }
  const mcpServers = isObject(out['mcpServers']) ? { ...out['mcpServers'] } : {};
  for (const [name, args] of Object.entries(SERVERS)) {
    mcpServers[name] = { command: 'openuser', args };
  }
  out['mcpServers'] = mcpServers;
  return out;
}

export interface WriteMcpResult {
  path: string;
  /** true if the target file already existed and was merged into. */
  merged: boolean;
}

/**
 * Write the OpenUser MCP servers into the agent's project-local config, merging into
 * any existing file. Creates parent directories as needed. Idempotent.
 */
export function writeMcpConfig(agent: Agent, cwd: string): WriteMcpResult {
  const path = mcpConfigPath(agent, cwd);
  let merged = false;
  try {
    readFileSync(path, 'utf8');
    merged = true;
  } catch {
    merged = false;
  }
  const existing = readJson(path);
  const next = mergeMcpConfig(agent, existing);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return { path, merged };
}
