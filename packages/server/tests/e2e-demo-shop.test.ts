// packages/server/tests/e2e-demo-shop.test.ts
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

// ── helpers ──────────────────────────────────────────────────────────────────

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address() as { port: number };
      s.close(() => resolve(addr.port));
    });
    s.on('error', reject);
  });
}

async function waitFor(fn: () => Promise<boolean>, maxMs = 30_000, intervalMs = 300): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timed out');
}

async function apiGet(base: string, path: string, token?: string) {
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(base: string, path: string, body: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── chromium guard ───────────────────────────────────────────────────────────

function chromiumInstalled(): boolean {
  try {
    // Attempt to resolve the chromium executable; throws/non-zero if not installed.
    execSync('npx playwright install --dry-run chromium', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ── test suite ───────────────────────────────────────────────────────────────

describe.skipIf(!chromiumInstalled())('demo-shop full-lifecycle e2e', () => {
  let daemonBase: string;
  let shopBase: string;
  let daemonProc: ReturnType<typeof spawn> | null = null;
  let shopProc: ReturnType<typeof spawn> | null = null;
  let openUserHome: string;
  let runId: string;
  let runToken: string;
  let projectId: string;
  let personaId: string;

  const repoRoot = join(__dirname, '..', '..', '..');

  beforeAll(async () => {
    // ── 1. Start demo-shop ──
    const shopPort = await freePort();
    shopBase = `http://127.0.0.1:${shopPort}`;
    shopProc = spawn('node', [join(repoRoot, 'examples/demo-shop/server.mjs')], {
      env: { ...process.env, DEMO_PORT: String(shopPort) },
      stdio: 'pipe',
    });
    await waitFor(async () => {
      const r = await fetch(`${shopBase}/`).catch(() => null);
      return r?.ok ?? false;
    });

    // ── 2. Start daemon with temp home (real Playwright runner) ──
    const daemonPort = await freePort();
    openUserHome = mkdtempSync(join(tmpdir(), 'openuser-e2e-'));
    daemonBase = `http://127.0.0.1:${daemonPort}`;
    daemonProc = spawn(
      'node',
      [join(repoRoot, 'packages/cli/dist/index.js'), 'start', '--detach', '--no-open', `--port=${daemonPort}`],
      {
        env: {
          ...process.env,
          OPENUSER_HOME: openUserHome,
          OPENUSER_RUNNER_KIND: 'playwright',
        },
        stdio: 'pipe',
      },
    );
    await waitFor(async () => {
      const r = await fetch(`${daemonBase}/api/health`).catch(() => null);
      if (!r?.ok) return false;
      const json = await r.json().catch(() => null);
      return json?.ok === true;
    });

    // ── 3. Register project + persona ──
    const project = await apiPost(daemonBase, '/api/projects', {
      name: 'Demo Shop E2E',
      path: openUserHome,
      baseUrl: shopBase,
      environments: [{ name: 'local', url: shopBase }],
    });
    projectId = project.id;

    const persona = await apiPost(daemonBase, `/api/projects/${projectId}/personas`, {
      name: 'Alex (Test Buyer)',
      role: 'test_buyer',
      identity: {
        fullName: 'Alex Tester',
        roleLabel: 'Test buyer',
        credentials: { username: 'demo', password: 'demo123' },
        locale: 'en-US',
      },
      behavior: {
        techSavviness: 'average',
        patience: 'medium',
        readingStyle: 'reads',
        device: 'desktop',
        viewport: { width: 1280, height: 720 },
        habits: 'Wants to buy one product and complete checkout.',
      },
      knowledge: {
        productKnowledge: 'Knows the shop sells widgets.',
        expectations: 'Expects a working checkout.',
        vocabulary: "Uses 'cart', 'checkout', 'Place Order'.",
      },
    });
    personaId = persona.id;

    // ── 4. Prepare run ──
    const prepared = await apiPost(daemonBase, '/api/runs', {
      projectId,
      adhocGoal:
        'Browse the shop, add Widget Pro to the cart, attempt checkout, and observe all pages for errors.',
      personaId,
      environment: 'local',
      agentLabel: 'vitest-scripted',
    });
    runId = prepared.runId;
    runToken = prepared.token;

    expect(prepared.testerPrompt).toContain('begin_run');
    expect(prepared.testerPrompt).toContain(runToken);
    expect(prepared.testerPrompt).toContain('Alex (Test Buyer)');
  }, 120_000);

  afterAll(async () => {
    // Best-effort: if the run never reached complete, try to finalize so the
    // browser session closes; ignore errors (run may already be complete).
    await fetch(`${daemonBase}/api/tester/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runToken}` },
      body: JSON.stringify({ verdict: 'partial', summary: 'Test cleanup — run aborted by afterAll.' }),
    }).catch(() => {});
    daemonProc?.kill('SIGTERM');
    shopProc?.kill('SIGTERM');
  }, 30_000);

  it('begin_run returns persona card, mission, and first snapshot', async () => {
    const result = await apiPost(daemonBase, '/api/tester/begin', {}, runToken);
    expect(result.personaCard).toContain('Alex Tester');
    expect(result.mission).toContain('Widget Pro');
    expect(result.snapshot).toMatchObject({
      url: shopBase + '/',
      title: expect.stringContaining('Demo Shop'),
    });
  });

  it('navigating to the product page triggers a 500 from /api/stock', async () => {
    await apiPost(
      daemonBase,
      '/api/tester/action',
      { kind: 'navigate', url: `${shopBase}/products/p1`, note: 'Opening Widget Pro detail page to check stock and price.' },
      runToken,
    );

    // Wait for the async /api/stock call to be captured by the log pipeline.
    await new Promise((r) => setTimeout(r, 1500));

    const snap = await apiPost(daemonBase, '/api/tester/snapshot', {}, runToken);
    expect(snap.url).toContain('/products/p1');
    expect(snap.title).toContain('Widget Pro');
  });

  it('cart page load triggers a console.error', async () => {
    await apiPost(
      daemonBase,
      '/api/tester/action',
      { kind: 'navigate', url: `${shopBase}/cart`, note: 'Visiting cart page directly to check its state.' },
      runToken,
    );

    await new Promise((r) => setTimeout(r, 500));

    const snap = await apiPost(daemonBase, '/api/tester/snapshot', {}, runToken);
    expect(snap.url).toContain('/cart');
  });

  it('report_finding: console error on cart page', async () => {
    const finding = await apiPost(
      daemonBase,
      '/api/tester/finding',
      {
        type: 'console',
        severity: 'high',
        title: 'Console error on cart page load — "CartService: session sync failed"',
        description:
          'Every time I open my cart, a hidden error message fires in the background. The cart page appears to load, but something is going wrong behind the scenes. I am not sure if my cart is accurate.',
      },
      runToken,
    );
    expect(finding.id).toMatch(/^fnd_/);
    expect(finding.type).toBe('console');
    expect(finding.severity).toBe('high');
  });

  it('report_finding: /api/stock 500 on product page', async () => {
    const finding = await apiPost(
      daemonBase,
      '/api/tester/finding',
      {
        type: 'network',
        severity: 'high',
        title: 'Stock information unavailable on product detail page',
        description:
          'I opened the Widget Pro page. It said "Loading stock…" for a moment, then changed to "Stock information unavailable." I could not tell if the product was actually in stock or not before adding it to my cart.',
      },
      runToken,
    );
    expect(finding.id).toMatch(/^fnd_/);
    expect(finding.type).toBe('network');
  });

  it('report_finding: Continue button clears the cart (ux_confusion)', async () => {
    await apiPost(
      daemonBase,
      '/api/tester/action',
      { kind: 'navigate', url: `${shopBase}/cart`, note: 'Back to cart to look for checkout button.' },
      runToken,
    );

    const finding = await apiPost(
      daemonBase,
      '/api/tester/finding',
      {
        type: 'ux_confusion',
        severity: 'medium',
        title: '"Continue" button in cart empties the cart instead of going to checkout',
        description:
          'I saw a button in my cart labelled "Continue". I expected it to take me to the checkout page. But after clicking it my cart was completely empty. Nothing warned me this would happen. I had to start over.',
      },
      runToken,
    );
    expect(finding.type).toBe('ux_confusion');
    expect(finding.severity).toBe('medium');
  });

  it('save_checkpoint after cart populated', async () => {
    const checkpoint = await apiPost(
      daemonBase,
      '/api/tester/checkpoint',
      {
        name: 'After cart load',
        description: 'Cart page visited; session established with demo user.',
        journeyNotes: 'Logged in as demo/demo123. Navigated to cart. Ready to attempt checkout.',
      },
      runToken,
    );
    expect(checkpoint.id).toMatch(/^chk_/);
    expect(existsSync(checkpoint.storageStatePath)).toBe(true);
  });

  it('report_finding: Place Order button does nothing (functional, critical)', async () => {
    await apiPost(
      daemonBase,
      '/api/tester/action',
      { kind: 'navigate', url: `${shopBase}/checkout`, note: 'Navigating to checkout to try placing an order.' },
      runToken,
    );

    const finding = await apiPost(
      daemonBase,
      '/api/tester/finding',
      {
        type: 'functional',
        severity: 'critical',
        title: '"Place Order" button does nothing — order cannot be submitted',
        description:
          'I filled in my name, email, address, and chose Online Banking as payment. I clicked "Place Order". Nothing happened — no loading indicator, no confirmation page, no error message. I clicked it three more times. The page stayed exactly the same. I cannot complete my purchase.',
      },
      runToken,
    );
    expect(finding.type).toBe('functional');
    expect(finding.severity).toBe('critical');
  });

  it('complete_run returns structured outcome with all 4 findings', async () => {
    const outcome = await apiPost(
      daemonBase,
      '/api/tester/complete',
      {
        verdict: 'blocked',
        summary:
          'I could not complete a purchase. The Place Order button does nothing, the cart has a misleading Continue button that deletes items, stock information fails to load on product pages, and the cart page produces a background error. The shop is not functional for buying.',
      },
      runToken,
    );

    expect(outcome.status).toBe('blocked');
    expect(outcome.findings).toHaveLength(4);

    const types = outcome.findings.map((f: { type: string }) => f.type);
    expect(types).toContain('functional');
    expect(types).toContain('console');
    expect(types).toContain('network');
    expect(types).toContain('ux_confusion');
  });

  it('findings rows exist via the findings API with correct types', async () => {
    const findings = await apiGet(daemonBase, `/api/findings?projectId=${projectId}`);
    expect(findings.length).toBeGreaterThanOrEqual(4);
    const byType = Object.fromEntries(findings.map((f: { type: string }) => [f.type, f]));
    expect(byType['functional']).toBeDefined();
    expect(byType['console']).toBeDefined();
    expect(byType['network']).toBeDefined();
    expect(byType['ux_confusion']).toBeDefined();
  });

  it('run detail includes steps and screenshot paths that exist on disk', async () => {
    const run = await apiGet(daemonBase, `/api/runs/${runId}`);
    expect(run.steps.length).toBeGreaterThan(0);
    const stepsWithScreenshots = run.steps.filter(
      (s: { screenshotPath?: string }) => s.screenshotPath,
    );
    expect(stepsWithScreenshots.length).toBeGreaterThan(0);
    for (const step of stepsWithScreenshots.slice(0, 3)) {
      expect(existsSync(step.screenshotPath)).toBe(true);
    }
  });

  it('video file exists on disk after run completion', async () => {
    const run = await apiGet(daemonBase, `/api/runs/${runId}`);
    expect(run.videoPath).toBeTruthy();
    expect(existsSync(run.videoPath)).toBe(true);
  });

  it('markdown report contains all 4 finding titles', async () => {
    const res = await fetch(`${daemonBase}/api/runs/${runId}/report`);
    expect(res.ok).toBe(true);
    const report = await res.text();
    expect(report).toContain('Place Order');
    expect(report).toContain('CartService');
    expect(report).toContain('Stock information unavailable');
    expect(report).toContain('Continue');
  });

  it('run findings include console + network evidence', async () => {
    const run = await apiGet(daemonBase, `/api/runs/${runId}`);
    const consoleFinding = run.findings?.find((f: { type: string }) => f.type === 'console');
    expect(consoleFinding).toBeDefined();
    const networkFinding = run.findings?.find((f: { type: string }) => f.type === 'network');
    expect(networkFinding).toBeDefined();
    expect(consoleFinding?.evidence).toBeDefined();
    expect(networkFinding?.evidence).toBeDefined();
  });
}, 180_000);
