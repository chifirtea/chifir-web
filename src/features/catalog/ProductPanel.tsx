"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Sparkles } from "lucide-react";
import type { Product } from "@/types/domain";
import { Badge, Button, Drawer, Price, ProductImage } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { formatCents } from "@/lib/utils/money";
import { track } from "@/lib/analytics/client";
import { useCityStore } from "@/city/cityStore";
import { useWorldStore } from "@/engine/store/worldStore";
import { useIsPhone } from "@/features/hud/useMediaQuery";
import { useCartStore } from "@/features/cart/cartStore";
import { useFulfillmentStore } from "@/features/cart/fulfillmentStore";
import { fulfillmentEtaLine } from "@/features/cart/fulfillmentLabels";
import { QuantityStepper } from "@/features/cart/QuantityStepper";
import {
  availableFulfillmentTypes,
  bestOfferFor,
  unitDiscountCents,
  unitPriceCents,
  variantProblem,
} from "@/features/cart/pricing";
import { DietaryChips, SpiceFlames, humanize, inventoryNote, leadTimeLabel } from "./attributes";
import { eventPhase, formatLaunchTime, productAvailability } from "@/lib/events/status";
import { useEventClock } from "@/features/events/useEventClock";
import { formatCountdown } from "@/features/events/selectEvent";

const ADDED_MS = 1200;

/**
 * The product sign: opens when the world focuses a product (hotspot, list, AI card). Prices come
 * from the same pricing helpers checkout uses, so what is shown is what will be charged.
 */
export function ProductPanel() {
  const focusedId = useWorldStore((s) => s.focusedProductId);
  const setFocusedProduct = useWorldStore((s) => s.setFocusedProduct);
  const setCartOpen = useWorldStore((s) => s.setCartOpen);
  const index = useCityStore((s) => s.index);
  const isPhone = useIsPhone();

  // Keep the last product mounted while the drawer slides out (focusedId goes null first).
  const [shownId, setShownId] = useState<string | null>(focusedId);
  if (focusedId !== null && focusedId !== shownId) setShownId(focusedId);

  const product = shownId ? index?.productsById[shownId] : undefined;
  const merchant = product ? index?.merchantsById[product.merchantId] : undefined;
  const close = () => setFocusedProduct(null);

  return (
    <Drawer
      open={focusedId !== null}
      onClose={close}
      side={isPhone ? "bottom" : "right"}
      width="min(480px, 100vw)"
      eyebrow={
        product ? `${merchant?.name ?? "In the city"} · ${humanize(product.category)}` : "Product"
      }
      title={product?.title ?? (index ? "Not available" : "Loading")}
    >
      {product ? (
        <ProductBody
          key={product.id}
          product={product}
          onViewCart={() => {
            close();
            setCartOpen(true);
          }}
        />
      ) : (
        <div className="space-y-4 px-5 py-10 text-center">
          <p className="text-fog-2">
            {index ? "This item is not available right now." : "Loading the catalog…"}
          </p>
          <Button variant="secondary" onClick={close}>
            Back to the city
          </Button>
        </div>
      )}
    </Drawer>
  );
}

