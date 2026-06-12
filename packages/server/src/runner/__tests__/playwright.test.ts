// packages/server/src/runner/__tests__/playwright.test.ts
/**
 * Integration tests for PlaywrightRunner.
 * Requires Chromium installed: npx playwright install chromium
 * Gracefully skipped when Chromium is not available.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// ─── Chromium detection ──────────────────────────────────────────────────────

async function isChromiumInstalled(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const chromiumAvailable = await isChromiumInstalled();

// ─── Fixture HTTP server ─────────────────────────────────────────────────────

// import.meta.dirname requires Node >= 20.11 AND moduleResolution: bundler in tsconfig.
// This project uses moduleResolution: NodeNext, so we use the fileURLToPath fallback.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixture');

/**
 * Serve the fixture HTML directory over HTTP.
 * Returns { server, baseUrl, close }.
 */
async function startFixtureServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        // Strip query string (form GET submits append ?email=&country= etc.)
        const rawUrl = req.url ?? '/';
        const urlPath = rawUrl.split('?')[0] ?? '/';

        // Default to index.html
        let filePath = path.join(
          FIXTURE_DIR,
          urlPath === '/' ? 'index.html' : urlPath,
        );

        // Prevent path traversal
        if (!filePath.startsWith(FIXTURE_DIR + path.sep)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        const content = await fs.readFile(filePath).catch(() => null);
        if (!content) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }

        const ext = path.extname(filePath);
        const contentType = ext === '.html' ? 'text/html' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        baseUrl,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

// ─── Temp dir helper ─────────────────────────────────────────────────────────

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `ou-test-${prefix}-`));
}

// ─── Default begin() options helper ──────────────────────────────────────────

