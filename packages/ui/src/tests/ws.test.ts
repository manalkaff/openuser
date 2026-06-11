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

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
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
    expect(MockWebSocket.instances[0]!.url).toContain('/ws');
  });

  it('subscribe sends a subscribe message after open', () => {
    wsStore.wsConnect();
    wsStore.wsSubscribe('global');
    MockWebSocket.instances[0]!.simulateOpen();
    const sent = MockWebSocket.instances[0]!.sent;
    expect(sent.length).toBeGreaterThan(0);
    const msg = JSON.parse(sent[0]!);
    expect(msg.type).toBe('subscribe');
    expect(msg.channel).toBe('global');
  });

  it('subscribe to run channel sends correct channel string', () => {
    wsStore.wsConnect();
    wsStore.wsSubscribe('run:run_abc123');
    MockWebSocket.instances[0]!.simulateOpen();
    const msg = JSON.parse(MockWebSocket.instances[0]!.sent[0]!);
    expect(msg.channel).toBe('run:run_abc123');
  });

  it('incoming messages are stored in wsEvents', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0]!.simulateOpen();
    const evt = { channel: 'global', type: 'run.created', payload: { id: 'run_abc' } };
    MockWebSocket.instances[0]!.simulateMessage(evt);
    const events = wsStore.wsEvents;
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]!.type).toBe('run.created');
  });

  it('step.created events accumulate in wsRunSteps[runId]', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0]!.simulateOpen();
    const step = { id: 'stp_1', runId: 'run_xyz', idx: 0, kind: 'navigate',
      description: 'navigate to home', status: 'ok', createdAt: '2023-11-14T22:13:20.000Z' };
    MockWebSocket.instances[0]!.simulateMessage({
      channel: 'run:run_xyz',
      type: 'step.created',
      payload: step,
    });
    expect(wsStore.wsRunSteps['run_xyz']).toBeDefined();
    expect(wsStore.wsRunSteps['run_xyz']).toHaveLength(1);
    expect(wsStore.wsRunSteps['run_xyz']![0]!.idx).toBe(0);
  });

  it('log.event events accumulate in wsRunLogEvents[runId]', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0]!.simulateOpen();
    const evt = { id: 'evt_1', runId: 'run_xyz', stepIdx: 0, kind: 'console',
      level: 'error', payload: { message: 'err' }, createdAt: '2023-11-14T22:13:20.000Z' };
    MockWebSocket.instances[0]!.simulateMessage({
      channel: 'run:run_xyz',
      type: 'log.event',
      payload: evt,
    });
    expect(wsStore.wsRunLogEvents['run_xyz']).toBeDefined();
    expect(wsStore.wsRunLogEvents['run_xyz']).toHaveLength(1);
    expect(wsStore.wsRunLogEvents['run_xyz']![0]!.kind).toBe('console');
  });

  it('run.updated merges into wsRunStatus', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0]!.simulateOpen();
    MockWebSocket.instances[0]!.simulateMessage({
      channel: 'run:run_xyz',
      type: 'run.updated',
      payload: { id: 'run_xyz', status: 'passed', verdict: 'goal_achieved' },
    });
    expect(wsStore.wsRunStatus['run_xyz']).toEqual({ id: 'run_xyz', status: 'passed', verdict: 'goal_achieved' });
  });

  it('disconnect closes the socket', () => {
    wsStore.wsConnect();
    const sock = MockWebSocket.instances[0]!;
    wsStore.wsDisconnect();
    expect(sock.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('pending subscriptions are sent after delayed open', () => {
    wsStore.wsConnect();
    // subscribe before open
    wsStore.wsSubscribe('run:run_pending');
    // now simulate open
    MockWebSocket.instances[0]!.simulateOpen();
    const msgs = MockWebSocket.instances[0]!.sent.map((s) => JSON.parse(s));
    expect(msgs.some((m) => m.channel === 'run:run_pending')).toBe(true);
  });

  it('wsIsConnected() returns true after open, false after disconnect', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0]!.simulateOpen();
    expect(wsStore.wsIsConnected()).toBe(true);
    wsStore.wsDisconnect();
    expect(wsStore.wsIsConnected()).toBe(false);
  });

  it('wsClearRun removes accumulated run state', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0]!.simulateOpen();
    const step = { id: 'stp_1', runId: 'run_clear', idx: 0, kind: 'navigate',
      description: 'go home', status: 'ok', createdAt: '2023-11-14T22:13:20.000Z' };
    MockWebSocket.instances[0]!.simulateMessage({
      channel: 'run:run_clear', type: 'step.created', payload: step,
    });
    expect(wsStore.wsRunSteps['run_clear']).toBeDefined();
    wsStore.wsClearRun('run_clear');
    expect(wsStore.wsRunSteps['run_clear']).toBeUndefined();
  });

  it('run.completed updates wsRunStatus', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0]!.simulateOpen();
    MockWebSocket.instances[0]!.simulateMessage({
      channel: 'run:run_xyz',
      type: 'run.completed',
      payload: { id: 'run_xyz', status: 'passed', verdict: 'goal_achieved' },
    });
    expect(wsStore.wsRunStatus['run_xyz']).toEqual({ id: 'run_xyz', status: 'passed', verdict: 'goal_achieved' });
  });

  it('finding.created appears in wsEvents but not in wsRunSteps or wsRunStatus', () => {
    wsStore.wsConnect();
    MockWebSocket.instances[0]!.simulateOpen();
    MockWebSocket.instances[0]!.simulateMessage({
      channel: 'run:run_xyz',
      type: 'finding.created',
      payload: { runId: 'run_xyz', id: 'fnd_1', title: 'Bug found' },
    });
    const lastEvt = wsStore.wsEvents[wsStore.wsEvents.length - 1]!;
    expect(lastEvt.type).toBe('finding.created');
    expect(wsStore.wsRunSteps['run_xyz']).toBeUndefined();
    expect(wsStore.wsRunStatus['run_xyz']).toBeUndefined();
  });

  it('reconnect: auto-reconnects after onclose with timer', async () => {
    vi.useFakeTimers();
    try {
      wsStore.wsConnect();
      MockWebSocket.instances[0]!.simulateOpen();
      // Simulate server close (not via wsDisconnect)
      const sock = MockWebSocket.instances[0]!;
      sock.readyState = MockWebSocket.CLOSED;
      sock.onclose?.(new Event('close'));
      // Now backoff timer is pending, no new socket yet
      expect(MockWebSocket.instances).toHaveLength(1);
      // Advance timers to trigger reconnect
      await vi.runAllTimersAsync();
      expect(MockWebSocket.instances).toHaveLength(2);
    } finally {
      wsStore.wsDisconnect();
      vi.useRealTimers();
    }
  });

  it('wsDisconnect during backoff cancels reconnect', async () => {
    vi.useFakeTimers();
    try {
      wsStore.wsConnect();
      MockWebSocket.instances[0]!.simulateOpen();
      const sock = MockWebSocket.instances[0]!;
      sock.readyState = MockWebSocket.CLOSED;
      sock.onclose?.(new Event('close'));
      // Disconnect during backoff
      wsStore.wsDisconnect();
      // Advance timers — no new socket should be created
      await vi.runAllTimersAsync();
      expect(MockWebSocket.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('wsConnect during backoff opens only one socket', async () => {
    vi.useFakeTimers();
    try {
      wsStore.wsConnect();
      MockWebSocket.instances[0]!.simulateOpen();
      const sock = MockWebSocket.instances[0]!;
      sock.readyState = MockWebSocket.CLOSED;
      sock.onclose?.(new Event('close'));
      // Manually call wsConnect during backoff window (FIX A)
      wsStore.wsConnect();
      expect(MockWebSocket.instances).toHaveLength(2);
      // Advance timers — timer was cancelled so no third socket
      await vi.runAllTimersAsync();
      expect(MockWebSocket.instances).toHaveLength(2);
    } finally {
      wsStore.wsDisconnect();
      vi.useRealTimers();
    }
  });
});
