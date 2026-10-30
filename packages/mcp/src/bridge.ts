import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBridge, type BridgeCandidate, type BridgeExec, type BridgeResult } from '@openuser/shared';
import { getBridgeFindings, recordFindingIssue, type HttpClientOptions } from './http-client.js';

/** Where findings are read from and filed issue ids are written back to. */
export interface BridgeStore {
  list(projectId: string): Promise<BridgeCandidate[]>;
  record(findingId: string, issueId: string): Promise<void>;
}

const MULTICA_PRIORITY = { P1: 'urgent', P2: 'high', P3: 'medium' } as const;

function multica(args: string[]): string {
  try {
    return execFileSync('multica', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') throw new Error('The `multica` CLI was not found on PATH; the bridge needs it to file issues.');
    throw new Error(`multica ${args.slice(0, 2).join(' ')} failed: ${e.stderr?.trim() || e.message}`);
  }
}

/** Run `multica` with a body written to a temp file (the CLI takes bodies from files, not argv). */
function withBodyFile<T>(body: string, fn: (file: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'openuser-bridge-'));
  try {
    const file = join(dir, 'body.md');
    writeFileSync(file, body, 'utf8');
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LABEL_NAME = 'kind:finding';

/** The id of the kind:finding label, or null when the workspace has none. */
function findLabelId(): string | null {
  const parsed = JSON.parse(multica(['label', 'list', '--output', 'json'])) as unknown;
  const list = Array.isArray(parsed) ? parsed : ((parsed as { labels?: unknown[] }).labels ?? []);
  const hit = (list as { id?: string; name?: string }[]).find((l) => l.name === LABEL_NAME);
  return hit?.id ?? null;
}

function makeMulticaExec(): Pick<BridgeExec, 'createIssue' | 'commentIssue' | 'labelIssue'> {
  let labelId: string | null | undefined;
  return {
    createIssue({ title, body, priority }) {
      const out = withBodyFile(body, (file) =>
        multica(['issue', 'create', '--title', title, '--description-file', file, '--priority', MULTICA_PRIORITY[priority], '--output', 'json']),
      );
      const id = (JSON.parse(out) as { id?: string }).id;
      if (!id) throw new Error('multica issue create returned no issue id');
      return id;
    },
    commentIssue(issueId, body) {
      withBodyFile(body, (file) => multica(['issue', 'comment', 'add', issueId, '--content-file', file]));
    },
    labelIssue(issueId) {
      try {
        if (labelId === undefined) labelId = findLabelId();
        if (!labelId) {
          process.stderr.write(`warning: no "${LABEL_NAME}" label in the workspace; issue ${issueId} left unlabelled\n`);
          return false;
        }
        multica(['issue', 'label', 'add', issueId, labelId]);
        return true;
      } catch (err) {
        process.stderr.write(`warning: could not label issue ${issueId}: ${err instanceof Error ? err.message : err}\n`);
        return false;
      }
    },
  };
}

/**
 * File one kind:finding Multica issue per new qualifying fingerprint of a project, and comment on
 * the issue already filed for a known fingerprint. Shared by `openuser bridge` and the MCP `bridge` tool.
 */
export async function bridgeWithStore(store: BridgeStore, projectId: string): Promise<BridgeResult> {
  const candidates = await store.list(projectId);
  return runBridge(candidates, { ...makeMulticaExec(), recordIssue: (findingId, issueId) => store.record(findingId, issueId) });
}

/** Bridge through the running daemon's HTTP API (the MCP tool). */
export function bridgeProject(opts: HttpClientOptions, projectId: string): Promise<BridgeResult> {
  return bridgeWithStore(
    {
      list: (id) => getBridgeFindings(opts, id),
      record: (findingId, issueId) => recordFindingIssue(opts, findingId, issueId),
    },
    projectId,
  );
}
