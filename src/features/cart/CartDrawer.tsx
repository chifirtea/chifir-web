"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { ShoppingBag, Tag, X } from "lucide-react";
import type { CartLine, FulfillmentType, Merchant, Product } from "@/types/domain";
import { Button, Drawer, ProductImage } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { formatCents } from "@/lib/utils/money";
import { track } from "@/lib/analytics/client";
import { useWorldStore } from "@/engine/store/worldStore";
import { useIsPhone } from "@/features/hud/useMediaQuery";
import { CheckoutSheet } from "@/features/checkout/CheckoutSheet";
import { useCartStore } from "./cartStore";
import { useFulfillmentStore } from "./fulfillmentStore";
import { feeLineLabel, fulfillmentOptionLabel } from "./fulfillmentLabels";
import { unitPriceCents, variantLabel } from "./pricing";
import { QuantityStepper } from "./QuantityStepper";
import { useCartTotals, type MerchantGroup } from "./useCartTotals";

/**
 * The cart, as a sign on the right (a bottom sheet on phones). Grouped by merchant, each group
 * choosing how it gets fulfilled; prices are the shared `computeTotals` preview.
 */
export function CartDrawer() {
  const open = useWorldStore((s) => s.cartOpen);
  const setCartOpen = useWorldStore((s) => s.setCartOpen);
  const setConciergeOpen = useWorldStore((s) => s.setConciergeOpen);
  const isPhone = useIsPhone();
  const view = useCartTotals();
  const { totals, linesByMerchant, ready } = view;
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const close = useCallback(() => setCartOpen(false), [setCartOpen]);
  // Closing the cart (from anywhere, including closeAllPanels) also leaves the checkout step.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setCheckoutOpen(false);
  }

  const empty = linesByMerchant.length === 0;
  const canCheckout = ready && !empty && totals.problems.length === 0 && totals.lines.length > 0;
  const title = empty ? "Your cart" : `${totals.itemCount} ${totals.itemCount === 1 ? "item" : "items"}`;

  return (
    <>
      <Drawer
        open={open && !checkoutOpen}
        onClose={close}
        side={isPhone ? "bottom" : "right"}
        eyebrow="Cart"
        title={title}
        footer={
          empty ? undefined : (
            <div className="space-y-2">
              {totals.problems.length > 0 ? (
                <p className="text-center text-sm text-danger">Fix the items marked above to continue.</p>
              ) : null}
              <Button size="lg" className="w-full" disabled={!canCheckout} onClick={() => setCheckoutOpen(true)}>
                Get it IRL
                {canCheckout ? <span className="tabular font-normal opacity-80">· {formatCents(totals.totalCents, totals.currency)}</span> : null}
              </Button>
            </div>
          )
        }
      >
        {empty ? (
          <EmptyCart
            onConcierge={() => {
              close();
              setConciergeOpen(true);
            }}
          />
        ) : (
          <div className="space-y-6 px-5 py-4">
            {!ready ? <p className="text-sm text-fog-3">Loading the catalog…</p> : null}
            {linesByMerchant.map((group) => (
              <MerchantSection key={group.merchantId} group={group} view={view} />
            ))}
            <PromoCode key={view.promoCode} view={view} />
            <Totals view={view} />
          </div>
        )}
      </Drawer>
      <CheckoutSheet
        open={open && checkoutOpen}
        onClose={() => {
          setCheckoutOpen(false);
          close();
        }}
        onBack={() => setCheckoutOpen(false)}
      />
    </>
  );
}

function EmptyCart({ onConcierge }: { onConcierge: () => void }) {
  return (
    <div className="flex flex-col items-center gap-5 px-6 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full border border-line bg-ink-2 text-fog-3">
        <ShoppingBag className="h-7 w-7" aria-hidden="true" />
      </span>
      <p className="max-w-[26ch] text-fog-2">Your cart is empty. Walk into a store or ask the concierge.</p>
      <Button variant="secondary" onClick={onConcierge}>
        Ask the concierge
      </Button>
    </div>
  );
}

