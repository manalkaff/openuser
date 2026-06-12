import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';

/** Default daemon port (contracts §2, §5) */
export const DEFAULT_PORT = 8737;

/**
 * Generate a prefixed nanoid(12) ID.
 * @param prefix — one of: prj_ per_ chk_ tst_ run_ stp_ fnd_ evt_
 */
export function newId(prefix: string): string {
  return `${prefix}${nanoid(12)}`;
}

/**
 * Generate a run token: rt_<nanoid(24)>
 * Returned once by prepare_run; stored as hashToken(token) only.
 */
export function newRunToken(): string {
  return `rt_${nanoid(24)}`;
}

/**
 * SHA-256 hex digest of the token string.
 * Only the hash is stored in runs.token_hash (contracts §3).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
