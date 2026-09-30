import type {
  FulfillmentEvent,
  FulfillmentStatus,
  FulfillmentType,
  Merchant,
  OrderFulfillment,
} from "@/types/domain";
import type { FulfillmentCreateInput, FulfillmentProvider } from "./provider";

/**
 * Demo timeline, in seconds after acceptance. Compressed so a purchase visibly progresses while
 * the buyer watches the order page; a real provider replaces this with webhook-driven status.
 */
interface Step {
  status: FulfillmentStatus;
  afterSeconds: number;
  note?: string;
}

const DELIVERY: Step[] = [
  { status: "preparing", afterSeconds: 60, note: "The kitchen has started on your order." },
  { status: "out_for_delivery", afterSeconds: 180, note: "Your courier has picked up the order." },
  { status: "delivered", afterSeconds: 360, note: "Handed over. Enjoy." },
];
const PICKUP: Step[] = [
  { status: "preparing", afterSeconds: 60, note: "Being prepared." },
  { status: "ready", afterSeconds: 180, note: "Ready at the counter." },
  { status: "delivered", afterSeconds: 360, note: "Picked up." },
];
const SHIPPING: Step[] = [
  { status: "preparing", afterSeconds: 60, note: "Being packed." },
  { status: "shipped", afterSeconds: 150, note: "Handed to the carrier." },
  { status: "delivered", afterSeconds: 420, note: "Delivered." },
];

const TIMELINES: Record<FulfillmentType, Step[]> = {
  delivery: DELIVERY,
  pickup: PICKUP,
  booking: PICKUP,
  shipping: SHIPPING,
  ticket: [],
  digital: [],
  lead: [],
};

/** Types that are fulfilled the moment payment lands. */
const IMMEDIATE: ReadonlySet<FulfillmentType> = new Set(["ticket", "digital", "lead"]);
const TERMINAL: ReadonlySet<FulfillmentStatus> = new Set(["delivered", "cancelled", "failed"]);

const MINUTE = 60_000;
const DAY = 86_400_000;

const DEFAULT_DELIVERY_MINUTES = 30;
const DEFAULT_PICKUP_MINUTES = 15;
const DEFAULT_SHIPPING_DAYS = 4;

/** Expected completion from the merchant's configured window (upper bound), or sane defaults. */
export function estimateEta(type: FulfillmentType, merchant: Merchant | null, now: Date): Date {
  const f = merchant?.fulfillment;
  switch (type) {
    case "delivery":
      return new Date(now.getTime() + (f?.delivery?.minutesMax ?? DEFAULT_DELIVERY_MINUTES) * MINUTE);
    case "pickup":
    case "booking":
      return new Date(now.getTime() + (f?.pickup?.minutesMax ?? DEFAULT_PICKUP_MINUTES) * MINUTE);
    case "shipping":
      return new Date(now.getTime() + (f?.shipping?.daysMax ?? DEFAULT_SHIPPING_DAYS) * DAY);
    case "ticket":
    case "digital":
    case "lead":
      return now;
  }
}

export class SimulatedProvider implements FulfillmentProvider {
  readonly id = "simulated" as const;

  async create(input: FulfillmentCreateInput, now: Date = new Date()): Promise<OrderFulfillment> {
    const { fulfillment, merchant } = input;
    const at = now.toISOString();
    const events: FulfillmentEvent[] = [
      { status: "pending", at },
      { status: "accepted", at, note: `${fulfillment.merchantNameSnapshot || "The merchant"} accepted your order.` },
    ];
    const externalId = `sim_${fulfillment.id}`;
    if (IMMEDIATE.has(fulfillment.type)) {
      events.push({ status: "delivered", at, note: immediateNote(fulfillment.type) });
      return { ...fulfillment, status: "delivered", externalId, etaAt: at, events };
    }
    return {
      ...fulfillment,
      status: "accepted",
      externalId,
      etaAt: estimateEta(fulfillment.type, merchant, now).toISOString(),
      events,
    };
  }

  async getStatus(fulfillment: OrderFulfillment, now: Date): Promise<OrderFulfillment> {
    if (TERMINAL.has(fulfillment.status)) return fulfillment;
    const timeline = TIMELINES[fulfillment.type];
    if (timeline.length === 0) return fulfillment;
    const accepted = fulfillment.events.find((e) => e.status === "accepted");
    if (!accepted) return fulfillment; // not handed to the provider yet
    const acceptedMs = Date.parse(accepted.at);
    if (Number.isNaN(acceptedMs)) return fulfillment;

    const elapsedSeconds = (now.getTime() - acceptedMs) / 1000;
    const have = new Set(fulfillment.events.map((e) => e.status));
    const reached = timeline.filter((s) => s.afterSeconds <= elapsedSeconds);
    const fresh = reached.filter((s) => !have.has(s.status));
    if (fresh.length === 0) return fulfillment;

    const events: FulfillmentEvent[] = [
      ...fulfillment.events,
      ...fresh.map((s) => ({
        status: s.status,
        at: new Date(acceptedMs + s.afterSeconds * 1000).toISOString(),
        ...(s.note ? { note: s.note } : {}),
      })),
    ];
    const status = reached[reached.length - 1]!.status;
    const shipped = fulfillment.type === "shipping" && reached.some((s) => s.status === "shipped");
    return {
      ...fulfillment,
      status,
      events,
      ...(shipped && !fulfillment.trackingUrl ? { trackingUrl: `/orders/${fulfillment.orderId}` } : {}),
    };
  }

  async cancel(fulfillment: OrderFulfillment, now: Date = new Date()): Promise<OrderFulfillment> {
    if (TERMINAL.has(fulfillment.status)) return fulfillment;
    return {
      ...fulfillment,
      status: "cancelled",
      events: [...fulfillment.events, { status: "cancelled", at: now.toISOString() }],
    };
  }
}

function immediateNote(type: FulfillmentType): string {
  switch (type) {
    case "ticket":
      return "Your tickets are on this page. Show them at the door.";
    case "digital":
      return "Delivered to your account.";
    default:
      return "Sent to the merchant.";
  }
}
