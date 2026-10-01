import { clockHeaders } from "@/lib/time/clientClock";
import type { Address, CartLine, FulfillmentSelection, OrderContact } from "@/types/domain";
import { flush, getAnonymousId, getSessionId, track } from "@/lib/analytics/client";
import type { CartTotals } from "@/features/cart/pricing";
import type {
  CheckoutProblem,
  CheckoutResponse,
  CommerceErrorResponse,
} from "@/lib/commerce/types";

export interface StartCheckoutInput {
  lines: CartLine[];
  fulfillment: FulfillmentSelection;
  contact: OrderContact;
  deliveryAddress?: Address;
  promoCode?: string;
  /** The client preview, used only for the analytics event. The server re-prices everything. */
  totals: CartTotals;
}

export type StartCheckoutResult =
  | { ok: true; url: string; orderId: string; demo: boolean; free: boolean }
  | { ok: false; status: number; error: string; problems?: CheckoutProblem[] };

const ANALYTICS_ID = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Posts the cart to `/api/checkout` (ids and quantities only; never prices), records
 * `checkout_initiated`, clears the cart and sends the browser to the payment page.
 * Returns instead of throwing so the sheet can show the exact problem.
 */
export async function startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
  const merchantsInCart = new Set(input.lines.map((l) => l.merchantId));
  const sessionId = getSessionId();
  const anonymousId = getAnonymousId();
  const body = {
    lines: input.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      variantSelection: l.variantSelection,
      ...(l.notes ? { notes: l.notes } : {}),
    })),
    fulfillment: Object.entries(input.fulfillment)
      .filter(([merchantId]) => merchantsInCart.has(merchantId))
      .map(([merchantId, type]) => ({ merchantId, type })),
    contact: {
      email: input.contact.email.trim(),
      ...(input.contact.name?.trim() ? { name: input.contact.name.trim() } : {}),
      ...(input.contact.phone?.trim() ? { phone: input.contact.phone.trim() } : {}),
    },
    ...(input.deliveryAddress ? { deliveryAddress: input.deliveryAddress } : {}),
    ...(input.promoCode?.trim() ? { promoCode: input.promoCode.trim() } : {}),
    ...(ANALYTICS_ID.test(sessionId) && ANALYTICS_ID.test(anonymousId)
      ? { analytics: { sessionId, anonymousId } }
      : {}),
  };

  let res: Response;
  try {
    res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", ...clockHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: "You appear to be offline. Check your connection and try again.",
    };
  }

  const data = (await res.json().catch(() => null)) as
    (CheckoutResponse & Partial<CommerceErrorResponse>) | null;
  if (!res.ok || !data?.url) {
    const error =
      res.status === 503
        ? "Checkout is not set up in this build."
        : (data?.error ??
          (res.status >= 500
            ? "Something went wrong on our side. Please try again."
            : "Could not start checkout."));
    return {
      ok: false,
      status: res.status,
      error,
      ...(data?.problems ? { problems: data.problems } : {}),
    };
  }

  track("checkout_initiated", {
    totalCents: input.totals.totalCents,
    lines: input.lines.length,
    merchants: merchantsInCart.size,
    provider: data.demo ? "demo" : "stripe",
  });
  flush(true);
  // The cart is kept until the order is actually paid (see OrderStatus), so a cancelled
  // checkout leaves everything in place.
  window.location.assign(data.url);
  return {
    ok: true,
    url: data.url,
    orderId: data.orderId,
    demo: Boolean(data.demo),
    free: Boolean(data.free),
  };
}
