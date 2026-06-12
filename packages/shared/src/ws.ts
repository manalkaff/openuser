import { z } from 'zod';

/**
 * WS channel: "global" or "run:<runId>"
 * Contracts §7: Client → { type:'subscribe', channel: 'global' | 'run:<runId>' }
 */
export const WsChannelSchema = z.string().refine(
  (val) => val === 'global' || /^run:[a-zA-Z0-9_-]+$/.test(val),
  { message: 'channel must be "global" or "run:<runId>"' },
);
export type WsChannel = z.infer<typeof WsChannelSchema>;

/**
 * Client → server subscribe message.
 * Multiple subscriptions allowed per connection.
 */
export const WsSubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  channel: WsChannelSchema,
});
export type WsSubscribeMessage = z.infer<typeof WsSubscribeMessageSchema>;

/**
 * Server → client event types — contracts §7 exact list:
 * run.created | run.updated | step.created | finding.created | log.event | run.completed
 */
export const WsEventTypeSchema = z.enum([
  'run.created',
  'run.updated',
  'step.created',
  'finding.created',
  'log.event',
  'run.completed',
]);
export type WsEventType = z.infer<typeof WsEventTypeSchema>;

/**
 * Server → client event.
 * payload = the relevant row.
 * run.updated: on status change.
 * log.event: only error-level.
 * Everything sent on its run:<id> channel AND global.
 */
export const WsServerEventSchema = z.object({
  channel: WsChannelSchema,
  type: WsEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type WsServerEvent = z.infer<typeof WsServerEventSchema>;
