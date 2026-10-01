import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { features } from "@/lib/env.server";
import { getDataSource } from "@/lib/data";
import { authorizeOrderAccess } from "@/lib/commerce/service";
import { orderIdSchema, orderTokenSchema } from "@/lib/commerce/validation";
import { formatCents } from "@/lib/utils/money";
import { DemoPayment } from "@/features/checkout/DemoPayment";

export const metadata: Metadata = { title: "Simulated payment — Chifir", robots: { index: false } };

/**
 * /checkout/demo?order=<id>&t=<token>
 * Stand-in for Stripe Checkout when COMMERCE_MODE=demo outside production. 404 everywhere else.
 */
export default async function DemoCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; t?: string }>;
}) {
  if (!features.demoPayments) notFound();
  const { order: orderId, t } = await searchParams;
  if (
    !orderId ||
    !t ||
    !orderIdSchema.safeParse(orderId).success ||
    !orderTokenSchema.safeParse(t).success
  )
    notFound();

  const order = await getDataSource().getOrder(orderId);
  if (!order || !authorizeOrderAccess(order, { token: t })) notFound();
  if (order.status !== "pending_payment") redirect(`/orders/${order.id}?t=${t}`);

  const merchants = [...new Set(order.fulfillments.map((f) => f.merchantNameSnapshot))];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <header>
        <p className="eyebrow mb-2">Checkout</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Almost yours</h1>
        <p className="mt-1 text-fog-2">
          {order.items.length} {order.items.length === 1 ? "item" : "items"} from{" "}
          {merchants.join(" and ") || "the city"}.
        </p>
      </header>

      <section className="sign p-5" aria-label="Order summary">
        <ul className="divide-y divide-line">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {item.quantity > 1 ? `${item.quantity} × ` : ""}
                  {item.titleSnapshot}
                </p>
                <p className="truncate text-fog-3">
                  {item.merchantNameSnapshot}
                  {item.variantLabel ? ` · ${item.variantLabel}` : ""}
                </p>
              </div>
              <span className="tabular shrink-0">
                {formatCents(
                  item.unitPriceCents * item.quantity - item.discountCents,
                  order.currency,
                )}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between text-fog-2">
            <dt>Subtotal</dt>
            <dd className="tabular">{formatCents(order.subtotalCents, order.currency)}</dd>
          </div>
          {order.discountCents > 0 ? (
            <div className="flex justify-between text-mint">
              <dt>Discounts</dt>
              <dd className="tabular">-{formatCents(order.discountCents, order.currency)}</dd>
            </div>
          ) : null}
          {order.fulfillments
            .filter((f) => f.feeCents > 0)
            .map((f) => (
              <div key={f.id} className="flex justify-between text-fog-2">
                <dt>
                  {f.type === "shipping" ? "Shipping" : "Delivery fee"} · {f.merchantNameSnapshot}
                </dt>
                <dd className="tabular">{formatCents(f.feeCents, order.currency)}</dd>
              </div>
            ))}
          <div className="flex justify-between pt-1 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular">{formatCents(order.totalCents, order.currency)}</dd>
          </div>
        </dl>
      </section>

      <DemoPayment
        orderId={order.id}
        token={t}
        totalCents={order.totalCents}
        currency={order.currency}
      />

      <p className="text-center text-sm">
        <Link
          href="/city?checkout=cancelled"
          className="text-fog-3 underline-offset-4 hover:text-fog hover:underline"
        >
          Back to the city without paying
        </Link>
      </p>
    </main>
  );
}
