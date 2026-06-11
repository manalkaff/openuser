// packages/server/src/runner/playwright.ts
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { TesterAction, PageSnapshot } from '@openuser/shared';
import type { RunnerSession, ConsoleEvent, NetworkEvent } from './types.js';
import { annotateSnapshot } from './snapshot.js';
import { RefMap } from './refs.js';

type BeginOpts = Parameters<RunnerSession['begin']>[0];

/**
 * PlaywrightRunner — real Chromium-based implementation of RunnerSession.
 *
 * Lifecycle:
 *   const runner = new PlaywrightRunner();
 *   const snapshot = await runner.begin({ ... });
 *   // loop:
 *   await runner.act(action);
 *   await runner.snapshot();
 *   // end:
 *   const { videoPath } = await runner.close();
 *
 * Step-index attribution scheme:
 *   _stepIdx is the counter that increments on every act() call.
 *   _currentStepIdx is what the console/network listeners read.
 *   At the start of act(N), we capture idx = _stepIdx++, then set
 *   _currentStepIdx = idx BEFORE _perform(), so all browser events
 *   fired during step N carry stepIdx=N. During begin() (initial page
 *   load), _currentStepIdx remains 0 so initial events are attributed
 *   to step 0. The step-N screenshot path uses the same idx.
 */
export class PlaywrightRunner implements RunnerSession {
  private _browser: Browser | null = null;
  private _context: BrowserContext | null = null;
  private _page: Page | null = null;
  private _refMap = new RefMap();

  // _stepIdx is the next step counter (incremented at the start of each act()).
  // _currentStepIdx is set to the captured value before performing the action,
  // so listeners always see the step that triggered the event.
  private _stepIdx = 0;
  private _currentStepIdx = 0;

  private _videoDir = '';
  private _onConsole: BeginOpts['onConsole'] = () => {};
  private _onNetwork: BeginOpts['onNetwork'] = () => {};

  // ──────────────────────────────────────────────────────────────
  // begin()
  // ──────────────────────────────────────────────────────────────

