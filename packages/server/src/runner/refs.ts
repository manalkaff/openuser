// packages/server/src/runner/refs.ts
import type { Locator, Page } from 'playwright';
import type { AnnotatedRef } from './snapshot.js';

/**
 * RefMap maintains a mapping from [ref=eN] ids (strings like "e1", "e2") to
 * Playwright Locators. It is rebuilt on every snapshot call so refs are always
 * fresh relative to the current page state.
 *
 * Usage pattern:
 *   const refMap = new RefMap();
 *   // ... on every snapshot:
 *   const { refs } = annotateSnapshot(raw);
 *   refMap.build(page, refs);
 *   // ... on act():
 *   const locator = refMap.get(action.ref);
 *   if (!locator) return { ok: false, error: "page changed — call browser_snapshot again" };
 */
export class RefMap {
  private map = new Map<string, Locator>();

  /**
   * Rebuild the map from a fresh AnnotatedRef list.
   * Discards all previous entries.
   *
   * For elements with nth === 0, the raw role locator is stored directly.
   * For elements with nth > 0, `.nth(nth)` is applied for disambiguation.
   *
   * Note: Playwright's `getByRole` accepts the ARIA role as a string. We cast
   * to `Parameters<Page['getByRole']>[0]` to satisfy strict typing.
   */
  build(page: Pick<Page, 'getByRole'>, refs: AnnotatedRef[]): void {
    this.map.clear();
    for (const { ref, role, name, nth } of refs) {
      const base = page.getByRole(role as Parameters<Page['getByRole']>[0], { name });
      const locator: Locator = nth > 0 ? base.nth(nth) : base;
      this.map.set(ref, locator);
    }
  }

  /**
   * Look up a locator by its ref id (e.g. "e3").
   * Returns null if the ref is not in the current snapshot (stale).
   * Callers MUST check for null and return the error string:
   *   "page changed — call browser_snapshot again"
   */
  get(ref: string): Locator | null {
    return this.map.get(ref) ?? null;
  }

  /** Remove all entries without rebuilding (e.g. after navigation pre-snapshot). */
  clear(): void {
    this.map.clear();
  }
}
