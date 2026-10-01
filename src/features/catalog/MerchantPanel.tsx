"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, DoorOpen, MapPin, MessageCircle, Navigation } from "lucide-react";
import { Badge, Button, Drawer, Price, ProductImage } from "@/components/ui";
import { enterMerchant, guideTo, inspectProduct, talkToEmployee, teleportTo } from "@/city/cityActions";
import { useCityStore } from "@/city/cityStore";
import type { CityIndex } from "@/city/cityIndex";
import { useWorldStore } from "@/engine/store/worldStore";
import { eventPhase } from "@/lib/events/status";
import { now as clockNow } from "@/lib/time/clock";
import { cn } from "@/lib/utils/cn";
import { formatCents } from "@/lib/utils/money";
import type { CityEvent, Merchant, Product } from "@/types/domain";
import { fulfillmentEtaLabel, openNowStatus, priceLevelLabel } from "@/features/hud/openNow";
import { useIsPhone } from "@/features/hud/useMediaQuery";
import { DietaryChips, SpiceFlames, humanize, inventoryNote } from "./attributes";

const CLOCK_TICK_MS = 30_000;

/**
 * A merchant's overview sheet: brand header, open-now status, delivery line, featured products,
 * its events, and the ways to get there. Opened by the AI's `open_merchant` action or a card's
 * "Details". The last merchant stays mounted while the drawer slides out, and the sheet yields
 * to the product sign (which mounts under it) while a product is focused.
 */
export function MerchantPanel() {
  const merchantId = useWorldStore((s) => s.merchantPanelId);
  const yielded = useWorldStore((s) => s.focusedProductId !== null);
  const setMerchantPanel = useWorldStore((s) => s.setMerchantPanel);
  const index = useCityStore((s) => s.index);
  const isPhone = useIsPhone();

  const [shownId, setShownId] = useState<string | null>(merchantId);
  if (merchantId !== null && merchantId !== shownId) setShownId(merchantId);

  const merchant = shownId ? index?.merchantsById[shownId] : undefined;
  const close = () => setMerchantPanel(null);

  return (
    <Drawer
      open={merchantId !== null && !yielded}
      onClose={close}
      side={isPhone ? "bottom" : "right"}
      width="min(460px, 100vw)"
      eyebrow={merchant ? humanize(merchant.category) : "Place"}
      title={merchant?.name ?? (index ? "Not in the city" : "Loading")}
    >
      {merchant && index ? (
        <MerchantBody key={merchant.id} merchant={merchant} index={index} onClose={close} />
      ) : (
        <div className="space-y-4 px-5 py-10 text-center">
          <p className="text-fog-2">{index ? "This place is not open in the city right now." : "Loading the city…"}</p>
          <Button variant="secondary" onClick={close}>
            Back to the city
          </Button>
        </div>
      )}
    </Drawer>
  );
}

