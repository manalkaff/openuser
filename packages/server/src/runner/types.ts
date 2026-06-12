import type { TesterAction, PageSnapshot } from '@openuser/shared';

export interface ConsoleEvent {
  level: 'log' | 'info' | 'warning' | 'error' | 'debug';
  text: string;
  location?: string;
  stepIdx: number;
  timestamp: number;
}

export interface NetworkEvent {
  kind: 'request' | 'response' | 'failed';
  method: string;
  url: string;
  status?: number;           // present on 'response'
  resourceType: string;
  bodySnippet?: string;      // present for failed JSON/api responses only
  stepIdx: number;
  timestamp: number;
}

export interface RunnerSession {
  begin(opts: {
    baseUrl: string;
    viewport: { width: number; height: number };
    storageStatePath?: string;
    videoDir: string;
    headed: boolean;
    onConsole: (e: ConsoleEvent) => void;
    onNetwork: (e: NetworkEvent) => void;
  }): Promise<PageSnapshot>;
  snapshot(): Promise<PageSnapshot>;
  act(action: TesterAction): Promise<{
    snapshot: PageSnapshot;
    screenshotPath: string;
    pageUrl: string;
  }>;
  screenshot(dir: string): Promise<{ path: string }>;
  saveStorageState(path: string): Promise<void>;
  close(): Promise<{ videoPath?: string }>;
}

// TesterAction and PageSnapshot are imported from '@openuser/shared' above.
// Do NOT redefine them here.
export type { TesterAction, PageSnapshot };
