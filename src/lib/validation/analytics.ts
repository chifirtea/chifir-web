import { z } from "zod";
import { ANALYTICS_EVENT_NAMES, type AnalyticsEventName } from "@/lib/analytics/events";

/** Events the browser may report. Server-authoritative events are excluded. */
const SERVER_ONLY_EVENTS: ReadonlySet<AnalyticsEventName> = new Set(["purchase_completed"]);

export const CLIENT_EVENT_NAMES = ANALYTICS_EVENT_NAMES.filter((n) => !SERVER_ONLY_EVENTS.has(n)) as [
  AnalyticsEventName,
  ...AnalyticsEventName[],
];

const ID = z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/);
const MAX_PROPS_JSON = 4096;
const TS_WINDOW_MS = 24 * 60 * 60 * 1000;

export const analyticsBatchSchema = z.object({
  records: z
    .array(
      z.object({
        name: z.enum(CLIENT_EVENT_NAMES),
        props: z
          .record(z.string().max(64), z.unknown())
          .default({})
          .refine((p) => JSON.stringify(p).length <= MAX_PROPS_JSON, { message: "props too large" }),
        ts: z
          .number()
          .int()
          .positive()
          .refine((t) => Math.abs(Date.now() - t) <= TS_WINDOW_MS, { message: "timestamp out of window" }),
        sessionId: ID,
        anonymousId: ID,
        device: z
          .object({
            mobile: z.boolean(),
            tier: z.enum(["low", "medium", "high"]).optional(),
            gpu: z.string().max(200).optional(),
            ua: z.string().max(300).optional(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(100),
});

export type AnalyticsBatchInput = z.infer<typeof analyticsBatchSchema>;