function MerchantSection({ group, view }: { group: MerchantGroup; view: ReturnType<typeof useCartTotals> }) {
  const setType = useFulfillmentStore((s) => s.setType);
  const { totals } = view;
  const merchant = group.merchant;
  return (
    <section aria-label={merchant?.name ?? "Unknown merchant"} className="space-y-3">
      <header className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
          style={{ background: merchant?.brand.accent ?? "#666" }}
        />
        <h3 className="font-display min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
          {merchant?.name ?? "Unknown merchant"}
        </h3>
      </header>

      {group.availableTypes.length > 0 ? (
        <div role="radiogroup" aria-label={`How to get your ${merchant?.name ?? ""} order`} className="flex flex-wrap gap-1.5">
          {group.availableTypes.map((type) => {
            const selected = group.type === type;
            const { label } = fulfillmentOptionLabel(merchant, type, totals.currency);
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setType(group.merchantId, type)}
                className={cn(
                  "min-h-11 rounded-lg border px-3 text-[13px] font-medium transition-colors",
                  selected ? "border-signal bg-signal/12 text-fog" : "border-line text-fog-2 hover:bg-white/5 hover:text-fog",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-danger">
          {merchant ? `${merchant.name} cannot fulfil these items together. Remove one to continue.` : "This place is no longer in the city."}
        </p>
      )}

      <ul className="divide-y divide-line">
        {group.lines.map((line) => (
          <LineRow key={line.key} line={line} product={group.products.find((p) => p.id === line.productId)} merchant={merchant} view={view} />
        ))}
      </ul>
    </section>
  );
}

function LineRow({
  line,
  product,
  merchant,
  view,
}: {
  line: CartLine;
  product: Product | undefined;
  merchant: Merchant | undefined;
  view: ReturnType<typeof useCartTotals>;
}) {
  const removeLine = useCartStore((s) => s.removeLine);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const { totals } = view;
  const priced = totals.lines.find((l) => l.key === line.key);
  const problem = totals.problems.find((p) => p.key === line.key)?.reason;
  const unit = priced?.unitPriceCents ?? (product ? unitPriceCents(product, line.variantSelection) : 0);
  const label = product ? variantLabel(product, line.variantSelection) : undefined;
  const lineTotal = priced ? priced.lineTotalCents : unit * line.quantity;

  const remove = () => {
    removeLine(line.key);
    track("cart_item_removed", { productId: line.productId });
  };

  return (
    <li className="flex gap-3 py-3">
      <ProductImage
        src={product?.imageUrl}
        alt=""
        label={product?.title ?? "?"}
        brand={merchant?.brand}
        className="h-16 w-16 shrink-0 rounded-lg"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate text-[15px] font-medium">{product?.title ?? "Unavailable item"}</p>
          <span className={cn("tabular shrink-0 text-[15px] font-semibold", priced && priced.discountCents > 0 && "text-mint")}>
            {formatCents(lineTotal, totals.currency)}
          </span>
        </div>
        {label ? <p className="truncate text-sm text-fog-2">{label}</p> : null}
        <p className="text-xs text-fog-3">
          {formatCents(unit, totals.currency)} each
          {priced?.offerTitle ? ` · ${priced.offerTitle}` : ""}
        </p>
        {problem ? <p className="mt-1 text-sm text-danger">{problem}</p> : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <QuantityStepper
            value={line.quantity}
            min={0}
            size="sm"
            label={`Quantity of ${product?.title ?? "item"}`}
            onChange={(q) => (q <= 0 ? remove() : setQuantity(line.key, q))}
          />
          <button
            type="button"
            onClick={remove}
            className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-fog-3 hover:bg-white/5 hover:text-fog"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Remove
          </button>
        </div>
      </div>
    </li>
  );
}

function PromoCode({ view }: { view: ReturnType<typeof useCartTotals> }) {
  const { totals, promoCode, offers } = view;
  const setPromoCode = useFulfillmentStore((s) => s.setPromoCode);
  // Remounted (via key) whenever the stored code changes, so the draft starts from it.
  const [draft, setDraft] = useState(promoCode);

  const applied = useMemo(() => {
    if (!promoCode || totals.promoCodeApplied !== true) return null;
    const offer = offers.find((o) => o.code?.toLowerCase() === promoCode.toLowerCase());
    return offer ? totals.appliedOffers.find((a) => a.offerId === offer.id) ?? null : null;
  }, [promoCode, totals, offers]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setPromoCode(draft);
  };

  return (
    <section aria-label="Promo code" className="space-y-2">
      <form onSubmit={submit} className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Promo code</span>
          <Tag className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-fog-3" aria-hidden="true" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            placeholder="Promo code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={32}
            className="h-11 w-full rounded-lg border border-line bg-ink-2 pr-3 pl-9 text-[15px] tracking-wide text-fog placeholder:text-fog-3 focus:border-sodium focus:outline-none"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={!draft.trim() || draft.trim() === promoCode}>
          Apply
        </Button>
      </form>
      {promoCode ? (
        applied ? (
          <p className="flex items-center justify-between text-sm text-mint">
            <span>
              {promoCode} applied — {formatCents(applied.discountCents, totals.currency)} off
            </span>
            <button type="button" onClick={() => setPromoCode("")} className="h-8 rounded px-2 text-fog-3 hover:text-fog">
              Remove
            </button>
          </p>
        ) : (
          <p className="flex items-center justify-between text-sm text-danger">
            <span>That code did not match anything in your cart.</span>
            <button type="button" onClick={() => setPromoCode("")} className="h-8 rounded px-2 text-fog-3 hover:text-fog">
              Clear
            </button>
          </p>
        )
      ) : null}
    </section>
  );
}

function Totals({ view }: { view: ReturnType<typeof useCartTotals> }) {
  const { totals, linesByMerchant } = view;
  const merchantName = (id: string) => linesByMerchant.find((g) => g.merchantId === id)?.merchant?.name ?? "";
  return (
    <dl className="space-y-1.5 border-t border-line pt-4 text-sm">
      <Row label="Subtotal" value={formatCents(totals.subtotalCents, totals.currency)} />
      {totals.appliedOffers.map((o) => (
        <Row key={o.offerId} label={o.title} value={`-${formatCents(o.discountCents, totals.currency)}`} tone="mint" />
      ))}
      {totals.byMerchant
        .filter((m) => m.feeCents > 0)
        .map((m) => (
          <Row key={m.merchantId} label={`${feeLineLabel(m.type as FulfillmentType)} · ${merchantName(m.merchantId)}`} value={formatCents(m.feeCents, totals.currency)} />
        ))}
      <Row label="Total" value={formatCents(totals.totalCents, totals.currency)} strong />
    </dl>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: "mint"; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", tone === "mint" && "text-mint", strong && "pt-1 text-base font-semibold")}>
      <dt className={cn("min-w-0 truncate", !strong && !tone && "text-fog-2")}>{label}</dt>
      <dd className="tabular shrink-0">{value}</dd>
    </div>
  );
}
