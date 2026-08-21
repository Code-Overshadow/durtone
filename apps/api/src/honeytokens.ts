import { z } from 'zod';

const callbackSchema = z.object({
  token: z.string().min(1).max(4096),
  source: z.string().max(512).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type HoneytokenEvent = z.infer<typeof callbackSchema> & { receivedAt: string };

const events: HoneytokenEvent[] = [];

export function recordHoneytokenCallback(payload: unknown) {
  const event = { ...callbackSchema.parse(payload), receivedAt: new Date().toISOString() };
  events.push(event);
  if (events.length > 1000) events.shift();
  return event;
}

export function listHoneytokenCallbacks() {
  return [...events].reverse();
}