"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Navigation, Radio, Sparkles, Ticket, Users } from "lucide-react";
import type { CityEvent, DigitalReward, Merchant, Offer, Product } from "@/types/domain";
import { Badge, Button, Drawer, Price, ProductImage } from "@/components/ui";
import { enterMerchant, inspectProduct, teleportTo } from "@/city/cityActions";
import { useCityStore } from "@/city/cityStore";
import { distance2D, resolveNavTarget } from "@/city/navigation";
import { playerRig } from "@/engine/player/playerRig";
import { useWorldStore } from "@/engine/store/worldStore";
import { track } from "@/lib/analytics/client";
import { eventPhase, formatLaunchTime, productAvailability } from "@/lib/events/status";
import { offerIsLive } from "@/features/cart/pricing";
import { useIsPhone } from "@/features/hud/useMediaQuery";
import { formatCents } from "@/lib/utils/money";
import { cn } from "@/lib/utils/cn";
import { useEventPanelStore } from "./eventPanelStore";
import { COUNTDOWN_WINDOW_MS, formatCountdown } from "./selectEvent";
import { useEventClock } from "./useEventClock";

const CITY_TZ = "America/Chicago";
const AT_DOOR_M = 6;

function windowLabel(event: CityEvent, locale?: string): { local: string; city: string | null } {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const day = start.toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric" });
  const t = (d: Date, tz?: string) =>
    d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) });
  const local = `${day} · ${t(start)} – ${t(end)}`;
  const cityTime = `${t(start, CITY_TZ)} city time`;
  return { local, city: t(start) === t(start, CITY_TZ) ? null : cityTime };
}

/**
 * An event's sheet: media, when, where, the collection, the real offer and the reward. The CTA
 * follows the phase: before it starts you can go wait at the door; while live you enter the pop-up;
 * afterwards the collection stays browsable (nothing here pretends to be scarce).
 */
export function EventPanel() {
  const eventId = useEventPanelStore((s) => s.eventId);
  const close = useEventPanelStore((s) => s.close);
  const index = useCityStore((s) => s.index);
  const phone = useIsPhone();
  const [shownId, setShownId] = useState<string | null>(eventId);
  if (eventId !== null && eventId !== shownId) setShownId(eventId);
  const event = shownId ? index?.eventsById[shownId] : undefined;
  const merchant = event?.merchantId ? index?.merchantsById[event.merchantId] : undefined;

  const viewed = useRef<string | null>(null);
  useEffect(() => {
    if (!eventId || !event || viewed.current === eventId) return;
    viewed.current = eventId;
    track("event_viewed", { eventId, phase: eventPhase(event, Date.now()), source: "panel" });
  }, [eventId, event]);

  return (
    <Drawer
      open={eventId !== null}
      onClose={close}
      side={phone ? "bottom" : "right"}
      width="min(480px, 100vw)"
      eyebrow={event ? `${merchant?.name ?? "Event Square"} · ${kindLabel(event.kind)}` : "Event"}
      title={event?.title ?? "Event"}
    >
      {event && index ? (
        <EventBody key={event.id} event={event} merchant={merchant} onClose={close} />
      ) : (
        <p className="px-5 py-8 text-sm text-fog-3">This event is not on the schedule any more.</p>
      )}
    </Drawer>
  );
}

function kindLabel(kind: CityEvent["kind"]): string {
  switch (kind) {
    case "launch":
      return "Drop";
    case "live":
    case "concert":
      return "Live";
    case "promo":
    case "flash_deal":
      return "Offer";
    case "opening":
      return "Opening";
  }
}

