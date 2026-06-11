import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock WebSocket ──────────────────────────────────────────────────────────

type WsHandler = (event: MessageEvent | Event) => void;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: WsHandler | null = null;
  onmessage: WsHandler | null = null;
  onclose: WsHandler | null = null;
  onerror: WsHandler | null = null;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new Event('close'));
  }

  // Test helper: simulate server open
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  // Test helper: simulate server message
  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  static instances: MockWebSocket[] = [];
  static reset() {
    MockWebSocket.instances = [];
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);

// ── Import store after mock is set ──────────────────────────────────────────

let wsStore: typeof import('../lib/ws.svelte.js');

describe('ws store', () => {
  beforeEach(async () => {
    MockWebSocket.reset();
    vi.resetModules();
    wsStore = await import('../lib/ws.svelte.js');
  });

  afterEach(() => {
    wsStore.wsDisconnect();
  });

  it('connect creates a WebSocket to /ws', () => {
    wsStore.wsConnect();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('/ws');
  });

  it('subscribe sends a subscribe message after open', () => {
    wsStore.wsConnect();
    wsStore.wsSubscribe('global');
    MockWebSocket.instances[0].simulateOpen();
    const sent = MockWebSocket.instances[0].sent;
    expect(sent.length).toBeGreaterThan(0);
    const msg = JSON.parse(sent[0]);
    expect(msg.type).toBe('subscribe');
    expect(msg.channel).toBe('global');
  });

  it('subscribe to run channel sends correct channel string', () => {
    wsStore.wsConnect();
    wsStore.wsSubscribe('run:run_abc123');
    MockWebSocket.instances[0].simulateOpen();
    const msg = JSON.parse(MockWebSocket.instances[0].sent[0]);
    expect(msg.channel).toBe('run:run_abc123');
  });

  it('incoming messages are stored in wsEvents', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0].simulateOpen();
    const evt = { channel: 'global', type: 'run.created', payload: { id: 'run_abc' } };
    MockWebSocket.instances[0].simulateMessage(evt);
    const events = wsStore.wsEvents;
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].type).toBe('run.created');
  });

  it('step.created events accumulate in wsRunSteps[runId]', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0].simulateOpen();
    const step = { id: 'stp_1', runId: 'run_xyz', idx: 0, kind: 'navigate',
      description: 'navigate to home', status: 'ok', createdAt: 1700000000000 };
    MockWebSocket.instances[0].simulateMessage({
      channel: 'run:run_xyz',
      type: 'step.created',
      payload: step,
    });
    expect(wsStore.wsRunSteps['run_xyz']).toBeDefined();
    expect(wsStore.wsRunSteps['run_xyz']).toHaveLength(1);
    expect(wsStore.wsRunSteps['run_xyz'][0].idx).toBe(0);
  });

  it('log.event events accumulate in wsRunLogEvents[runId]', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0].simulateOpen();
    const evt = { id: 'evt_1', runId: 'run_xyz', stepIdx: 0, kind: 'console',
      level: 'error', payload: { message: 'err' }, createdAt: 1700000000000 };
    MockWebSocket.instances[0].simulateMessage({
      channel: 'run:run_xyz',
      type: 'log.event',
      payload: evt,
    });
    expect(wsStore.wsRunLogEvents['run_xyz']).toBeDefined();
    expect(wsStore.wsRunLogEvents['run_xyz']).toHaveLength(1);
    expect(wsStore.wsRunLogEvents['run_xyz'][0].kind).toBe('console');
  });

  it('run.updated merges into wsRunStatus', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateMessage({
      channel: 'run:run_xyz',
      type: 'run.updated',
      payload: { id: 'run_xyz', status: 'passed', verdict: 'goal_achieved' },
    });
    expect(wsStore.wsRunStatus['run_xyz']).toEqual({ id: 'run_xyz', status: 'passed', verdict: 'goal_achieved' });
  });

  it('disconnect closes the socket', () => {
    wsStore.wsConnect();
    const sock = MockWebSocket.instances[0];
    wsStore.wsDisconnect();
    expect(sock.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('pending subscriptions are sent after delayed open', () => {
    wsStore.wsConnect();
    // subscribe before open
    wsStore.wsSubscribe('run:run_pending');
    // now simulate open
    MockWebSocket.instances[0].simulateOpen();
    const msgs = MockWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(msgs.some((m) => m.channel === 'run:run_pending')).toBe(true);
  });
});
