import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// Free-tier quota per unique IP, lifetime. After 10 they must BYOK to continue.
export const FREE_QUOTA = 10;

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

// Graceful degradation: if Upstash env vars are missing in dev or on first deploy,
// fall back to an in-memory Map. This will reset across Fluid Compute instances
// — acceptable for local dev, NOT acceptable for real production abuse protection.
// We surface the misconfig in the X-RateLimit-Backend response header so ops can see it.

const memCounts = new Map<string, number>();

let redis: Redis | null = null;
let limiter: Ratelimit | null = null;

if (hasUpstash) {
  redis = Redis.fromEnv();
  // Sliding window of 1 minute for burst protection — catches someone spinning
  // up 100 requests in 10 seconds. Separate from the lifetime 10-gen quota.
  limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '60 s'),
    prefix: 'noon:burst',
    analytics: false,
  });
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  remaining: number;
  backend: 'upstash' | 'memory';
  reason?: 'burst' | 'quota';
}

/**
 * Enforce both the burst limiter (5/min) and the lifetime free quota (10).
 * Returns current state. Does NOT increment unless `consume` is true.
 */
export async function checkQuota(ip: string, consume: boolean): Promise<QuotaResult> {
  const backend: 'upstash' | 'memory' = redis ? 'upstash' : 'memory';
  const key = `noon:usage:${ip}`;

  // 1) Burst check — only if Upstash is configured.
  if (limiter) {
    const burst = await limiter.limit(ip);
    if (!burst.success) {
      return { allowed: false, used: 0, remaining: 0, backend, reason: 'burst' };
    }
  }

  // 2) Lifetime quota check.
  let used = 0;
  if (redis) {
    if (consume) {
      used = await redis.incr(key);
    } else {
      const raw = await redis.get<number>(key);
      used = raw ?? 0;
    }
  } else {
    used = memCounts.get(key) ?? 0;
    if (consume) {
      used += 1;
      memCounts.set(key, used);
    }
  }

  const remaining = Math.max(0, FREE_QUOTA - used);
  const allowed = used <= FREE_QUOTA;
  return {
    allowed,
    used,
    remaining,
    backend,
    reason: allowed ? undefined : 'quota',
  };
}

export async function currentUsage(ip: string): Promise<Pick<QuotaResult, 'used' | 'remaining' | 'backend'>> {
  const result = await checkQuota(ip, false);
  return { used: result.used, remaining: result.remaining, backend: result.backend };
}
