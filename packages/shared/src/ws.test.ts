import { describe, it, expect } from 'vitest';
import {
  WsSubscribeMessageSchema,
  WsServerEventSchema,
  WsChannelSchema,
} from './ws.js';

describe('WsChannelSchema', () => {
  it('accepts "global"', () => {
    expect(WsChannelSchema.safeParse('global').success).toBe(true);
  });

  it('accepts "run:<runId>" pattern', () => {
    expect(WsChannelSchema.safeParse('run:run_abcdefghijkl').success).toBe(true);
  });

  it('rejects random string not matching pattern', () => {
    expect(WsChannelSchema.safeParse('project:prj_abc').success).toBe(false);
  });
});

describe('WsSubscribeMessageSchema', () => {
  it('accepts subscribe to global', () => {
    const msg = { type: 'subscribe', channel: 'global' };
    expect(WsSubscribeMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('accepts subscribe to run channel', () => {
    const msg = { type: 'subscribe', channel: 'run:run_abcdefghijkl' };
    expect(WsSubscribeMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('rejects missing channel', () => {
    expect(WsSubscribeMessageSchema.safeParse({ type: 'subscribe' }).success).toBe(false);
  });

  it('rejects missing type', () => {
    expect(WsSubscribeMessageSchema.safeParse({ channel: 'global' }).success).toBe(false);
  });
});

describe('WsServerEventSchema', () => {
  const base = { channel: 'global', payload: {} };

  it('accepts run.created event', () => {
    expect(WsServerEventSchema.safeParse({ ...base, type: 'run.created' }).success).toBe(true);
  });

  it('accepts run.updated event', () => {
    expect(WsServerEventSchema.safeParse({ ...base, type: 'run.updated' }).success).toBe(true);
  });

  it('accepts step.created event', () => {
    expect(WsServerEventSchema.safeParse({ ...base, type: 'step.created' }).success).toBe(true);
  });

  it('accepts finding.created event', () => {
    expect(WsServerEventSchema.safeParse({ ...base, type: 'finding.created' }).success).toBe(true);
  });

  it('accepts log.event event', () => {
    expect(WsServerEventSchema.safeParse({ ...base, type: 'log.event' }).success).toBe(true);
  });

  it('accepts run.completed event', () => {
    expect(WsServerEventSchema.safeParse({ ...base, type: 'run.completed' }).success).toBe(true);
  });

  it('rejects unknown event type', () => {
    expect(WsServerEventSchema.safeParse({ ...base, type: 'run.deleted' }).success).toBe(false);
  });

  it('rejects missing payload', () => {
    expect(WsServerEventSchema.safeParse({ channel: 'global', type: 'run.created' }).success).toBe(false);
  });

  it('rejects invalid channel in server event', () => {
    expect(WsServerEventSchema.safeParse({ channel: 'invalid', type: 'run.created', payload: {} }).success).toBe(false);
  });
});