  async begin(opts: BeginOpts): Promise<PageSnapshot> {
    const {
      baseUrl,
      viewport,
      storageStatePath,
      videoDir,
      headed,
      onConsole,
      onNetwork,
    } = opts;

    this._videoDir = videoDir;
    this._onConsole = onConsole;
    this._onNetwork = onNetwork;

    // _currentStepIdx stays 0 during begin() so initial-load events are
    // attributed to step 0 (consistent with the first act() being step 0 too;
    // begin is "step 0" from the listener's perspective).
    this._currentStepIdx = 0;

    // Launch browser
    try {
      this._browser = await chromium.launch({
        headless: !headed,
        channel: 'chromium',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("Executable doesn't exist") ||
        msg.includes('browserType.launch') ||
        msg.includes('playwright install') ||
        msg.includes('is not installed') ||
        msg.includes('distribution channel')
      ) {
        throw new Error(
          'Chromium browser not installed. Run: npx playwright install chromium',
        );
      }
      throw err;
    }

    // Create context with video recording and optional storageState restore.
    // exactOptionalPropertyTypes: do not include storageState key at all when
    // storageStatePath is undefined, to avoid assigning undefined to a non-optional field.
    const contextOptions: Parameters<Browser['newContext']>[0] = {
      viewport,
      recordVideo: {
        dir: videoDir,
        size: viewport,
      },
      ...(storageStatePath !== undefined ? { storageState: storageStatePath } : {}),
    };

    // Guard all post-launch steps so a partial failure doesn't leave an
    // orphaned headless Chromium process (which the watchdog can never reap
    // because the session was never stored in activeSessions).
    try {
      this._context = await this._browser.newContext(contextOptions);
      this._page = await this._context.newPage();

      // Attach listeners before navigation so no events are missed.
      this._attachConsoleListener();
      this._attachNetworkListeners();

      // Navigate to base URL. Use waitUntil (not waitForLoadState which is a
      // separate Page method); domcontentloaded is fast enough for initial load.
      await this._page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await this._settleLoadState();

      return await this._buildSnapshot();
    } catch (err) {
      await this._browser.close().catch(() => {});
      this._browser = null;
      this._context = null;
      this._page = null;
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // snapshot()
  // ──────────────────────────────────────────────────────────────

  async snapshot(): Promise<PageSnapshot> {
    this._assertReady();
    return this._buildSnapshot();
  }

  // ──────────────────────────────────────────────────────────────
  // act()
  // ──────────────────────────────────────────────────────────────

  async act(
    action: TesterAction,
  ): Promise<{ snapshot: PageSnapshot; screenshotPath: string; pageUrl: string }> {
    this._assertReady();
    const page = this._page!;

    // Capture the step index for this action and set it as the current step
    // BEFORE performing the action so all browser events during the action
    // carry the correct stepIdx.
    const idx = this._stepIdx++;
    this._currentStepIdx = idx;

    try {
      await this._perform(page, action);
    } catch (err: unknown) {
      const error = this._describeError(err);
      // Even on error, try to capture a snapshot for the error state.
      let snapshot: PageSnapshot;
      try {
        snapshot = await this._buildSnapshot();
      } catch {
        // Snapshot may fail if page navigated away after crash — return minimal.
        snapshot = { url: page.url(), title: '', tree: '' };
      }
      const screenshotPath = await this._captureStepScreenshot(idx).catch(() => '');
      return {
        snapshot: { ...snapshot, tree: `[action error: ${error}]\n` + snapshot.tree },
        screenshotPath,
        pageUrl: page.url(),
      };
    }

    await this._settleLoadState();

    const [snapshot, screenshotPath] = await Promise.all([
      this._buildSnapshot(),
      this._captureStepScreenshot(idx),
    ]);

    return { snapshot, screenshotPath, pageUrl: page.url() };
  }

  // ──────────────────────────────────────────────────────────────
  // screenshot()
  // ──────────────────────────────────────────────────────────────

  async screenshot(dir: string): Promise<{ path: string }> {
    this._assertReady();
    const { nanoid } = await import('nanoid');
    const filePath = path.join(dir, `${nanoid()}.png`);
    await fs.mkdir(dir, { recursive: true });
    await this._page!.screenshot({ path: filePath, fullPage: false });
    return { path: filePath };
  }

  // ──────────────────────────────────────────────────────────────
  // saveStorageState()
  // ──────────────────────────────────────────────────────────────

  async saveStorageState(filePath: string): Promise<void> {
    this._assertReady();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await this._context!.storageState({ path: filePath });
  }

  // ──────────────────────────────────────────────────────────────
  // close()
  // ──────────────────────────────────────────────────────────────

  async close(): Promise<{ videoPath?: string }> {
    if (!this._context || !this._page) {
      return {};
    }

    // Retrieve Playwright's internal video path BEFORE closing the context
    // (after context.close() the video() object is gone).
    const pwVideo = this._page.video();
    const pwVideoPath = pwVideo ? await pwVideo.path().catch(() => null) : null;

    await this._context.close(); // This finalizes the video file on disk.
    await this._browser?.close();

    this._page = null;
    this._context = null;
    this._browser = null;
    this._refMap.clear();

    if (!pwVideoPath) {
      return {};
    }

    // Move the video to the canonical artifacts location: <videoDir>/video.webm.
    const destPath = path.join(this._videoDir, 'video.webm');
    try {
      await fs.mkdir(this._videoDir, { recursive: true });
      await fs.rename(pwVideoPath, destPath);
      return { videoPath: destPath };
    } catch {
      // If rename fails (e.g. cross-device link), try copy+delete.
      try {
        await fs.copyFile(pwVideoPath, destPath);
        await fs.unlink(pwVideoPath).catch(() => {});
        return { videoPath: destPath };
      } catch {
        // Return the original path if move fails entirely.
        return { videoPath: pwVideoPath };
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────

  private _assertReady(): void {
    if (!this._page || !this._context) {
      throw new Error('PlaywrightRunner: begin() has not been called or session is closed');
    }
  }

  private async _buildSnapshot(): Promise<PageSnapshot> {
    const page = this._page!;
    const url = page.url();
    const title = await page.title().catch(() => '');

    // Use ariaSnapshot (modern Playwright API, introduced in 1.46).
    let rawAria: string;
    try {
      rawAria = await page.locator('body').ariaSnapshot({ timeout: 5000 });
    } catch {
      rawAria = '';
    }

    const { annotated, refs } = annotateSnapshot(rawAria);
    this._refMap.build(page, refs);

    return { url, title, tree: annotated };
  }

  private async _captureStepScreenshot(idx: number): Promise<string> {
    const stepsDir = path.join(this._videoDir, 'steps');
    await fs.mkdir(stepsDir, { recursive: true });
    const filePath = path.join(stepsDir, `${idx}.png`);
    try {
      await this._page!.screenshot({ path: filePath });
    } catch {
      // Non-fatal — return the intended path even if capture failed.
    }
    return filePath;
  }

  private async _settleLoadState(): Promise<void> {
    const page = this._page!;
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch {
      try {
        await page.waitForLoadState('load', { timeout: 3000 });
      } catch {
        // Best-effort — continue even if load state cannot be confirmed.
      }
    }
  }

  private async _perform(page: Page, action: TesterAction): Promise<void> {
    switch (action.kind) {
      case 'navigate': {
        await page.goto(action.url, { timeout: 30000 });
        break;
      }

      case 'click': {
        const locator = this._refMap.get(action.ref);
        if (!locator) {
          throw new Error('page changed — call browser_snapshot again');
        }
        await locator.click({ timeout: 10000 });
        break;
      }

      case 'type': {
        const locator = this._refMap.get(action.ref);
        if (!locator) {
          throw new Error('page changed — call browser_snapshot again');
        }
        await locator.fill(action.text, { timeout: 10000 });
        if (action.submit) {
          await locator.press('Enter', { timeout: 5000 });
        }
        break;
      }

      case 'select': {
        const locator = this._refMap.get(action.ref);
        if (!locator) {
          throw new Error('page changed — call browser_snapshot again');
        }
        await locator.selectOption(action.value, { timeout: 10000 });
        break;
      }

      case 'scroll': {
        const amountPx = action.amountPx ?? 300;
        const deltaY = action.direction === 'down' ? amountPx : -amountPx;
        await page.mouse.wheel(0, deltaY);
        // Small settle after scroll — not a navigation, just a short pause.
        await page.waitForTimeout(300);
        break;
      }

      case 'back': {
        await page.goBack({ timeout: 15000 });
        break;
      }

      case 'wait': {
        const clampedSeconds = Math.min(action.seconds, 30);
        await page.waitForTimeout(clampedSeconds * 1000);
        break;
      }

      default: {
        // TypeScript exhaustive check.
        const _never: never = action;
        throw new Error(`Unknown action kind: ${(_never as TesterAction).kind}`);
      }
    }
  }

  private _attachConsoleListener(): void {
    const page = this._page!;
    page.on('console', (msg) => {
      const level = this._mapConsoleType(msg.type());
      // Build event conditionally to satisfy exactOptionalPropertyTypes:
      // location is optional — only include it when there is a value.
      const locationUrl = msg.location().url;
      const event: ConsoleEvent = {
        level,
        text: msg.text(),
        ...(locationUrl
          ? { location: `${locationUrl}:${msg.location().lineNumber}` }
          : {}),
        stepIdx: this._currentStepIdx,
        timestamp: Date.now(),
      };
      this._onConsole(event);
    });
  }

  private _attachNetworkListeners(): void {
    const page = this._page!;

    page.on('request', (req) => {
      const event: NetworkEvent = {
        kind: 'request',
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        stepIdx: this._currentStepIdx,
        timestamp: Date.now(),
      };
      this._onNetwork(event);
    });

    page.on('response', (resp) => {
      // Capture stepIdx and timestamp synchronously at handler entry, BEFORE
      // any await, so slow response-body streaming cannot advance _currentStepIdx
      // to a later step and mis-attribute the event.
      const capturedStepIdx = this._currentStepIdx;
      const capturedTimestamp = Date.now();

      // async handler inside a sync event listener: errors are non-fatal.
      void (async () => {
        const req = resp.request();
        const status = resp.status();
        const resourceType = req.resourceType();

        // Capture body snippet for failed (4xx/5xx) JSON/XHR/fetch responses only.
        let bodySnippet: string | undefined;
        if (status >= 400 && (resourceType === 'xhr' || resourceType === 'fetch')) {
          try {
            const contentType = resp.headers()['content-type'] ?? '';
            if (contentType.includes('json') || contentType.includes('text')) {
              const text = await resp.text().catch(() => '');
              bodySnippet = text.slice(0, 500);
            }
          } catch {
            // Body capture is best-effort.
          }
        }

        // Build NetworkEvent conditionally to satisfy exactOptionalPropertyTypes:
        // status and bodySnippet are optional — only include them when present.
        const event: NetworkEvent = {
          kind: 'response',
          method: req.method(),
          url: req.url(),
          status,
          resourceType,
          ...(bodySnippet !== undefined ? { bodySnippet } : {}),
          stepIdx: capturedStepIdx,
          timestamp: capturedTimestamp,
        };
        this._onNetwork(event);
      })();
    });

    page.on('requestfailed', (req) => {
      const event: NetworkEvent = {
        kind: 'failed',
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        stepIdx: this._currentStepIdx,
        timestamp: Date.now(),
      };
      this._onNetwork(event);
    });
  }

  private _mapConsoleType(type: string): ConsoleEvent['level'] {
    switch (type) {
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'log':
        return 'log';
      case 'info':
        return 'info';
      default:
        return 'debug';
    }
  }

  private _describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
