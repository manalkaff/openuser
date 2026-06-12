import { ApiError } from './http-client.js';

export function mcpError(err: unknown): { content: { type: 'text'; text: string }[]; isError: true } {
  const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
  return { content: [{ type: 'text', text: msg }], isError: true };
}

export function ok(data: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
