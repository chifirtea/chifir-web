import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDataSource } from "@/lib/data";
import { analyticsBatchSchema } from "@/lib/validation/analytics";
import type { AnalyticsRecord } from "@/lib/analytics/events";

export const runtime = "nodejs";

/** Bodies above this are rejected before parsing (a batch is at most 100 small records). */
const MAX_BODY_BYTES = 200 * 1024;

const empty = (status: number) => new Response(null, { status });

/**
 * First-party analytics ingestion. Accepts `fetch` and `navigator.sendBeacon` bodies (the
 * content-type may be text/plain), validates with zod, stamps the user id from the session
 * (never from the body) and stores the batch. Analytics must never break the product:
 * invalid input is a 400, storage failures are logged and answered with 202.
 */
export async function POST(request: NextRequest) {
  try {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return empty(413);

    let text: string;
    try {
      text = await request.text();
    } catch {
      return empty(400);
    }
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return empty(413);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return empty(400);
    }

    const parsed = analyticsBatchSchema.safeParse(json);
    if (!parsed.success) return empty(400);

    const user = await getCurrentUser().catch(() => null);

    const records: AnalyticsRecord[] = parsed.data.records.map((r) => ({
      name: r.name,
      props: r.props as AnalyticsRecord["props"],
      ts: r.ts,
      sessionId: r.sessionId,
      anonymousId: r.anonymousId,
      ...(user ? { userId: user.id } : {}),
      ...(r.device ? { device: r.device } : {}),
    }));

    try {
      await getDataSource().recordAnalytics(records);
    } catch (error) {
      console.error("[analytics] storage failed", error);
      return empty(202);
    }
    return empty(204);
  } catch (error) {
    console.error("[analytics] unexpected failure", error);
    return empty(202);
  }
}
