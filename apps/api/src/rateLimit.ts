import Redis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';

const windowSeconds = Number(process.env.DURTONE_RATE_LIMIT_WINDOW_SECONDS ?? 60);
const maxRequests = Number(process.env.DURTONE_RATE_LIMIT_MAX ?? 120);
let localRedis: Redis | undefined;
let upstashRedis: UpstashRedis | undefined;

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    upstashRedis ??= UpstashRedis.fromEnv();
    return upstashRedis;
  }
  if (process.env.REDIS_URL) {
    localRedis ??= new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    return localRedis;
  }
  return undefined;
}

export async function allowRequest(key: string) {
  const redis = getRedis();
  if (!redis) {
    if (process.env.NODE_ENV === 'production') throw new Error('Redis is required in production');
    return true;
  }

  const bucket = `durtone:ratelimit:${windowSeconds}:${key}`;
  if (redis instanceof UpstashRedis) {
    const count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, windowSeconds);
    return count <= maxRequests;
  }

  if (redis.status === 'wait') await redis.connect();
  const count = await redis.incr(bucket);
  if (count === 1) await redis.expire(bucket, windowSeconds);
  return count <= maxRequests;
}

export async function closeRateLimit() {
  if (localRedis) await localRedis.quit();
  localRedis = undefined;
  upstashRedis = undefined;
}
