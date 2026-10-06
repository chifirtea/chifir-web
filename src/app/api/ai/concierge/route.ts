import { features } from "@/lib/env.server";
import { getCurrentUser } from "@/lib/auth/session";
import { runConcierge } from "@/lib/ai/concierge";
import { requestNow } from "@/lib/time/serverClock";
import { aiRateLimiter, rateLimitKeyFor } from "@/lib/ai/rateLimit";
import { sseResponse } from "@/lib/ai/sse";
import { chatRequestSchema } from "@/lib/validation/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

const json = (status: number, body: unknown, headers?: HeadersInit) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...(headers ?? {}) } });

/** POST /api/ai/concierge -> SSE stream of ChatStreamEvent. Errors before the stream opens are plain JSON. */
export async function POST(request: Request): Promise<Response> {
  if (!features.ai) {
    return json(503, { type: "error", code: "unavailable", message: "The concierge is off duty right now." });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { type: "error", code: "bad_request", message: "That message could not be read. Try again." });
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, { type: "error", code: "bad_request", message: "That message could not be sent. Keep it under 2,000 characters and try again." });
  }
  const user = await getCurrentUser();
  const limit = aiRateLimiter.consume(rateLimitKeyFor(request, user?.id));
  if (!limit.ok) {
    return json(
      429,
      { type: "error", code: "rate_limited", message: `You're moving fast. Give it ${limit.retryAfterSeconds} seconds and try again.` },
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }
  return sseResponse((emit, signal) => runConcierge({ request: parsed.data, user, emit, signal, now: requestNow(request) }), { signal: request.signal });
}
