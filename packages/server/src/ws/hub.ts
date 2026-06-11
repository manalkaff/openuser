import type { WSContext } from 'hono/ws';

export type WsEventType =
  | 'run.created'
  | 'run.updated'
  | 'step.created'
  | 'finding.created'
  | 'log.event'
  | 'run.completed';

export interface WsEvent {
  channel: string;
  type: WsEventType;
  payload: unknown;
}

export class WsHub {
  private connections = new Map<WSContext, Set<string>>();

  addConnection(ws: WSContext): void {
    this.connections.set(ws, new Set());
  }

  removeConnection(ws: WSContext): void {
    this.connections.delete(ws);
  }

  handleMessage(ws: WSContext, raw: string): void {
    try {
      const msg = JSON.parse(raw) as unknown;
      if (
        typeof msg === 'object' &&
        msg !== null &&
        'type' in msg &&
        (msg as { type: unknown }).type === 'subscribe' &&
        'channel' in msg
      ) {
        const channel = (msg as { channel: unknown }).channel;
        if (typeof channel === 'string') {
          const subs = this.connections.get(ws);
          subs?.add(channel);
        }
      }
    } catch {
      // ignore malformed
    }
  }

  broadcast(channel: string, type: WsEventType, payload: unknown): void {
    const event: WsEvent = { channel, type, payload };
    const json = JSON.stringify(event);
    for (const [ws, subs] of this.connections) {
      if (subs.has(channel) || subs.has('global')) {
        try {
          ws.send(json);
        } catch {
          // ignore closed sockets
        }
      }
    }
  }

  broadcastRun(runId: string, type: WsEventType, payload: unknown): void {
    this.broadcast(`run:${runId}`, type, payload);
    this.broadcast('global', type, payload);
  }
}
