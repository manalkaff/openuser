import type { Step, Finding, LogEvent } from '@openuser/shared';

// ── Types ────────────────────────────────────────────────────────────────────

export type WsEventType =
  | 'run.created'
  | 'run.updated'
  | 'step.created'
  | 'finding.created'
  | 'log.event'
  | 'run.completed';

export type WsEvent = {
  channel: string;
  type: WsEventType;
  payload: unknown;
};

export type RunStatusUpdate = {
  id: string;
  status: string;
  verdict?: string | null;
};

// ── Rune-based reactive state ─────────────────────────────────────────────────
// Svelte 5: exported $state bindings cannot be reassigned.
// Pattern: use a single reactive container object; mutate its properties in place.

const _ws = $state({
  events: [] as WsEvent[],
  runSteps: {} as Record<string, Step[]>,
  runLogEvents: {} as Record<string, LogEvent[]>,
  runStatus: {} as Record<string, RunStatusUpdate>,
  connected: false,
});

/**
 * All websocket events received (reactive — use in Svelte components as `wsEvents`).
 * In tests, access directly: `wsEvents.length`, `wsEvents[0]`, etc.
 */
export const wsEvents: WsEvent[] = _ws.events;

/**
 * Per-run accumulated Step array. Access as `wsRunSteps[runId]`.
 */
export const wsRunSteps: Record<string, Step[]> = _ws.runSteps;

/**
 * Per-run accumulated LogEvent array. Access as `wsRunLogEvents[runId]`.
 */
export const wsRunLogEvents: Record<string, LogEvent[]> = _ws.runLogEvents;

/**
 * Per-run status snapshots (last run.updated / run.completed payload).
 */
export const wsRunStatus: Record<string, RunStatusUpdate> = _ws.runStatus;

/**
 * Whether the WebSocket is currently connected.
 */
export const wsState: { connected: boolean } = _ws;

// ── Internal state (not reactive) ────────────────────────────────────────────

let socket: WebSocket | null = null;
let pendingSubscriptions: string[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;

// ── Internal helpers ─────────────────────────────────────────────────────────

function sendSubscribe(channel: string) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'subscribe', channel }));
  } else {
    pendingSubscriptions.push(channel);
  }
}

function handleMessage(raw: string) {
  let evt: WsEvent;
  try {
    evt = JSON.parse(raw) as WsEvent;
  } catch {
    return;
  }

  _ws.events.push(evt);

  const payload = evt.payload as Record<string, unknown>;
  const runId =
    (payload?.runId as string | undefined) ??
    (payload?.id as string | undefined);

  if (evt.type === 'step.created' && runId) {
    const step = payload as unknown as Step;
    if (!_ws.runSteps[runId]) {
      _ws.runSteps[runId] = [];
    }
    _ws.runSteps[runId].push(step);
  }

  if (evt.type === 'log.event' && runId) {
    const logEvt = payload as unknown as LogEvent;
    if (!_ws.runLogEvents[runId]) {
      _ws.runLogEvents[runId] = [];
    }
    _ws.runLogEvents[runId].push(logEvt);
  }

  if ((evt.type === 'run.updated' || evt.type === 'run.completed') && runId) {
    _ws.runStatus[runId] = payload as RunStatusUpdate;
  }

  if (evt.type === 'finding.created' && runId) {
    // finding.created is surfaced via wsEvents; pages can filter by runId
  }
}

function openSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws`;
  socket = new WebSocket(url);

  socket.onopen = () => {
    _ws.connected = true;
    reconnectDelay = 1000;
    // flush pending subscriptions
    const pending = pendingSubscriptions.splice(0);
    for (const ch of pending) {
      socket!.send(JSON.stringify({ type: 'subscribe', channel: ch }));
    }
  };

  socket.onmessage = (event: MessageEvent) => {
    handleMessage(event.data as string);
  };

  socket.onclose = () => {
    _ws.connected = false;
    socket = null;
    // auto-reconnect with exponential backoff
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      openSocket();
    }, reconnectDelay);
  };

  socket.onerror = () => {
    // onclose fires after onerror; reconnect handled there
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function wsConnect() {
  if (socket) return; // already connected
  openSocket();
}

export function wsDisconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
  _ws.connected = false;
}

export function wsSubscribe(channel: string) {
  sendSubscribe(channel);
}

/** Reset all accumulated state for a run — call when leaving a run page. */
export function wsClearRun(runId: string) {
  delete _ws.runSteps[runId];
  delete _ws.runLogEvents[runId];
  delete _ws.runStatus[runId];
}
