"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Sparkles } from "lucide-react";
import type {
  DigitalReward,
  FulfillmentStatus,
  FulfillmentType,
  OrderFulfillment,
  OrderItem,
} from "@/types/domain";
import { Badge, Button, ProductImage } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { formatCents } from "@/lib/utils/money";
import { useUser } from "@/features/auth/useUser";
import { authPath } from "@/features/auth/nextPath";
import { useCartStore } from "@/features/cart/cartStore";
import type { ClaimResponse, OrderResponse, PublicOrder } from "@/lib/commerce/types";

export interface OrderStatusProps {
  initialOrder: PublicOrder;
  /** Guest access token from the URL; sent back on every poll. */
  token?: string | undefined;
  /** Stripe `session_id` from the success URL: triggers one webhook-less sync. */
  sessionId?: string | undefined;
  rewards: Record<string, DigitalReward>;
  offerTitles: Record<string, string>;
  /** Server-known user id, so the first paint agrees with the session cookie. */
  initialUserId?: string | undefined;
}

const POLL_FAST_MS = 5_000;
const POLL_SLOW_MS = 15_000;
const POLL_SLOW_AFTER_MS = 120_000;
const POLL_GIVE_UP_MS = 30 * 60_000;
const TERMINAL: ReadonlySet<FulfillmentStatus> = new Set(["delivered", "cancelled", "failed"]);
const PAID: ReadonlySet<PublicOrder["status"]> = new Set(["paid", "in_fulfillment", "completed"]);

function shouldPoll(order: PublicOrder): boolean {
  if (order.status === "pending_payment") return true;
  if (!PAID.has(order.status) || order.status === "completed") return false;
  return order.fulfillments.length === 0 || order.fulfillments.some((f) => !TERMINAL.has(f.status));
}

interface Step {
  status: FulfillmentStatus;
  label: string;
}
const COMMON: Step[] = [
  { status: "pending", label: "Placed" },
  { status: "accepted", label: "Accepted" },
];
const STEPS: Record<FulfillmentType, Step[]> = {
  delivery: [
    ...COMMON,
    { status: "preparing", label: "Preparing" },
    { status: "out_for_delivery", label: "Out for delivery" },
    { status: "delivered", label: "Delivered" },
  ],
  pickup: [
    ...COMMON,
    { status: "preparing", label: "Preparing" },
    { status: "ready", label: "Ready for pickup" },
    { status: "delivered", label: "Picked up" },
  ],
  booking: [
    ...COMMON,
    { status: "preparing", label: "Preparing" },
    { status: "ready", label: "Ready" },
    { status: "delivered", label: "Done" },
  ],
  shipping: [
    ...COMMON,
    { status: "preparing", label: "Packing" },
    { status: "shipped", label: "Shipped" },
    { status: "delivered", label: "Delivered" },
  ],
  ticket: [
    { status: "pending", label: "Placed" },
    { status: "accepted", label: "Confirmed" },
    { status: "delivered", label: "Tickets issued" },
  ],
  digital: [
    { status: "pending", label: "Placed" },
    { status: "accepted", label: "Confirmed" },
    { status: "delivered", label: "Delivered to your account" },
  ],
  lead: [
    { status: "pending", label: "Placed" },
    { status: "accepted", label: "Received" },
    { status: "delivered", label: "Sent to the merchant" },
  ],
};
const TYPE_NAME: Record<FulfillmentType, string> = {
  delivery: "Delivery",
  pickup: "Pickup",
  shipping: "Shipping",
  booking: "Booking",
  ticket: "Tickets",
  digital: "Digital",
  lead: "Inquiry",
};

function headline(order: PublicOrder): { title: string; subtitle: string } {
  const merchants = [
    ...new Set(order.fulfillments.map((f) => f.merchantNameSnapshot).filter(Boolean)),
  ];
  const where = merchants.length ? merchants.join(" and ") : "the city";
  switch (order.status) {
    case "pending_payment":
      return { title: "Order placed", subtitle: "Confirming your payment…" };
    case "paid":
      return { title: "Paid", subtitle: `Handing your order to ${where}.` };
    case "in_fulfillment": {
      const delivered = order.fulfillments.filter((f) => f.status === "delivered").length;
      const total = order.fulfillments.length;
      return {
        title: "On its way",
        subtitle: total > 1 ? `${delivered} of ${total} parts delivered.` : `${where} is on it.`,
      };
    }
    case "completed":
      return {
        title: "Delivered",
        subtitle: "Everything has arrived. Thanks for shopping the city.",
      };
    case "cancelled":
      return {
        title: "Cancelled",
        subtitle: "This order was not paid and has been closed. Nothing was charged.",
      };
    case "payment_failed":
      return {
        title: "Payment failed",
        subtitle: "Nothing was charged. You can try again from your cart.",
      };
    case "refunded":
      return { title: "Refunded", subtitle: "This order was refunded." };
  }
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtEta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `today by ${fmtTime(iso)}`
    : `by ${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`;
}

