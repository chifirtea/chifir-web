"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge, Drawer } from "@/components/ui";
import { guideTo, teleportTo } from "@/city/cityActions";
import { merchantsInDistrict, type CityIndex } from "@/city/cityIndex";
import { useCityStore } from "@/city/cityStore";
import { useWorldStore } from "@/engine/store/worldStore";
import { track } from "@/lib/analytics/client";
import { cn } from "@/lib/utils/cn";
import type { CityEvent, District, Merchant, NavTarget, Parcel } from "@/types/domain";
import { fulfillmentEtaLabel, openNowStatus, priceLevelLabel } from "./openNow";
import { useIsPhone } from "./useMediaQuery";

type Tab = "places" | "tonight";

/** Drawer listing every district, its merchants and open lots, plus tonight's events. */
export function PlacesPanel() {
  const open = useWorldStore((s) => s.placesOpen);
  const setPlacesOpen = useWorldStore((s) => s.setPlacesOpen);
  const index = useCityStore((s) => s.index);
  const phone = useIsPhone();
  const [tab, setTab] = useState<Tab>("places");

  const close = useCallback(() => setPlacesOpen(false), [setPlacesOpen]);
  const go = useCallback(
    (target: NavTarget) => {
      if (teleportTo(target, "hud")) setPlacesOpen(false);
    },
    [setPlacesOpen],
  );
  const guide = useCallback(
    (target: NavTarget) => {
      if (guideTo(target, "hud")) setPlacesOpen(false);
    },
    [setPlacesOpen],
  );

  return (
    <Drawer open={open} onClose={close} side={phone ? "bottom" : "right"} eyebrow="Around the city" title="Places">
      <div className="sticky top-0 z-10 flex gap-1 border-b border-line bg-ink/95 px-3 py-2 backdrop-blur-md" role="tablist">
        <TabButton active={tab === "places"} onClick={() => setTab("places")}>
          Places
        </TabButton>
        <TabButton active={tab === "tonight"} onClick={() => setTab("tonight")}>
          Tonight
        </TabButton>
      </div>
      {!index ? (
        <p className="px-5 py-8 text-sm text-fog-3">The city is still loading.</p>
      ) : tab === "places" ? (
        <PlacesTab index={index} onGo={go} onGuide={guide} />
      ) : (
        <TonightTab index={index} onGo={go} />
      )}
    </Drawer>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "font-display h-10 flex-1 rounded-lg text-[14px] font-semibold tracking-tight transition-colors",
        active ? "bg-white/10 text-fog" : "text-fog-3 hover:bg-white/5 hover:text-fog-2",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

interface DistrictGroup {
  district: District;
  merchants: Merchant[];
  lots: Parcel[];
}

function PlacesTab({
  index,
  onGo,
  onGuide,
}: {
  index: CityIndex;
  onGo: (t: NavTarget) => void;
  onGuide: (t: NavTarget) => void;
}) {
  const groups = useMemo<DistrictGroup[]>(
    () =>
      [...index.snapshot.districts]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((district) => ({
          district,
          merchants: merchantsInDistrict(index, district.id),
          lots: index.snapshot.parcels.filter((p) => p.districtId === district.id && p.status === "available"),
        })),
    [index],
  );
  const now = useMemo(() => new Date(), []);

  return (
    <div className="pb-4">
      {groups.map(({ district, merchants, lots }) => (
        <section key={district.id} className="border-b border-line last:border-b-0">
          <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: district.theme.accent }} aria-hidden="true" />
                <h3 className="font-display truncate text-[16px] font-semibold tracking-tight">{district.name}</h3>
              </div>
              <p className="mt-0.5 line-clamp-1 text-[12px] text-fog-3">{district.description}</p>
            </div>
            <button
              type="button"
              onClick={() => onGo({ kind: "district", districtId: district.id })}
              className="font-display h-9 shrink-0 rounded-full bg-white/8 px-3 text-[13px] font-semibold tracking-tight hover:bg-white/14"
            >
              Take me there
            </button>
          </header>
          <ul>
            {merchants.map((m) => (
              <MerchantRow key={m.id} merchant={m} now={now} onGo={onGo} onGuide={onGuide} />
            ))}
            {lots.map((lot) => (
              <li key={lot.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-fog-3" aria-hidden="true" />
                  <span className="text-[13px] text-fog-3">
                    Available · {lot.tier}
                    {lot.sponsored ? " · sponsored slot" : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onGo({ kind: "parcel", parcelId: lot.id })}
                  className="font-display h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold tracking-tight text-fog-2 hover:bg-white/8 hover:text-fog"
                >
                  Take me there
                </button>
              </li>
            ))}
            {merchants.length === 0 && lots.length === 0 ? (
              <li className="px-5 py-3 text-[13px] text-fog-3">Nothing here yet.</li>
            ) : null}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MerchantRow({
  merchant,
  now,
  onGo,
  onGuide,
}: {
  merchant: Merchant;
  now: Date;
  onGo: (t: NavTarget) => void;
  onGuide: (t: NavTarget) => void;
}) {
  const status = openNowStatus(merchant.openingHours, now);
  const price = priceLevelLabel(merchant.priceLevel);
  const eta = fulfillmentEtaLabel(merchant.fulfillment);
  const target: NavTarget = { kind: "merchant", merchantId: merchant.id };
  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-3">
        <span
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/10"
          style={{ background: merchant.brand.accent }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-semibold tracking-tight">{merchant.name}</div>
          {merchant.tagline ? <p className="mt-0.5 text-[13px] text-fog-2">{merchant.tagline}</p> : null}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {status ? <Badge tone={status.open ? "mint" : "neutral"}>{status.label}</Badge> : null}
            {price ? <Badge>{price}</Badge> : null}
            {eta ? <Badge>{eta}</Badge> : null}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex gap-2 pl-[22px]">
        <button
          type="button"
          onClick={() => onGo(target)}
          className="font-display h-10 flex-1 rounded-lg bg-white/8 px-3 text-[13px] font-semibold tracking-tight hover:bg-white/14 sm:flex-none"
        >
          Take me there
        </button>
        <button
          type="button"
          onClick={() => onGuide(target)}
          className="font-display h-10 flex-1 rounded-lg px-3 text-[13px] font-semibold tracking-tight text-fog-2 hover:bg-white/8 hover:text-fog sm:flex-none"
        >
          Guide me
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Tonight
// ---------------------------------------------------------------------------

type Phase = { tone: "mint" | "sodium" | "neutral" | "danger"; label: string };

export function eventPhase(event: CityEvent, now: Date): Phase {
  if (event.status === "cancelled") return { tone: "danger", label: "Cancelled" };
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  const t = now.getTime();
  if (t >= start && t < end) return { tone: "mint", label: "Live now" };
  if (t < start) return { tone: "sodium", label: `Starts ${formatEventTime(start, now)}` };
  return { tone: "neutral", label: "Ended" };
}

function formatEventTime(ms: number, now: Date): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

function TonightTab({ index, onGo }: { index: CityIndex; onGo: (t: NavTarget) => void }) {
  const now = useMemo(() => new Date(), []);
  const events = useMemo(
    () => [...index.snapshot.events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    [index],
  );
  if (events.length === 0) {
    return <p className="px-5 py-8 text-sm text-fog-3">Nothing scheduled right now. Walk around anyway.</p>;
  }
  return (
    <ul className="pb-4">
      {events.map((event) => (
        <EventRow key={event.id} event={event} merchant={event.merchantId ? index.merchantsById[event.merchantId] : undefined} now={now} onGo={onGo} />
      ))}
    </ul>
  );
}

function EventRow({
  event,
  merchant,
  now,
  onGo,
}: {
  event: CityEvent;
  merchant: Merchant | undefined;
  now: Date;
  onGo: (t: NavTarget) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const phase = eventPhase(event, now);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) track("event_viewed", { eventId: event.id });
  };
  return (
    <li className="border-b border-line px-5 py-3 last:border-b-0">
      <button type="button" onClick={toggle} aria-expanded={expanded} className="flex w-full items-start gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={phase.tone}>{phase.label}</Badge>
            {merchant ? <span className="text-[12px] text-fog-3">{merchant.name}</span> : null}
          </div>
          <div className="font-display mt-1.5 text-[15px] font-semibold tracking-tight">{event.title}</div>
        </div>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-fog-3 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="mt-2">
          <p className="text-[13px] leading-relaxed text-fog-2">{event.description}</p>
          <button
            type="button"
            onClick={() => onGo({ kind: "event", eventId: event.id })}
            className="font-display mt-3 h-10 rounded-lg bg-white/8 px-3 text-[13px] font-semibold tracking-tight hover:bg-white/14"
          >
            Take me there
          </button>
        </div>
      ) : null}
    </li>
  );
}