function EventBody({ event, merchant, onClose }: { event: CityEvent; merchant: Merchant | undefined; onClose: () => void }) {
  const index = useCityStore((s) => s.index)!;
  const setPlacesOpen = useWorldStore((s) => s.setPlacesOpen);
  const now = useEventClock();
  const phase = eventPhase(event, now);
  const msToStart = Date.parse(event.startsAt) - now;
  const collection = useMemo(
    () => event.productIds.map((id) => index.productsById[id]).filter((p): p is Product => Boolean(p)),
    [event.productIds, index],
  );
  const hero = event.productId ? index.productsById[event.productId] : undefined;
  const offer: Offer | undefined = event.offerId
    ? (index.offersByMerchant[event.merchantId ?? ""] ?? []).find((o) => o.id === event.offerId)
    : undefined;
  const offerLive = offer ? offerIsLive(offer, new Date(now)) : false;
  const reward: DigitalReward | undefined = event.rewardId ? index.rewardsById[event.rewardId] : undefined;
  const when = windowLabel(event);
  const parcel = event.parcelId ? index.parcelsById[event.parcelId] : undefined;
  const district = event.districtId ? index.districtsById[event.districtId] : undefined;
  const popupOpen = Boolean(parcel && index.occupiedParcels.some((p) => p.id === parcel.id));
  const streamHost = event.livestreamUrl ? safeHost(event.livestreamUrl) : null;

  const [atDoor, setAtDoor] = useState(false);
  useEffect(() => {
    const target = resolveNavTarget({ kind: "event", eventId: event.id }, index);
    if (!target) return;
    const check = () => setAtDoor(distance2D(playerRig, target.pose) <= AT_DOOR_M);
    check();
    const t = setInterval(check, 700);
    return () => clearInterval(t);
  }, [event.id, index]);

  const goThere = () => {
    if (teleportTo({ kind: "event", eventId: event.id }, "hud")) {
      track("event_joined", { eventId: event.id, phase: phase === "ended" ? "scheduled" : phase, via: "teleport" });
      onClose();
    }
  };
  const enterPopup = () => {
    if (!event.merchantId || !parcel) return;
    if (atDoor) {
      if (enterMerchant(event.merchantId, "teleport", parcel.id)) onClose();
    } else {
      goThere();
    }
  };
  const openProduct = (p: Product) => {
    track("drop_product_viewed", { eventId: event.id, productId: p.id, phase, source: "panel" });
    onClose();
    inspectProduct(p.id, "panel");
  };

  return (
    <div className="pb-6">
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-ink-2">
        {event.heroVideoUrl && phase === "live" ? (
          <video
            src={event.heroVideoUrl}
            poster={event.heroImageUrl}
            muted
            loop
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />
        ) : (
          <ProductImage
            src={event.heroImageUrl}
            alt=""
            label={event.title}
            brand={merchant?.brand}
            className="h-full w-full"
          />
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-night/90 to-transparent p-3">
          <PhaseChip phase={phase} msToStart={msToStart} />
          {streamHost ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-line bg-night/60 px-1.5 py-0.5 text-[11px] text-fog-2">
              <Radio className="h-3 w-3" aria-hidden="true" /> Stream · {streamHost}
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-5 px-5 pt-4">
        <div className="space-y-1 text-sm">
          <p className="text-fog">{when.local}</p>
          {when.city ? <p className="text-xs text-fog-3">{when.city}</p> : null}
          <p className="text-fog-2">
            {district ? district.name : "Event Square"}
            {parcel ? ` · ${popupOpen ? "pop-up open" : phase === "ended" ? "pop-up closed" : "pop-up opens at start"}` : ""}
            {event.capacity ? ` · room for ${event.capacity}` : ""}
          </p>
        </div>

        <p className="text-[15px] leading-relaxed text-fog-2">{event.description}</p>

        {offer ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-signal/30 bg-signal/8 px-3 py-2.5 text-sm">
            <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-signal" aria-hidden="true" />
            <p>
              <span className="font-medium">{offer.title}.</span>{" "}
              <span className="text-fog-2">
                {offer.description} {offerLive ? "Live now." : phase === "ended" ? "This offer has ended." : "Applies once the drop starts."}
              </span>
            </p>
          </div>
        ) : null}

        {reward ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-sky/30 bg-sky/8 px-3 py-2.5 text-sm">
            <RewardSwatch reward={reward} />
            <p>
              <span className="font-medium">{reward.name}.</span>{" "}
              <span className="text-fog-2">
                {phase === "ended"
                  ? "Was given to everyone who bought while the drop was live."
                  : "Buy from the collection while the drop is live and it is yours."}
              </span>
            </p>
          </div>
        ) : null}

        {collection.length ? (
          <section aria-label="The collection">
            <h3 className="eyebrow mb-2">The collection</h3>
            <ul className="grid grid-cols-2 gap-2">
              {collection.map((p) => {
                const avail = productAvailability(p, now);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => openProduct(p)}
                      className="sign block w-full overflow-hidden text-left hover:bg-white/5"
                    >
                      <ProductImage src={p.imageUrl} alt={p.title} label={p.title} brand={merchant?.brand} className="aspect-[4/3] w-full" />
                      <div className="space-y-0.5 px-2.5 py-2">
                        <p className="truncate text-[13px] font-medium">{p.title}</p>
                        <p className="flex items-center justify-between text-xs text-fog-2">
                          <Price cents={p.priceCents} currency={p.currency} />
                          {avail.state === "upcoming" ? (
                            <span className="text-sodium">Drops {formatLaunchTime(avail.availableFrom, now)}</span>
                          ) : avail.state === "closed" ? (
                            <span className="text-fog-3">Closed</span>
                          ) : (
                            <span className="text-mint">Available</span>
                          )}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            {phase === "ended" ? (
              <p className="mt-2 text-xs text-fog-3">The drop is over; the collection stays on sale at {merchant?.name ?? "the store"}.</p>
            ) : null}
          </section>
        ) : hero ? (
          <button type="button" onClick={() => openProduct(hero)} className="sign flex w-full items-center gap-3 p-3 text-left hover:bg-white/5">
            <ProductImage src={hero.imageUrl} alt={hero.title} label={hero.title} brand={merchant?.brand} className="h-16 w-20 shrink-0 rounded-lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{hero.title}</span>
              <span className="block text-xs text-fog-2">{hero.priceCents === 0 ? "Free" : formatCents(hero.priceCents, hero.currency)}</span>
            </span>
          </button>
        ) : null}

        <div className="flex flex-col gap-2 pt-1">
          {phase === "live" && parcel ? (
            <Button size="lg" onClick={enterPopup} leading={<Sparkles className="h-5 w-5" aria-hidden="true" />} data-testid="event-enter">
              {atDoor ? "Enter the pop-up" : "Take me to the pop-up"}
            </Button>
          ) : phase === "scheduled" ? (
            <Button size="lg" onClick={goThere} leading={<Navigation className="h-5 w-5" aria-hidden="true" />} data-testid="event-go">
              {msToStart <= COUNTDOWN_WINDOW_MS ? `Take me there · ${formatCountdown(msToStart)}` : "Take me there"}
            </Button>
          ) : merchant ? (
            <Button size="lg" variant="secondary" onClick={() => { if (teleportTo({ kind: "merchant", merchantId: merchant.id }, "hud")) onClose(); }}>
              Visit {merchant.name}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              setPlacesOpen(true);
            }}
            leading={<Users className="h-4 w-4" aria-hidden="true" />}
          >
            Everything on tonight
          </Button>
        </div>
      </div>
    </div>
  );
}

function PhaseChip({ phase, msToStart }: { phase: ReturnType<typeof eventPhase>; msToStart: number }) {
  if (phase === "live") {
    return (
      <Badge tone="mint" className="px-2 py-1 text-xs">
        <span className="relative mr-0.5 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
        </span>
        Live now
      </Badge>
    );
  }
  if (phase === "ended") return <Badge tone="neutral" className="px-2 py-1 text-xs">Ended</Badge>;
  return (
    <Badge tone="signal" className={cn("px-2 py-1 text-xs", msToStart <= COUNTDOWN_WINDOW_MS && "tabular")}>
      {msToStart <= COUNTDOWN_WINDOW_MS ? `Starts in ${formatCountdown(msToStart)}` : "Coming up"}
    </Badge>
  );
}

/** A small colour swatch standing in for the reward's look (hoodie colours, badge colours). */
export function RewardSwatch({ reward, className }: { reward: DigitalReward; className?: string }) {
  const a = reward.appearance;
  return (
    <span
      className={cn("mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-line", className)}
      style={{ background: a?.primary ?? "#2a2d36" }}
      aria-hidden="true"
    >
      {a?.accent ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.accent }} /> : <Sparkles className="h-3 w-3 text-sky" />}
    </span>
  );
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