export function OrderStatus({
  initialOrder,
  token,
  sessionId,
  rewards,
  offerTitles,
  initialUserId,
}: OrderStatusProps) {
  const [order, setOrder] = useState<PublicOrder>(initialOrder);

  // Once this order is paid, the cart it came from is done. Clear it exactly once per order so
  // items added later (e.g. "Order again") survive a revisit of this page.
  useEffect(() => {
    if (!PAID.has(order.status)) return;
    const key = `chifir.cart.cleared.${order.id}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // Private mode: fall through and clear anyway.
    }
    useCartStore.getState().clear();
  }, [order.id, order.status]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [claim, setClaim] = useState<"idle" | "claimed" | "failed">("idle");
  const { user } = useUser();
  const userId = user?.id ?? initialUserId;
  const mountedAt = useRef<number | null>(null);
  const router = useRouter();

  const base = `/api/orders/${encodeURIComponent(order.id)}`;
  const tokenQuery = token ? `?t=${encodeURIComponent(token)}` : "";

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${base}${tokenQuery}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as OrderResponse;
      setOrder(data.order);
      setFetchError(null);
    } catch {
      setFetchError("Live updates paused. We will keep trying.");
    }
  }, [base, tokenQuery]);

  // One-off: back from Stripe without a webhook (local dev), confirm payment directly.
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || !sessionId || initialOrder.status !== "pending_payment") return;
    synced.current = true;
    fetch(`${base}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(token ? { token } : {}),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as OrderResponse;
        setOrder(data.order);
      })
      .catch(() => {
        // The poll below picks it up.
      });
  }, [base, sessionId, token, initialOrder.status]);

  // Poll while anything is still moving: 5 s at first, 15 s after two minutes, stop after 30 min.
  const polling = shouldPoll(order);
  useEffect(() => {
    if (!polling) return;
    mountedAt.current ??= Date.now();
    const startedAt = mountedAt.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const age = Date.now() - startedAt;
      if (age > POLL_GIVE_UP_MS) return;
      await refresh();
      if (stopped) return;
      timer = setTimeout(tick, age > POLL_SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS);
    };
    timer = setTimeout(tick, POLL_FAST_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [polling, refresh]);

  // Signed in after buying as a guest: attach the order and grant its digital twins.
  const claimable = Boolean(userId && !order.userId && token);
  const claimStarted = useRef(false);
  useEffect(() => {
    if (!claimable || claimStarted.current) return;
    claimStarted.current = true;
    fetch(`${base}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = res.ok ? ((await res.json()) as ClaimResponse) : null;
        if (data?.claimed) {
          setOrder((o) => ({ ...o, userId }));
          setClaim("claimed");
        } else {
          setClaim("failed");
        }
      })
      .catch(() => setClaim("failed"));
  }, [base, claimable, token, userId]);
  const claiming = claimable && claim === "idle";

  const groups = useMemo(() => groupByMerchant(order), [order]);
  const rewardItems = order.items.filter((i) => i.digitalRewardId);
  const owned = Boolean(order.userId && userId && order.userId === userId);
  const { title, subtitle } = headline(order);
  const placed = new Date(order.placedAt);

  const orderAgain = () => {
    const cart = useCartStore.getState();
    for (const item of order.items) {
      if (!item.productId || !item.merchantId) continue;
      cart.addLine({
        productId: item.productId,
        merchantId: item.merchantId,
        quantity: item.quantity,
        variantSelection: item.variantSelection,
      });
    }
    const first = order.items.find((i) => i.merchantId)?.merchantId;
    router.push(first ? `/city?to=${encodeURIComponent(first)}` : "/city");
  };

  return (
    <div className="space-y-6">
      <header className="sign relative overflow-hidden p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">Order · {order.id.slice(-8).toUpperCase()}</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="mt-1 text-fog-2">{subtitle}</p>
            <p className="mt-2 text-xs text-fog-3">
              Placed {placed.toLocaleDateString([], { month: "short", day: "numeric" })} at{" "}
              {fmtTime(order.placedAt)} · receipt to {order.contact.email}
            </p>
          </div>
          <span className="stamp">Get it IRL</span>
        </div>
        {polling ? (
          <p className="mt-4 flex items-center gap-2 text-xs text-fog-3" aria-live="polite">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
            </span>
            Updating live{fetchError ? ` · ${fetchError}` : ""}
          </p>
        ) : null}
      </header>

      {groups.map((g) => (
        <MerchantCard key={g.key} group={g} currency={order.currency} />
      ))}

      {rewardItems.length ? (
        <section className="sign p-5" aria-labelledby="rewards-title">
          <h2
            id="rewards-title"
            className="font-display flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <Sparkles className="h-5 w-5 text-sky" aria-hidden="true" /> Digital twins
          </h2>
          <ul className="mt-3 space-y-2">
            {rewardItems.map((item) => {
              const reward = item.digitalRewardId ? rewards[item.digitalRewardId] : undefined;
              return (
                <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    <span className="text-fog-2">{item.titleSnapshot} comes with:</span>{" "}
                    <span className="font-medium">{reward?.name ?? "a digital twin"}</span>
                  </span>
                  {reward ? <Badge tone="sodium">{reward.rarity}</Badge> : null}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 text-sm">
            {!PAID.has(order.status) ? (
              <p className="text-fog-3">Twins unlock once the order is paid.</p>
            ) : owned || claim === "claimed" ? (
              <p className="flex items-center gap-1.5 text-mint">
                <Check className="h-4 w-4" aria-hidden="true" /> Added to your account
              </p>
            ) : claiming ? (
              <p className="text-fog-2">Adding to your account…</p>
            ) : userId ? (
              <p className="text-fog-2">
                {claim === "failed"
                  ? "We could not attach this order to your account. Refresh to try again."
                  : "Sign in with the account that placed this order to see its twins."}
              </p>
            ) : (
              <Link
                href={authPath("login", `/orders/${order.id}${tokenQuery}`)}
                className="inline-flex min-h-11 items-center rounded-xl border border-sky/40 bg-sky/10 px-4 font-medium text-sky hover:bg-sky/16"
              >
                Sign in to claim your digital twins
              </Link>
            )}
          </div>
        </section>
      ) : null}

      <section className="sign p-5" aria-label="Totals">
        <dl className="space-y-1.5 text-sm">
          <Row label="Subtotal" value={formatCents(order.subtotalCents, order.currency)} />
          {discountLines(order.items, offerTitles).map((d) => (
            <Row
              key={d.key}
              label={d.label}
              value={`-${formatCents(d.cents, order.currency)}`}
              tone="mint"
            />
          ))}
          {order.fulfillments
            .filter((f) => f.feeCents > 0)
            .map((f) => (
              <Row
                key={f.id}
                label={`${f.type === "shipping" ? "Shipping" : "Delivery fee"} · ${f.merchantNameSnapshot}`}
                value={formatCents(f.feeCents, order.currency)}
              />
            ))}
          {order.taxCents > 0 ? (
            <Row label="Tax" value={formatCents(order.taxCents, order.currency)} />
          ) : null}
          <Row label="Total" value={formatCents(order.totalCents, order.currency)} strong />
        </dl>
        {order.paidAt ? (
          <p className="mt-3 text-xs text-fog-3">
            Paid {fmtTime(order.paidAt)} via{" "}
            {order.paymentProvider === "demo" ? "simulated payment (no money moved)" : "Stripe"}.
          </p>
        ) : null}
      </section>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onClick={() => router.push("/city")}
        >
          Back to the city
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="flex-1"
          onClick={orderAgain}
          disabled={!order.items.some((i) => i.productId)}
        >
          Order again
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------ pieces

interface Group {
  key: string;
  merchantName: string;
  items: OrderItem[];
  fulfillment: OrderFulfillment | undefined;
}

function groupByMerchant(order: PublicOrder): Group[] {
  const map = new Map<string, Group>();
  for (const item of order.items) {
    const key = item.merchantId ?? item.merchantNameSnapshot;
    const g = map.get(key) ?? {
      key,
      merchantName: item.merchantNameSnapshot || "Merchant",
      items: [],
      fulfillment: order.fulfillments.find((f) =>
        item.merchantId
          ? f.merchantId === item.merchantId
          : f.merchantNameSnapshot === item.merchantNameSnapshot,
      ),
    };
    g.items.push(item);
    map.set(key, g);
  }
  return [...map.values()];
}

function discountLines(
  items: OrderItem[],
  offerTitles: Record<string, string>,
): Array<{ key: string; label: string; cents: number }> {
  const map = new Map<string, number>();
  for (const i of items) {
    if (i.discountCents <= 0) continue;
    const k = i.offerId ?? "other";
    map.set(k, (map.get(k) ?? 0) + i.discountCents);
  }
  return [...map.entries()].map(([key, cents]) => ({
    key,
    label: (key !== "other" && offerTitles[key]) || "Discount",
    cents,
  }));
}

function MerchantCard({ group, currency }: { group: Group; currency: PublicOrder["currency"] }) {
  const f = group.fulfillment;
  return (
    <section className="sign p-5" aria-label={`${group.merchantName} order`}>
      <header className="flex items-start justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">{group.merchantName}</h2>
        {f ? (
          <Badge
            tone={
              f.status === "delivered"
                ? "mint"
                : f.status === "cancelled" || f.status === "failed"
                  ? "danger"
                  : "neutral"
            }
          >
            {TYPE_NAME[f.type]}
          </Badge>
        ) : null}
      </header>

      <ul className="mt-3 divide-y divide-line">
        {group.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-2.5">
            <ProductImage
              src={item.imageUrlSnapshot}
              alt=""
              label={item.titleSnapshot}
              className="h-12 w-12 shrink-0 rounded-lg"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">
                {item.quantity > 1 ? `${item.quantity} × ` : ""}
                {item.titleSnapshot}
              </p>
              {item.variantLabel ? (
                <p className="truncate text-sm text-fog-3">{item.variantLabel}</p>
              ) : null}
            </div>
            <span className={cn("tabular shrink-0 text-sm", item.discountCents > 0 && "text-mint")}>
              {formatCents(item.unitPriceCents * item.quantity - item.discountCents, currency)}
            </span>
          </li>
        ))}
      </ul>

      {f ? (
        <Timeline fulfillment={f} />
      ) : (
        <p className="mt-3 text-sm text-fog-3">Fulfillment starts once payment is confirmed.</p>
      )}
    </section>
  );
}

function Timeline({ fulfillment: f }: { fulfillment: OrderFulfillment }) {
  const steps = STEPS[f.type];
  const failed = f.status === "cancelled" || f.status === "failed";
  const currentIndex = failed
    ? steps.findIndex(
        (s) =>
          s.status ===
          f.events.filter((e) => e.status !== "cancelled" && e.status !== "failed").at(-1)?.status,
      )
    : steps.findIndex((s) => s.status === f.status);
  const at = (status: FulfillmentStatus) => f.events.find((e) => e.status === status)?.at;
  const note = f.events.at(-1)?.note;

  return (
    <div className="mt-4">
      <ol className="relative space-y-3 border-l border-line pl-5">
        {steps.map((step, i) => {
          const done = i < currentIndex || (i === currentIndex && f.status === "delivered");
          const current = i === currentIndex && !done;
          const time = at(step.status);
          return (
            <li key={step.status} className="relative text-sm">
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-1 -left-[26px] flex h-3 w-3 items-center justify-center rounded-full border",
                  done
                    ? "border-mint bg-mint"
                    : current
                      ? "border-signal bg-signal shadow-glow-signal"
                      : "border-line bg-ink",
                )}
              />
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={cn(
                    done ? "text-fog" : current ? "font-medium text-fog" : "text-fog-3",
                  )}
                >
                  {step.label}
                </span>
                {time ? (
                  <span className="tabular shrink-0 text-xs text-fog-3">{fmtTime(time)}</span>
                ) : null}
              </div>
              {current && note ? <p className="mt-0.5 text-xs text-fog-2">{note}</p> : null}
            </li>
          );
        })}
        {failed ? (
          <li className="relative text-sm">
            <span
              aria-hidden="true"
              className="absolute top-1 -left-[26px] h-3 w-3 rounded-full border border-danger bg-danger"
            />
            <span className="text-danger">{f.status === "cancelled" ? "Cancelled" : "Failed"}</span>
          </li>
        ) : null}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {f.etaAt && !TERMINAL.has(f.status) ? (
          <p className="text-fog-2">Expected {fmtEta(f.etaAt)}</p>
        ) : null}
        {f.trackingUrl ? (
          <a
            href={f.trackingUrl}
            className="inline-flex min-h-11 items-center gap-1 text-sky underline-offset-4 hover:underline"
            target={f.trackingUrl.startsWith("/") ? undefined : "_blank"}
            rel="noreferrer"
          >
            Track shipment <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : null}
        {f.type === "delivery" && f.deliveryAddress ? (
          <p className="text-fog-3">
            To {f.deliveryAddress.line1}, {f.deliveryAddress.city}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: "mint";
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        tone === "mint" && "text-mint",
        strong && "border-t border-line pt-2 text-base font-semibold",
      )}
    >
      <dt className={cn("min-w-0 truncate", !strong && !tone && "text-fog-2")}>{label}</dt>
      <dd className="tabular shrink-0">{value}</dd>
    </div>
  );
}
