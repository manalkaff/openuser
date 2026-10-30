import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXED_ID = /^[a-z]{2,5}_[A-Za-z0-9_-]{8,}$/;
const LONG_HEX = /^[0-9a-f]{12,}$/i;

/** `/orders/123/pay?x=1` → `/orders/:id/pay`. Numeric, uuid, prefixed (`ord_ab12…`) and long hex segments are ids. */
export function routeTemplate(route: string | undefined): string {
  if (!route) return '';
  let path = route.trim();
  try {
    path = new URL(path, 'http://x').pathname;
  } catch {
    path = path.split(/[?#]/)[0] ?? '';
  }
  const segments = path
    .split('/')
    .map((s) => (/^\d+$/.test(s) || UUID.test(s) || PREFIXED_ID.test(s) || LONG_HEX.test(s) ? ':id' : s));
  const out = segments.join('/').replace(/\/+$/, '');
  return out === '' ? '/' : out;
}

/** Lowercase, with uuids, prefixed ids, long hex and numbers stripped, so "Order 123 …" and "Order 456 …" match. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ' ')
    .replace(/\b[a-z]{2,5}_[a-z0-9_-]{8,}\b/g, ' ')
    .replace(/\b[0-9a-f]{12,}\b/g, ' ')
    .replace(/#?\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first stack frame in the text (`at fn (file:1:2)`), or '' when there is none. */
export function firstStackFrame(text: string): string {
  const m = /^\s*at\s+.+$/m.exec(text);
  return m ? m[0].trim() : '';
}

export interface FingerprintInput {
  projectId: string;
  route?: string | undefined;
  category: string;
  title: string;
  description: string;
  selector?: string | undefined;
}

/** Hash of project, route template, category, normalised title, and first stack frame or failing selector. */
export function computeFingerprint(i: FingerprintInput): string {
  const locator = firstStackFrame(i.description) || (i.selector ?? '').trim();
  const parts = [i.projectId, routeTemplate(i.route), i.category, normalizeTitle(i.title), locator];
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
}
