import { Redis } from '@upstash/redis';

export type DurtOneEvent = {
  id: string;
  type: 'waf.attack' | 'cspm.drift' | 'itdr.snapshot';
  tenantId?: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

type EventHandler = (event: DurtOneEvent) => void | Promise<void>;

const handlers = new Map<DurtOneEvent['type'], Set<EventHandler>>();
let redis: Redis | undefined;

function redisClient() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return undefined;
  redis ??= Redis.fromEnv();
  return redis;
}

export function onEvent(type: DurtOneEvent['type'], handler: EventHandler) {
  const listeners = handlers.get(type) ?? new Set<EventHandler>();
  listeners.add(handler);
  handlers.set(type, listeners);
  return () => listeners.delete(handler);
}

export async function publishEvent(input: Omit<DurtOneEvent, 'id' | 'occurredAt'> & Partial<Pick<DurtOneEvent, 'id' | 'occurredAt'>>) {
  const event: DurtOneEvent = {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
  const client = redisClient();
  if (client) await client.publish(`durtone:events:${event.type}`, event);
  await Promise.all([...handlers.get(event.type) ?? []].map((handler) => handler(event)));
  return event;
}

export function resetEventBus() {
  handlers.clear();
  redis = undefined;
}
