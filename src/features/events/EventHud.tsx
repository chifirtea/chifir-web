"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Navigation, X, Zap } from "lucide-react";
import { guideTo, teleportTo } from "@/city/cityActions";
import { useCityStore } from "@/city/cityStore";
import { distance2D, resolveNavTarget } from "@/city/navigation";
import { playerRig } from "@/engine/player/playerRig";
import { useWorldStore } from "@/engine/store/worldStore";
import { track } from "@/lib/analytics/client";
import { cn } from "@/lib/utils/cn";
import { useEventPanelStore } from "./eventPanelStore";
import { COUNTDOWN_WINDOW_MS, formatCountdown, formatStart, pickEventForHud } from "./selectEvent";
import { useEventClock } from "./useEventClock";

/** Within this distance of the event's door, "Take me there" becomes a waypoint instead of a jump. */
const GUIDE_WITHIN_M = 45;
/** Standing this close to the event's parcel counts as having joined it. */
const JOIN_RADIUS_M = 14;
const DISMISS_PREFIX = "chifir.eventHud.dismissed.";

function dismissed(eventId: string, phase: string): boolean {
  try {
    return sessionStorage.getItem(DISMISS_PREFIX + eventId) === phase;
  } catch {
    return false;
  }
}

/**
 * "Something is happening" card under the waypoint chevron: a live countdown to the next event,
 * a pulse while it is live, a tap into its sheet and a one-tap way there. Hidden indoors and when
 * nothing is scheduled within a day.
 */
export function EventHud() {
  const index = useCityStore((s) => s.index);
  const onStreet = useWorldStore((s) => s.location.kind === "street");
  const ready = useWorldStore((s) => s.ready);
  const openPanel = useEventPanelStore((s) => s.open);
  const now = useEventClock(ready);
  const picked = useMemo(() => (index ? pickEventForHud(index.snapshot.events, now) : null), [index, now]);
  const [hidden, setHidden] = useState<string | null>(null);

  const event = picked?.event;
  const phase = picked?.phase;
  const merchant = event?.merchantId ? index?.merchantsById[event.merchantId] : undefined;
  const key = event ? `${event.id}:${phase}` : null;

  // Analytics: one `event_viewed` per phase shown, one `event_joined` per phase when the player arrives.
  const viewedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!event || !phase || !key || viewedKey.current === key) return;
    viewedKey.current = key;
    track("event_viewed", { eventId: event.id, phase, source: "hud" });
  }, [event, phase, key]);

  const joinedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!index || !event || !phase || !onStreet || !key || joinedKey.current === key) return;
    const target = resolveNavTarget({ kind: "event", eventId: event.id }, index);
    if (!target) return;
    const poll = setInterval(() => {
      if (joinedKey.current === key) return;
      if (distance2D(playerRig, target.pose) <= JOIN_RADIUS_M) {
        joinedKey.current = key;
        track("event_joined", { eventId: event.id, phase, via: "walk" });
      }
    }, 500);
    return () => clearInterval(poll);
  }, [index, event, phase, onStreet, key]);

  if (!index || !event || !phase || !onStreet || !ready) return null;
  if (hidden === key || dismissed(event.id, phase)) return null;

  const msToStart = Date.parse(event.startsAt) - now;
  const counting = phase === "scheduled" && msToStart <= COUNTDOWN_WINDOW_MS;
  const label =
    phase === "live"
      ? event.kind === "launch"
        ? "Live now · pop-up open"
        : "Live now"
      : counting
        ? "Starts in"
        : `Starts ${formatStart(event.startsAt, now)}`;

  const go = () => {
    const target = resolveNavTarget({ kind: "event", eventId: event.id }, index);
    const near = target ? distance2D(playerRig, target.pose) <= GUIDE_WITHIN_M : false;
    const ok = near
      ? guideTo({ kind: "event", eventId: event.id }, "hud")
      : teleportTo({ kind: "event", eventId: event.id }, "hud");
    if (ok && !near && joinedKey.current !== key) {
      joinedKey.current = key;
      track("event_joined", { eventId: event.id, phase, via: "teleport" });
    }
  };
  const dismiss = () => {
    setHidden(key);
    try {
      sessionStorage.setItem(DISMISS_PREFIX + event.id, phase);
    } catch {
      // ignore
    }
  };

  return (
    <div
      data-testid="event-hud"
      data-phase={phase}
      className={cn(
        "sign pointer-events-auto flex max-w-[min(92vw,420px)] items-stretch overflow-hidden",
        phase === "live" && "ring-1 ring-mint/40",
      )}
    >
      <button
        type="button"
        onClick={() => openPanel(event.id)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-white/5"
        aria-label={`${event.title}: ${label}`}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            phase === "live" ? "bg-mint/15 text-mint" : "bg-signal/15 text-signal",
          )}
          style={merchant ? { boxShadow: `inset 0 0 0 1px ${merchant.brand.accent}55` } : undefined}
          aria-hidden="true"
        >
          {phase === "live" ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-mint" />
            </span>
          ) : (
            <Zap className="h-4 w-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight">{event.title}</span>
          <span className="block truncate text-xs text-fog-2">
            {merchant ? `${merchant.name} · ` : ""}
            {label}
            {counting ? (
              <>
                {" "}
                <span data-testid="event-hud-countdown" className="tabular font-medium text-fog">
                  {formatCountdown(msToStart)}
                </span>
              </>
            ) : null}
          </span>
        </span>
      </button>
      <button
        type="button"
        data-testid="event-hud-go"
        onClick={go}
        aria-label="Take me there"
        title="Take me there"
        className="flex min-h-11 w-11 shrink-0 items-center justify-center border-l border-line text-fog-2 hover:bg-white/5 hover:text-sodium"
      >
        <Navigation className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide"
        className="flex min-h-11 w-9 shrink-0 items-center justify-center border-l border-line text-fog-3 hover:bg-white/5 hover:text-fog"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
