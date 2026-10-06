import type { CurrencyCode, FulfillmentType, Merchant } from "@/types/domain";
import { formatCents } from "@/lib/utils/money";
import { merchantFulfillment } from "./pricing";

const EN_DASH = "–";

function minutes(min?: number, max?: number): string | null {
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined && min !== max) return `${min}${EN_DASH}${max} min`;
  return `${max ?? min} min`;
}

function days(min?: number, max?: number): string | null {
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined && min !== max) return `${min}${EN_DASH}${max} days`;
  const d = max ?? min ?? 0;
  return `${d} ${d === 1 ? "day" : "days"}`;
}

function fee(cents: number, currency: CurrencyCode): string {
  return cents > 0 ? formatCents(cents, currency) : "free";
}

export interface FulfillmentOptionLabel {
  /** Short verb-ish name for a segmented control: "Delivery", "Pickup", "Ship". */
  name: string;
  /** "$3.99 · 25–40 min" */
  detail: string;
  /** name + detail joined with middots, as the cart shows it. */
  label: string;
}

/** "Delivery · $3.99 · 25–40 min" style labels for a merchant's fulfillment option. */
export function fulfillmentOptionLabel(
  merchant: Merchant | undefined,
  type: FulfillmentType,
  currency: CurrencyCode = "USD",
): FulfillmentOptionLabel {
  const f = merchant?.fulfillment;
  const { feeCents } = merchantFulfillment(merchant, type);
  const parts: string[] = [];
  let name: string;
  switch (type) {
    case "delivery": {
      name = "Delivery";
      parts.push(fee(feeCents, currency));
      const eta = minutes(f?.delivery?.minutesMin, f?.delivery?.minutesMax);
      if (eta) parts.push(eta);
      break;
    }
    case "pickup": {
      name = "Pickup";
      const eta = minutes(f?.pickup?.minutesMin, f?.pickup?.minutesMax);
      if (eta) parts.push(eta);
      break;
    }
    case "shipping": {
      name = "Ship";
      parts.push(fee(feeCents, currency));
      const eta = days(f?.shipping?.daysMin, f?.shipping?.daysMax);
      if (eta) parts.push(eta);
      break;
    }
    case "booking":
      name = "Book";
      if (f?.booking?.slotMinutes) parts.push(`${f.booking.slotMinutes}-min slot`);
      break;
    case "ticket":
      name = "Tickets";
      parts.push("sent right away");
      break;
    case "digital":
      name = "Digital";
      parts.push("delivered right away");
      break;
    case "lead":
      name = "Inquiry";
      break;
  }
  const detail = parts.join(" · ");
  return { name, detail, label: detail ? `${name} · ${detail}` : name };
}

/** Sentence form for product panels: "Delivery in 25–40 min · $3.99", "Ships in 3–5 days · free". */
export function fulfillmentEtaLine(
  merchant: Merchant | undefined,
  type: FulfillmentType,
  currency: CurrencyCode = "USD",
): string {
  const f = merchant?.fulfillment;
  const { feeCents } = merchantFulfillment(merchant, type);
  switch (type) {
    case "delivery": {
      const eta = minutes(f?.delivery?.minutesMin, f?.delivery?.minutesMax);
      return `${eta ? `Delivery in ${eta}` : "Delivery"} · ${fee(feeCents, currency)}`;
    }
    case "pickup": {
      const eta = minutes(f?.pickup?.minutesMin, f?.pickup?.minutesMax);
      return eta ? `Pickup in ${eta}` : "Pickup";
    }
    case "shipping": {
      const eta = days(f?.shipping?.daysMin, f?.shipping?.daysMax);
      return `${eta ? `Ships in ${eta}` : "Ships"} · ${fee(feeCents, currency)}`;
    }
    case "booking":
      return "Book a time";
    case "ticket":
      return "Tickets sent right away";
    case "digital":
      return "Delivered right away";
    case "lead":
      return "We pass your request to the merchant";
  }
}

/** Human name of the fee line for a fulfillment type. */
export function feeLineLabel(type: FulfillmentType | null): string {
  return type === "shipping" ? "Shipping" : "Delivery fee";
}
