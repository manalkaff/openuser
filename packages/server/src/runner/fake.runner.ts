import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { PageSnapshot } from '@openuser/shared';
import type { RunnerSession, ConsoleEvent, NetworkEvent, TesterAction } from './types.js';

// Minimal 1x1 transparent PNG (68 bytes, base64-encoded)
const PLACEHOLDER_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function writePlaceholderPng(path: string): void {
  const buf = Buffer.from(PLACEHOLDER_PNG_B64, 'base64');
  writeFileSync(path, buf);
}

// Three canned pages for the fake app
const FAKE_PAGES: PageSnapshot[] = [
  {
    url: 'http://fake.local/',
    title: 'Fake Shop — Home',
    tree: [
      'document',
      '  banner',
      '    heading "Fake Shop" [ref=e1]',
      '    navigation',
      '      link "Products" [ref=e2]',
      '      link "Cart" [ref=e3]',
      '      link "Login" [ref=e4]',
      '  main',
      '    heading "Featured Products" [ref=e5]',
      '    article',
      '      heading "Widget A — $9.99" [ref=e6]',
      '      button "Add to Cart" [ref=e7]',
      '    article',
      '      heading "Gadget B — $24.99" [ref=e8]',
      '      button "Add to Cart" [ref=e9]',
    ].join('\n'),
  },
  {
    url: 'http://fake.local/cart',
    title: 'Fake Shop — Cart',
    tree: [
      'document',
      '  banner',
      '    heading "Fake Shop" [ref=e1]',
      '    navigation',
      '      link "Products" [ref=e2]',
      '      link "Cart" [ref=e3]',
      '  main',
      '    heading "Your Cart" [ref=e10]',
      '    list',
      '      listitem "Widget A — $9.99 × 1" [ref=e11]',
      '    text "Total: $9.99"',
      '    button "Proceed to Checkout" [ref=e12]',
    ].join('\n'),
  },
  {
    url: 'http://fake.local/checkout',
    title: 'Fake Shop — Checkout',
    tree: [
      'document',
      '  banner',
      '    heading "Fake Shop" [ref=e1]',
      '  main',
      '    heading "Checkout" [ref=e13]',
      '    form',
      '      textbox "Email address" [ref=e14]',
      '      textbox "Card number" [ref=e15]',
      '      button "Place Order" [ref=e16]',
    ].join('\n'),
  },
];

export class FakeRunner implements RunnerSession {
  private pageIndex = 0;
  private videoDir = '';
  private shotCounter = 0;
  private started = false;
  private onConsole: (e: ConsoleEvent) => void = () => {};
  private onNetwork: (e: NetworkEvent) => void = () => {};

  async begin(opts: {
    baseUrl: string;
    viewport: { width: number; height: number };
    storageStatePath?: string;
    videoDir: string;
    headed: boolean;
    onConsole: (e: ConsoleEvent) => void;
    onNetwork: (e: NetworkEvent) => void;
  }): Promise<PageSnapshot> {
    this.videoDir = opts.videoDir;
    this.onConsole = opts.onConsole;
    this.onNetwork = opts.onNetwork;
    this.started = true;
    this.pageIndex = 0;

    mkdirSync(opts.videoDir, { recursive: true });

    // Emit a fake console log and a fake network event for realism
    this.onConsole({ level: 'log', text: '[FakeRunner] page loaded', stepIdx: 0, timestamp: Date.now() });
    this.onNetwork({
      kind: 'response',
      method: 'GET',
      url: FAKE_PAGES[0]!.url,
      status: 200,
      resourceType: 'document',
      stepIdx: 0,
      timestamp: Date.now(),
    });

    return FAKE_PAGES[0]!;
  }

  async snapshot(): Promise<PageSnapshot> {
    return FAKE_PAGES[this.pageIndex]!;
  }

  async act(action: TesterAction): Promise<{ snapshot: PageSnapshot; screenshotPath: string; pageUrl: string }> {
    if (!this.started) throw new Error('FakeRunner: begin() not called');

    // Advance page for navigation/click actions
    if (action.kind === 'navigate') {
      if (action.url.includes('cart')) this.pageIndex = 1;
      else if (action.url.includes('checkout')) this.pageIndex = 2;
      else this.pageIndex = 0;
    } else if (action.kind === 'click') {
      if (action.ref === 'e3' || action.ref === 'e12') {
        // Cart link or checkout button
        this.pageIndex = action.ref === 'e12' ? 2 : 1;
      } else if (action.ref === 'e7' || action.ref === 'e9') {
        // Add to cart → emit a network event
        this.onNetwork({
          kind: 'response',
          method: 'POST',
          url: 'http://fake.local/api/cart',
          status: 200,
          resourceType: 'fetch',
          stepIdx: this.shotCounter,
          timestamp: Date.now(),
        });
      } else if (action.ref === 'e16') {
        // Place order → emit a 500 error network event (intentional bug for finding tests)
        this.onNetwork({
          kind: 'response',
          method: 'POST',
          url: 'http://fake.local/api/orders',
          status: 500,
          resourceType: 'fetch',
          bodySnippet: '{"error":"payment gateway unavailable"}',
          stepIdx: this.shotCounter,
          timestamp: Date.now(),
        });
        // Also emit a console error
        this.onConsole({ level: 'error', text: 'Payment failed: gateway unavailable', stepIdx: this.shotCounter, timestamp: Date.now() });
      }
    }

    const screenshotPath = join(this.videoDir, `shot_${String(++this.shotCounter).padStart(4, '0')}.png`);
    writePlaceholderPng(screenshotPath);
    const page = FAKE_PAGES[this.pageIndex]!;
    return { snapshot: page, screenshotPath, pageUrl: page.url };
  }

  async screenshot(dir: string): Promise<{ path: string }> {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${nanoid(8)}.png`);
    writePlaceholderPng(path);
    return { path };
  }

  async saveStorageState(path: string): Promise<void> {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ cookies: [], origins: [] }, null, 2));
  }

  async close(): Promise<{ videoPath?: string }> {
    // Write a placeholder video file
    if (this.videoDir) {
      const videoPath = join(this.videoDir, 'video.webm');
      writeFileSync(videoPath, Buffer.alloc(0));
      return { videoPath };
    }
    return {};
  }
}