function ProductBody({ product, onViewCart }: { product: Product; onViewCart: () => void }) {
  const index = useCityStore((s) => s.index);
  const addLine = useCartStore((s) => s.addLine);
  const promoCode = useFulfillmentStore((s) => s.promoCode);
  const merchant = index?.merchantsById[product.merchantId];
  const reward = product.digitalRewardId ? index?.rewardsById[product.digitalRewardId] : undefined;
  const merchantOffers = index?.offersByMerchant[product.merchantId];

  const [selection, setSelection] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [addedAt, setAddedAt] = useState<number | null>(null);
  const [everAdded, setEverAdded] = useState(false);

  useEffect(() => {
    if (addedAt === null) return;
    const t = setTimeout(() => setAddedAt(null), ADDED_MS);
    return () => clearTimeout(t);
  }, [addedAt]);

  // Drop items count down to their window on the city clock; everything else ticks harmlessly.
  const now = useEventClock(Boolean(product.availableFrom || product.availableUntil || product.eventId));
  const availability = productAvailability(product, now);
  const upcoming = availability.state === "upcoming";
  const event = product.eventId ? index?.eventsById[product.eventId] : undefined;
  const dropPhase = event ? eventPhase(event, now) : null;

  const unit = unitPriceCents(product, selection);
  const offer = useMemo(
    () => bestOfferFor(product, unit, merchantOffers ?? [], new Date(now), promoCode || undefined),
    [product, unit, merchantOffers, promoCode, now],
  );
  const discount = offer ? unitDiscountCents(offer, unit) : 0;
  const problem = variantProblem(product, selection, now);
  const soldOut = product.inventoryStatus === "out_of_stock";

  // One `drop_product_viewed` per opening of a product that belongs to an event.
  const tracked = useRef(false);
  useEffect(() => {
    if (!event || !dropPhase || tracked.current) return;
    tracked.current = true;
    track("drop_product_viewed", { eventId: event.id, productId: product.id, phase: dropPhase, source: "panel" });
  }, [event, dropPhase, product.id]);
  const note = inventoryNote(product.inventoryStatus, product.inventoryCount);
  const types = availableFulfillmentTypes(merchant, [product]);
  const lead = leadTimeLabel(product);
  const a = product.attributes;
  const hasVariant = (id: string) => product.variantGroups.some((g) => g.id === id);

  const add = () => {
    if (problem) return;
    addLine({
      productId: product.id,
      merchantId: product.merchantId,
      quantity,
      variantSelection: selection,
    });
    track("cart_item_added", {
      productId: product.id,
      merchantId: product.merchantId,
      quantity,
      source: "panel",
    });
    setAddedAt(Date.now());
    setEverAdded(true);
  };

  return (
    <div className="pb-6">
      <ProductImage
        src={product.imageUrl}
        alt={product.title}
        label={product.title}
        brand={merchant?.brand}
        className="aspect-[16/10] w-full"
      />

      <div className="space-y-5 px-5 pt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Price
            cents={Math.max(0, unit - discount)}
            currency={product.currency}
            compareAtCents={discount > 0 ? unit : product.compareAtPriceCents}
            className="font-display text-2xl tracking-tight"
          />
          <span className="stamp">Get it IRL</span>
          {upcoming && availability.state === "upcoming" ? (
            <Badge tone="sodium" className="px-2 py-1 text-xs">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Drops {formatLaunchTime(availability.availableFrom, now)}
            </Badge>
          ) : null}
          {offer ? (
            <Badge tone="signal">
              {offer.kind === "percent_off"
                ? `${offer.value}% off`
                : `${formatCents(offer.value, product.currency)} off`}
              <span className="font-normal opacity-80">· {offer.title}</span>
            </Badge>
          ) : null}
          {note ? <Badge tone={note.tone}>{note.text}</Badge> : null}
        </div>

        {product.description ? (
          <p className="text-[15px] leading-relaxed text-fog-2">{product.description}</p>
        ) : null}

        {product.variantGroups.map((group) => (
          <fieldset key={group.id} className="space-y-2">
            <legend className="flex items-baseline gap-2 text-sm">
              <span className="font-medium">{group.name}</span>
              {group.required ? (
                <span className="text-xs text-fog-3">required</span>
              ) : (
                <span className="text-xs text-fog-3">optional</span>
              )}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {group.options.map((opt) => {
                const selected = selection[group.id] === opt.id;
                const disabled = opt.inventoryStatus === "out_of_stock";
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled}
                    onClick={() =>
                      setSelection((s) => {
                        const next = { ...s };
                        if (selected && !group.required) delete next[group.id];
                        else next[group.id] = opt.id;
                        return next;
                      })
                    }
                    className={cn(
                      "min-h-11 rounded-full border px-3.5 text-sm transition-colors",
                      selected
                        ? "border-signal bg-signal/12 text-fog"
                        : "border-line text-fog-2 hover:bg-white/5 hover:text-fog",
                      disabled && "cursor-not-allowed line-through opacity-40",
                    )}
                  >
                    {opt.name}
                    {opt.priceDeltaCents ? (
                      <span className="tabular ml-1 text-fog-3">
                        {opt.priceDeltaCents > 0 ? "+" : ""}
                        {formatCents(opt.priceDeltaCents, product.currency)}
                      </span>
                    ) : null}
                    {opt.inventoryStatus === "low_stock" ? (
                      <span className="ml-1 text-xs text-sodium">few left</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className="flex flex-wrap items-center gap-1.5">
          {a.spiceLevel ? <SpiceFlames level={a.spiceLevel} showLabel className="mr-1" /> : null}
          <DietaryChips tags={a.dietary} />
          {a.serves ? <Badge tone="neutral">Serves {a.serves}</Badge> : null}
          {a.sizes?.length && !hasVariant("size") ? (
            <Badge tone="neutral">Sizes {a.sizes.join(" · ")}</Badge>
          ) : null}
          {a.colors?.length && !hasVariant("color")
            ? a.colors.map((c) => (
                <Badge key={c} tone="neutral">
                  {c}
                </Badge>
              ))
            : null}
          {a.occasion?.map((o) => (
            <Badge key={o} tone="sodium">
              {humanize(o)}
            </Badge>
          ))}
          {a.material ? <Badge tone="neutral">{a.material}</Badge> : null}
        </div>

        {a.allergens?.length ? (
          <p className="text-sm text-fog-2">
            <span className="font-medium text-fog">Contains:</span> {a.allergens.join(", ")}.
            Confirm allergens with the merchant before ordering.
          </p>
        ) : null}

        <div className="space-y-1 text-sm">
          {types.length ? (
            types.map((t, i) => (
              <p key={t} className={i === 0 ? "text-fog" : "text-fog-3"}>
                {i === 0 ? "" : "or "}
                {i === 0
                  ? fulfillmentEtaLine(merchant, t, product.currency)
                  : fulfillmentEtaLine(merchant, t, product.currency).replace(/^\w/, (c) =>
                      c.toLowerCase(),
                    )}
              </p>
            ))
          ) : (
            <p className="text-danger">Not available to order right now.</p>
          )}
          {product.inventoryStatus === "preorder" && lead ? (
            <p className="text-fog-3">Preorder · ships in {lead}</p>
          ) : null}
        </div>

        {event && dropPhase !== "ended" ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-signal/30 bg-signal/8 px-3 py-2.5 text-sm">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden="true" />
            <p>
              <span className="font-medium">Part of {event.title}.</span>{" "}
              <span className="text-fog-2">
                {dropPhase === "live"
                  ? "The drop is live now."
                  : upcoming && availability.state === "upcoming"
                    ? `Goes on sale at ${formatLaunchTime(availability.availableFrom, now)}${Date.parse(availability.availableFrom) - now <= 3600_000 ? ` (in ${formatCountdown(Date.parse(availability.availableFrom) - now)})` : ""}.`
                    : ""}
                {event.capacity ? ` Room for ${event.capacity} at the pop-up.` : ""}
              </span>
            </p>
          </div>
        ) : null}

        {reward ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-sky/30 bg-sky/8 px-3 py-2.5 text-sm">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sky" aria-hidden="true" />
            <p>
              <span className="font-medium">Comes with a digital twin: {reward.name}.</span>{" "}
              <span className="text-fog-2">{reward.description}</span>
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <QuantityStepper
            value={quantity}
            onChange={setQuantity}
            label={`Quantity of ${product.title}`}
          />
          <Button
            size="lg"
            data-testid="add-to-cart"
            className={cn(
              "min-w-[9.5rem] flex-1 tabular",
              addedAt !== null && "bg-mint text-night hover:bg-mint",
            )}
            disabled={Boolean(problem) || soldOut}
            onClick={add}
            leading={
              addedAt !== null ? (
                <Check className="h-5 w-5" aria-hidden="true" />
              ) : upcoming ? (
                <Clock className="h-5 w-5" aria-hidden="true" />
              ) : undefined
            }
            aria-live="polite"
          >
            {addedAt !== null
              ? "Added"
              : soldOut
                ? "Sold out"
                : upcoming && availability.state === "upcoming"
                  ? Date.parse(availability.availableFrom) - now <= 3600_000
                    ? `Drops in ${formatCountdown(Date.parse(availability.availableFrom) - now)}`
                    : `Drops ${formatLaunchTime(availability.availableFrom, now)}`
                  : problem &&
                      Object.keys(selection).length === 0 &&
                      product.variantGroups.some((g) => g.required)
                    ? problem
                    : "Add to cart"}
          </Button>
        </div>
        {problem && !soldOut && !upcoming && Object.keys(selection).length > 0 ? (
          <p className="text-sm text-danger">{problem}</p>
        ) : null}
        {everAdded ? (
          <Button variant="secondary" className="w-full" onClick={onViewCart}>
            View cart
          </Button>
        ) : null}
        <p className="text-xs text-fog-3">
          {discount > 0
            ? `Offer applied automatically at checkout. You pay ${formatCents((unit - discount) * quantity, product.currency)} for ${quantity}.`
            : `${formatCents(unit * quantity, product.currency)} for ${quantity} before any fees.`}
        </p>
      </div>
    </div>
  );
}