function defaultBeginOpts(baseUrl: string, videoDir: string) {
  return {
    baseUrl,
    viewport: { width: 1280, height: 720 },
    videoDir,
    headed: false,
    onConsole: () => {},
    onNetwork: () => {},
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe.skipIf(!chromiumAvailable)(
  'PlaywrightRunner integration',
  () => {
    let baseUrl: string;
    let stopServer: () => Promise<void>;

    beforeAll(async () => {
      const server = await startFixtureServer();
      baseUrl = server.baseUrl;
      stopServer = server.close;
    });

    afterAll(async () => {
      await stopServer?.();
    });

    // ── Test 1: snapshot tree contains refs ────────────────────────────────

    it('snapshot tree contains [ref=eN] markers for interactive elements', async () => {
      const { PlaywrightRunner } = await import('../playwright.js');
      const runner = new PlaywrightRunner();
      const videoDir = await makeTempDir('snap');

      try {
        const snapshot = await runner.begin(defaultBeginOpts(baseUrl, videoDir));

        // index.html has a link "Go to Form" and a button "Trigger Error"
        expect(snapshot.tree).toMatch(/\[ref=e\d+\]/);
        expect(snapshot.url).toContain('127.0.0.1');
        expect(snapshot.title).toBe('OpenUser Test Fixture — Home');
      } finally {
        await runner.close();
      }
    });

    // ── Test 2: click by ref navigates to the linked page ─────────────────

    it('click-by-ref navigates to the target page', async () => {
      const { PlaywrightRunner } = await import('../playwright.js');
      const runner = new PlaywrightRunner();
      const videoDir = await makeTempDir('click');

      try {
        const snap0 = await runner.begin(defaultBeginOpts(baseUrl, videoDir));

        // Find the ref for "Go to Form" link.
        // Playwright ariaSnapshot emits "link "Go to Form":" (with colon) when the
        // element has nested content (href attribute shown as /url). The trailing
        // colon is captured in the regex as an optional character.
        const linkRefMatch = snap0.tree.match(/link\s+"Go to Form":?\s*\[ref=(e\d+)\]/);
        expect(linkRefMatch).not.toBeNull();
        const linkRef = linkRefMatch![1]!;

        const result = await runner.act({ kind: 'click', ref: linkRef });
        expect(result.snapshot.url).toContain('/form.html');
        expect(result.snapshot.title).toBe('OpenUser Test Fixture — Form');

        // form.html should have interactive refs (email, country select, checkbox, submit)
        expect(result.snapshot.tree).toMatch(/\[ref=e\d+\]/);
      } finally {
        await runner.close();
      }
    });

    // ── Test 3: type fills a field + submit navigates ──────────────────────

    it('type fills textbox and submit navigates to result page', async () => {
      const { PlaywrightRunner } = await import('../playwright.js');
      const runner = new PlaywrightRunner();
      const videoDir = await makeTempDir('type');

      try {
        await runner.begin(defaultBeginOpts(`${baseUrl}/form.html`, videoDir));

        const formSnap = await runner.snapshot();

        // Find Email address textbox ref.
        // Playwright ariaSnapshot emits "textbox "Email address":" (with colon) when the
        // element has nested content (placeholder shown as /placeholder).
        const emailMatch = formSnap.tree.match(/textbox\s+"Email address":?\s*\[ref=(e\d+)\]/);
        expect(emailMatch).not.toBeNull();
        const emailRef = emailMatch![1]!;

        // Find Submit button ref
        const submitMatch = formSnap.tree.match(/button\s+"Submit Form":?\s*\[ref=(e\d+)\]/);
        expect(submitMatch).not.toBeNull();
        const submitRef = submitMatch![1]!;

        // Type into email field (no submit on type)
        await runner.act({ kind: 'type', ref: emailRef, text: 'test@example.com' });

        // Click submit button
        const result = await runner.act({ kind: 'click', ref: submitRef });
        expect(result.snapshot.url).toContain('/result.html');
        expect(result.snapshot.title).toBe('OpenUser Test Fixture — Result');
      } finally {
        await runner.close();
      }
    });

    // ── Test 4: console.error captured via onConsole callback ─────────────

    it('captures console.error via onConsole callback', async () => {
      const { PlaywrightRunner } = await import('../playwright.js');
      const runner = new PlaywrightRunner();
      const videoDir = await makeTempDir('console');

      const consoleEvents: Array<{ level: string; text: string }> = [];

      try {
        const snap0 = await runner.begin({
          ...defaultBeginOpts(baseUrl, videoDir),
          onConsole: (e) => consoleEvents.push({ level: e.level, text: e.text }),
        });

        // Find the "Trigger Error" button ref
        const btnMatch = snap0.tree.match(/button\s+"Trigger Error":?\s*\[ref=(e\d+)\]/);
        expect(btnMatch).not.toBeNull();
        const btnRef = btnMatch![1]!;

        await runner.act({ kind: 'click', ref: btnRef });

        // Should have captured the console.error from the button handler
        const errorEvent = consoleEvents.find(
          (e) => e.level === 'error' && e.text.includes('intentional-test-error'),
        );
        expect(errorEvent).toBeDefined();
        expect(errorEvent!.level).toBe('error');
      } finally {
        await runner.close();
      }
    });

    // ── Test 5: failed network request captured via onNetwork callback ─────

    it('captures 404 network response via onNetwork callback', async () => {
      const { PlaywrightRunner } = await import('../playwright.js');
      const runner = new PlaywrightRunner();
      const videoDir = await makeTempDir('network');

      const networkEvents: Array<{ kind: string; url: string; status: number | undefined }> = [];

      try {
        await runner.begin({
          ...defaultBeginOpts(baseUrl, videoDir),
          onNetwork: (e) =>
            networkEvents.push({ kind: e.kind, url: e.url, status: e.status }),
        });

        // index.html fetches /this-does-not-exist.json on DOMContentLoaded
        // Wait a moment for the fetch to complete
        await runner.act({ kind: 'wait', seconds: 1 });

        // Should have captured a 404 response for the non-existent endpoint
        const failedReq = networkEvents.find(
          (e) =>
            e.url.includes('this-does-not-exist.json') &&
            (e.kind === 'response' ? e.status === 404 : e.kind === 'failed'),
        );
        expect(failedReq).toBeDefined();
      } finally {
        await runner.close();
      }
    });

    // ── Test 6: storageState save/restore keeps localStorage ──────────────

    it('saves and restores storageState preserving localStorage values', async () => {
      const { PlaywrightRunner } = await import('../playwright.js');
      const tmpDir = await makeTempDir('storage');
      const storageStatePath = path.join(tmpDir, 'state.json');
      const videoDir1 = await makeTempDir('storage-vid1');
      const videoDir2 = await makeTempDir('storage-vid2');

      // ── Session 1: navigate to form, submit, save storageState ──────────
      const runner1 = new PlaywrightRunner();
      try {
        await runner1.begin(defaultBeginOpts(`${baseUrl}/form.html`, videoDir1));

        const formSnap = await runner1.snapshot();

        // Submit the form to set localStorage key ou_test_submitted
        const submitMatch = formSnap.tree.match(/button\s+"Submit Form":?\s*\[ref=(e\d+)\]/);
        expect(submitMatch).not.toBeNull();
        await runner1.act({ kind: 'click', ref: submitMatch![1]! });

        // Allow the submit navigation to complete before capturing storage state
        await runner1.act({ kind: 'wait', seconds: 1 });

        // Now save storageState (which includes the localStorage set by form submission)
        await runner1.saveStorageState(storageStatePath);
      } finally {
        await runner1.close();
      }

      // ── (a) Assert the SAVED storageState JSON actually captured the localStorage entry ──
      const stateFileContent = await fs.readFile(storageStatePath, 'utf-8');
      const stateJson = JSON.parse(stateFileContent) as {
        cookies: unknown[];
        origins: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
      };
      const origins = stateJson.origins;
      const hasKey = origins.some(
        (o) => o.localStorage?.some((kv) => kv.name === 'ou_test_submitted' && kv.value === 'true'),
      );
      expect(hasKey).toBe(true);

      // ── Session 2: restore storageState, navigate to result, check localStorage ──
      const runner2 = new PlaywrightRunner();
      try {
        const snap = await runner2.begin({
          ...defaultBeginOpts(`${baseUrl}/result.html`, videoDir2),
          storageStatePath,
        });

        expect(snap.url).toContain('/result.html');

        const finalSnap = await runner2.snapshot();
        expect(finalSnap.url).toContain('result.html');

        // ── (b) Prove the RESTORE side works: save storageState from session 2 and assert
        //    the ou_test_submitted key is still present (proves restore round-trip, not just
        //    that the session didn't crash — ariaSnapshot can't show paragraph text so we
        //    use the state file as the observable).
        const restoredStatePath = path.join(tmpDir, 'state2.json');
        await runner2.saveStorageState(restoredStatePath);
        const restoredFileContent = await fs.readFile(restoredStatePath, 'utf-8');
        const restoredJson = JSON.parse(restoredFileContent) as {
          cookies: unknown[];
          origins: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
        };
        const restoredOrigins = restoredJson.origins;
        const restoredHasKey = restoredOrigins.some(
          (o) => o.localStorage?.some((kv) => kv.name === 'ou_test_submitted' && kv.value === 'true'),
        );
        expect(restoredHasKey).toBe(true);
      } finally {
        await runner2.close();
      }
    });

    // ── Test 7: video file exists after close() ────────────────────────────

    it('produces a video.webm file after close()', async () => {
      const { PlaywrightRunner } = await import('../playwright.js');
      const runner = new PlaywrightRunner();
      const videoDir = await makeTempDir('video');

      try {
        await runner.begin(defaultBeginOpts(baseUrl, videoDir));

        // Do a small action to ensure there is something to record
        await runner.act({ kind: 'wait', seconds: 1 });

        const { videoPath } = await runner.close();

        expect(videoPath).toBeDefined();
        expect(typeof videoPath).toBe('string');

        // The file must actually exist on disk
        const stat = await fs.stat(videoPath!);
        expect(stat.size).toBeGreaterThan(0);
      } finally {
        await runner.close();
      }
    });

    // ── Test 8: stale ref returns the hint error ───────────────────────────

    it('stale ref returns the contract hint error string', async () => {
      const { PlaywrightRunner } = await import('../playwright.js');
      const runner = new PlaywrightRunner();
      const videoDir = await makeTempDir('stale');

      try {
        const snap0 = await runner.begin(defaultBeginOpts(baseUrl, videoDir));

        // Navigate away — this changes the page, making all old refs stale
        await runner.act({ kind: 'navigate', url: `${baseUrl}/form.html` });

        // Rebuild the refMap to form.html's elements (e1..eN for the form's elements).
        await runner.snapshot();

        // Use a ref ID that is guaranteed to not exist in ANY snapshot (far out of range).
        // This avoids the problem where old ref IDs from index.html accidentally coincide
        // with form.html ref IDs (both pages use sequential e1, e2, ... counters).
        const result = await runner.act({ kind: 'click', ref: 'e9999' });
        // The error message must contain the contract hint string
        expect(result.snapshot.tree).toContain('page changed — call browser_snapshot again');
      } finally {
        await runner.close();
      }
    });

    // ── Test 9: per-step screenshots are written to steps/<idx>.png ───────

    it('writes per-step screenshot to steps/<idx>.png', async () => {
      const { PlaywrightRunner } = await import('../playwright.js');
      const runner = new PlaywrightRunner();
      const videoDir = await makeTempDir('screenshots');

      try {
        await runner.begin(defaultBeginOpts(baseUrl, videoDir));

        const result = await runner.act({ kind: 'wait', seconds: 1 });

        // screenshotPath should point to steps/0.png (first act call = idx 0)
        expect(result.screenshotPath).toContain(path.join('steps', '0.png'));

        const stat = await fs.stat(result.screenshotPath);
        expect(stat.size).toBeGreaterThan(0);
      } finally {
        await runner.close();
      }
    });

    // ── Test 10: select fills a dropdown ──────────────────────────────────

    it('select action fills a combobox by value', async () => {
      const { PlaywrightRunner } = await import('../playwright.js');
      const runner = new PlaywrightRunner();
      const videoDir = await makeTempDir('select');

      try {
        await runner.begin(defaultBeginOpts(`${baseUrl}/form.html`, videoDir));

        const formSnap = await runner.snapshot();

        // Find Country combobox ref.
        // Playwright ariaSnapshot emits "combobox "Country":" (with colon) when the
        // element has nested content (options shown as children).
        const selectMatch = formSnap.tree.match(/combobox\s+"Country":?\s*\[ref=(e\d+)\]/);
        expect(selectMatch).not.toBeNull();
        const selectRef = selectMatch![1]!;

        // Select "United Kingdom"
        const result = await runner.act({ kind: 'select', ref: selectRef, value: 'gb' });

        // After selection, snapshot should reflect current page state
        expect(result.pageUrl).toContain('/form.html');
        const stat = await fs.stat(result.screenshotPath);
        expect(stat.size).toBeGreaterThan(0);
      } finally {
        await runner.close();
      }
    });

    // ── Test 11: on-demand screenshot() writes to shots/<nanoid>.png ──────

    it('on-demand screenshot() writes to shots/<nanoid>.png', async () => {
      const { PlaywrightRunner } = await import('../playwright.js');
      const runner = new PlaywrightRunner();
      const videoDir = await makeTempDir('shots');
      const shotsDir = path.join(videoDir, 'shots');

      try {
        await runner.begin(defaultBeginOpts(baseUrl, videoDir));

        const { path: shotPath } = await runner.screenshot(shotsDir);

        expect(shotPath).toContain('shots');
        const stat = await fs.stat(shotPath);
        expect(stat.size).toBeGreaterThan(0);
      } finally {
        await runner.close();
      }
    });
  },
);
