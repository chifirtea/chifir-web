import { describe, expect, it } from "vitest";
import { createRateLimiter, rateLimitKeyFor } from "./rateLimit";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createRateLimiter", () => {
  it("allows a burst of 5 then refuses with a retry hint", () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now });
    for (let i = 0; i < 5; i++) expect(rl.consume("k").ok).toBe(true);
    const denied = rl.consume("k");
    expect(denied.ok).toBe(false);
    expect(denied.remaining).toBe(0);
    // 20 per 10 min = one token every 30 s.
    expect(denied.retryAfterSeconds).toBe(30);
  });

  it("refills one token per 30 seconds and caps at the burst", () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now });
    for (let i = 0; i < 5; i++) rl.consume("k");
    c.advance(29_000);
    expect(rl.consume("k").ok).toBe(false);
    c.advance(1_000);
    expect(rl.consume("k").ok).toBe(true);
    expect(rl.consume("k").ok).toBe(false);
    c.advance(60 * 60_000);
    for (let i = 0; i < 5; i++) expect(rl.consume("k").ok).toBe(true);
    expect(rl.consume("k").ok).toBe(false);
  });

  it("sustains about 20 requests per 10 minutes after the burst", () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now });
    let accepted = 0;
    for (let s = 0; s <= 600; s++) {
      if (rl.consume("k").ok) accepted++;
      c.advance(1_000);
    }
    // 5 from the burst, then one every 30 s once the bucket is empty (t = 4 s): 5 + floor(596 / 30) = 24.
    expect(accepted).toBe(24);
  });

  it("keeps keys independent and sweeps idle buckets", () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now, sweepEvery: 4 });
    expect(rl.consume("a").ok).toBe(true);
    expect(rl.consume("b").ok).toBe(true);
    expect(rl.size()).toBe(2);
    c.advance(10 * 60_000);
    rl.consume("c");
    rl.consume("c");
    expect(rl.size()).toBe(1);
    for (let i = 0; i < 5; i++) rl.consume("a");
    expect(rl.consume("a").ok).toBe(false);
    expect(rl.consume("b").ok).toBe(true);
  });
});

describe("rateLimitKeyFor", () => {
  const req = (headers: Record<string, string>) => new Request("http://x/api/ai/concierge", { method: "POST", headers });

  it("prefers the user id, then the session cookie, then the ip", () => {
    const headers = { cookie: "a=1; chifir.sid=abc-123", "x-forwarded-for": "203.0.113.5, 10.0.0.1" };
    expect(rateLimitKeyFor(req(headers), "u1")).toBe("user:u1");
    expect(rateLimitKeyFor(req(headers), null)).toBe("sid:abc-123");
    expect(rateLimitKeyFor(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("ip:203.0.113.5");
    expect(rateLimitKeyFor(req({ "x-real-ip": "198.51.100.7" }))).toBe("ip:198.51.100.7");
    expect(rateLimitKeyFor(req({}))).toBe("anon");
  });
});
