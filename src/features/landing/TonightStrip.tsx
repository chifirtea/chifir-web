import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { fulfillmentEtaLabel, openNowStatus, priceLevelLabel } from "@/features/hud/openNow";
import type { CityEvent, Merchant } from "@/types/domain";

export interface TonightEvent {
  event: CityEvent;
  merchant?: Merchant;
}

/** Server-rendered strip: the next few events and a handful of places, each a deep link. */
export function TonightStrip({
  events,
  merchants,
  now,
}: {
  events: TonightEvent[];
  merchants: Merchant[];
  now: Date;
}) {
  return (
    <section id="tonight" className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-24">
      <div className="flex flex-col gap-1">
        <div className="eyebrow">Tonight in the city</div>
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Real places, real hours.
        </h2>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
        <div>
          <h3 className="font-display text-[13px] tracking-[0.18em] text-fog-3 uppercase">
            Coming up
          </h3>
          {events.length === 0 ? (
            <p className="mt-4 text-[15px] text-fog-2">
              Nothing scheduled right now. Walk in anyway.
            </p>
          ) : (
            <ol className="mt-3 divide-y divide-line border-y border-line">
              {events.map(({ event, merchant }) => {
                const phase = phaseOf(event, now);
                return (
                  <li key={event.id}>
                    <Link
                      href={`/city?to=event:${encodeURIComponent(event.slug)}`}
                      className="group flex items-start gap-4 py-4 transition-colors hover:text-fog"
                    >
                      <div className="w-[88px] shrink-0">
                        <div
                          className={`font-display text-[15px] font-semibold ${phase.live ? "text-mint" : "text-sodium"}`}
                        >
                          {phase.time}
                        </div>
                        <div className="text-[12px] text-fog-3">{phase.day}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-[17px] leading-snug font-semibold tracking-tight">
                          {event.title}
                        </div>
                        <div className="mt-0.5 text-[13px] text-fog-2">
                          {merchant ? merchant.name : "Event Square"}
                          {phase.live ? <span className="text-mint"> · live now</span> : null}
                        </div>
                      </div>
                      <ArrowUpRight
                        className="mt-1 h-4 w-4 shrink-0 text-fog-3 transition-colors group-hover:text-sodium"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div>
          <h3 className="font-display text-[13px] tracking-[0.18em] text-fog-3 uppercase">
            Open the door
          </h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {merchants.map((m) => {
              const status = openNowStatus(m.openingHours, now);
              const price = priceLevelLabel(m.priceLevel);
              const eta = fulfillmentEtaLabel(m.fulfillment);
              return (
                <li key={m.id}>
                  <Link
                    href={`/city?to=${encodeURIComponent(m.slug)}`}
                    className="sign group flex h-full flex-col overflow-hidden transition-[transform,border-color] hover:-translate-y-0.5 hover:border-fog-3"
                  >
                    <div
                      className="h-1.5 w-full"
                      style={{
                        background: `linear-gradient(90deg, ${m.brand.secondary}, ${m.brand.accent})`,
                      }}
                      aria-hidden="true"
                    />
                    <div className="flex flex-1 flex-col p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-display text-[17px] leading-tight font-semibold tracking-tight">
                          {m.name}
                        </div>
                        {price ? (
                          <span className="tabular shrink-0 text-[12px] text-fog-3">{price}</span>
                        ) : null}
                      </div>
                      {m.tagline ? (
                        <p className="mt-1 text-[13px] text-fog-2">{m.tagline}</p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {status ? (
                          <Badge tone={status.open ? "mint" : "neutral"}>{status.label}</Badge>
                        ) : null}
                        {eta ? <Badge>{eta}</Badge> : null}
                        {m.tags.slice(0, 2).map((t) => (
                          <Badge key={t}>{t.replace(/-/g, " ")}</Badge>
                        ))}
                      </div>
                      <div className="font-display mt-4 flex items-center gap-1 text-[13px] font-semibold text-fog-2 transition-colors group-hover:text-sodium">
                        Take me there
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

function phaseOf(event: CityEvent, now: Date): { time: string; day: string; live: boolean } {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const live = now >= start && now < end;
  const tz = eventZone(event);
  const time = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  const sameDay =
    start.toLocaleDateString("en-US", { timeZone: tz }) ===
    now.toLocaleDateString("en-US", { timeZone: tz });
  const zone =
    start.toLocaleTimeString("en-US", { timeZoneName: "short", timeZone: tz }).split(" ").pop() ??
    "";
  const day = sameDay
    ? `Tonight · ${zone}`
    : `${start.toLocaleDateString("en-US", { weekday: "short", timeZone: tz })} · ${zone}`;
  return { time, day, live };
}

function eventZone(event: CityEvent): string {
  const tz = event.config?.["timezone"];
  return typeof tz === "string" ? tz : "America/Chicago";
}
