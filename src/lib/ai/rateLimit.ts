/**
 * In-process token bucket for the AI routes.
 *
 * Per key: a burst of `burst` requests, then a sustained `requests` per `windowMs`
 * (defaults: burst 5, 20 requests / 10 minutes -> one token every 30 s).
 *
 * MVP caveat: state lives in this process only. On a multi-instance deployment each instance
 * enforces its own bucket, so the effective limit is `instances x`. Move the bucket to Upstash /
 * Postgres before scaling out (the `RateLimiter` interface stays the same).
 */

export interface RateLimitDecision {
  ok: boolean;
  /** Seconds until the next request would be accepted (0 when `ok`). */
  retryAfterSeconds: number;
  /** Whole tokens left after this decision. */
  remaining: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitDecision;
  /** Number of tracked keys (diagnostics/tests). */
  size(): number;
}

export interface RateLimiterOptions {
  burst?: number;
  requests?: number;
  windowMs?: number;
  /** Injectable clock (ms since epoch). */
  now?: () => number;
  /** Stale buckets are swept every this many calls. */
  sweepEvery?: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const capacity = options.burst ?? 5;
  const refillPerMs = (options.requests ?? 20) / (options.windowMs ?? 10 * 60_000);
  const now = options.now ?? Date.now;
  const sweepEvery = options.sweepEvery ?? 256;
  const fullAfterMs = capacity / refillPerMs;
  const buckets = new Map<string, Bucket>();
  let calls = 0;

  const refill = (bucket: Bucket, at: number) => {
    const elapsed = Math.max(0, at - bucket.updatedAt);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
    bucket.updatedAt = at;
  };

  const sweep = (at: number) => {
    for (const [key, bucket] of buckets) {
      if (at - bucket.updatedAt >= fullAfterMs) buckets.delete(key);
    }
  };

  return {
    consume(key) {
      const at = now();
      if (++calls % sweepEvery === 0) sweep(at);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: capacity, updatedAt: at };
        buckets.set(key, bucket);
      } else {
        refill(bucket, at);
      }
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { ok: true, retryAfterSeconds: 0, remaining: Math.floor(bucket.tokens) };
      }
      const deficitMs = (1 - bucket.tokens) / refillPerMs;
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(deficitMs / 1000)), remaining: 0 };
    },
    size: () => buckets.size,
  };
}

/** Shared limiter for both AI routes. */
export const aiRateLimiter: RateLimiter = createRateLimiter();

/** Session cookie the client may set; falls back to the network address. */
export const SESSION_COOKIE = "chifir.sid";

/**
 * Bucket key precedence: signed-in user id, then the session cookie, then the client IP.
 * Headers are attacker-controlled, so the IP is only a last resort against casual abuse.
 */
export function rateLimitKeyFor(request: Request, userId?: string | null): string {
  if (userId) return `user:${userId}`;
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]{1,128})`));
  if (match?.[1]) return `sid:${decodeURIComponent(match[1])}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim();
  return ip ? `ip:${ip}` : "anon";
}