function MerchantBody({ merchant, index, onClose }: { merchant: Merchant; index: CityIndex; onClose: () => void }) {
  const hotspot = useWorldStore((s) => s.activeHotspot);
  const location = useWorldStore((s) => s.location);
  const employee = index.employeesByMerchant[merchant.id];
  const [now, setNow] = useState(() => clockNow());
  useEffect(() => {
    const t = setInterval(() => setNow(clockNow()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, []);

  const status = openNowStatus(merchant.openingHours, new Date(now));
  const eta = fulfillmentEtaLabel(merchant.fulfillment);
  const fee = merchant.fulfillment.delivery?.enabled
    ? merchant.fulfillment.delivery.feeCents
    : merchant.fulfillment.shipping?.enabled
      ? merchant.fulfillment.shipping.feeCents
      : null;
  const products = useMemo(() => {
    const all = index.productsByMerchant[merchant.id] ?? [];
    const featured = all.filter((p) => p.featured);
    return (featured.length ? featured : all).slice(0, 4);
  }, [index, merchant.id]);
  const events = useMemo(
    () =>
      index.snapshot.events
        .filter((e) => e.merchantId === merchant.id && eventPhase(e, now) !== "ended")
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
        .slice(0, 3),
    [index, merchant.id, now],
  );
  const atDoor =
    location.kind === "street" && hotspot?.kind === "door" && hotspot.payload.merchantId === merchant.id
      ? hotspot
      : null;
  const target = { kind: "merchant" as const, merchantId: merchant.id };
  const initial = merchant.name.trim().charAt(0).toUpperCase();

  return (
    <div className="pb-6">
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${merchant.brand.primary}, ${merchant.brand.secondary} 60%, ${merchant.brand.accent})` }} />
      <div className="flex items-start gap-3 px-5 pt-4">
        <div
          className="font-display flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xl font-bold"
          style={{ background: merchant.brand.primary, color: merchant.brand.onPrimary }}
          aria-hidden="true"
        >
          {merchant.logoUrl ? <img src={merchant.logoUrl} alt="" className="h-full w-full object-cover" /> : initial}
        </div>
        <div className="min-w-0 flex-1">
          {merchant.tagline ? <p className="text-[15px] leading-snug text-fog">{merchant.tagline}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {status ? <Badge tone={status.open ? "mint" : "neutral"}>{status.label}</Badge> : null}
            {priceLevelLabel(merchant.priceLevel) ? <Badge>{priceLevelLabel(merchant.priceLevel)}</Badge> : null}
            {merchant.rating !== undefined ? (
              <Badge tone="sodium">
                ★ {merchant.rating.toFixed(1)}
                {merchant.ratingCount ? ` (${merchant.ratingCount.toLocaleString("en-US")})` : ""}
              </Badge>
            ) : null}
          </div>
          {eta ? (
            <p className="mt-2 text-[13px] text-fog-2">
              {eta}
              {fee !== null ? ` · ${fee > 0 ? formatCents(fee) : "free"}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 px-5" data-testid="merchant-panel-actions">
        {atDoor ? (
          <Button
            onClick={() => {
              if (enterMerchant(merchant.id, "door", atDoor.payload.parcelId)) onClose();
            }}
            leading={<DoorOpen className="h-4 w-4" />}
          >
            Enter
          </Button>
        ) : (
          <Button
            onClick={() => {
              if (teleportTo(target, "hud")) onClose();
            }}
            leading={<Navigation className="h-4 w-4" />}
          >
            Take me there
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            if (guideTo(target, "hud")) onClose();
          }}
          leading={<MapPin className="h-4 w-4" />}
        >
          Guide me
        </Button>
        {employee ? (
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              talkToEmployee(merchant.id);
            }}
            leading={<MessageCircle className="h-4 w-4" />}
          >
            Ask {employee.name}
          </Button>
        ) : null}
      </div>

      <p className="mt-4 px-5 text-[14px] leading-relaxed text-fog-2">{merchant.description}</p>

      {products.length ? (
        <section className="mt-5 px-5">
          <h3 className="eyebrow mb-2">{products.some((p) => p.featured) ? "Featured" : "On the shelves"}</h3>
          <ul className="grid gap-2">
            {products.map((p) => (
              <li key={p.id}>
                <FeaturedProduct product={p} merchant={merchant} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {events.length ? (
        <section className="mt-5 px-5">
          <h3 className="eyebrow mb-2">Happening here</h3>
          <ul className="grid gap-2">
            {events.map((e) => (
              <li key={e.id}>
                <EventRow event={e} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function FeaturedProduct({ product, merchant, now }: { product: Product; merchant: Merchant; now: number }) {
  const note = inventoryNote(product.inventoryStatus, product.inventoryCount);
  const dropsAt = product.availableFrom && now < Date.parse(product.availableFrom) ? new Date(product.availableFrom) : null;
  return (
    <button
      type="button"
      onClick={() => inspectProduct(product.id, "panel")}
      className={cn("sign flex min-h-11 w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-white/4")}
    >
      <ProductImage src={product.imageUrl} alt="" label={product.title} brand={merchant.brand} className="h-14 w-14 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-display min-w-0 truncate text-[15px] font-semibold tracking-tight">{product.title}</p>
          <Price cents={product.priceCents} currency={product.currency} className="shrink-0 text-sm" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {product.attributes.spiceLevel ? <SpiceFlames level={product.attributes.spiceLevel} /> : null}
          <DietaryChips tags={product.attributes.dietary} compact />
          {dropsAt ? (
            <Badge tone="sodium">Drops {dropsAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</Badge>
          ) : note ? (
            <Badge tone={note.tone}>{note.text}</Badge>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function EventRow({ event, now }: { event: CityEvent; now: number }) {
  const phase = eventPhase(event, now);
  const start = new Date(event.startsAt);
  const sameDay = start.toDateString() === new Date(now).toDateString();
  const when = `${sameDay ? "Today" : start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  return (
    <div className="sign flex items-start gap-3 rounded-xl p-3">
      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-sodium" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display min-w-0 truncate text-[14px] font-semibold tracking-tight">{event.title}</p>
          {phase === "live" ? <Badge tone="signal">Live</Badge> : <Badge>{when}</Badge>}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-fog-2">{event.description}</p>
      </div>
    </div>
  );
}
