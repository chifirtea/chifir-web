import type { CityEvent, CityEventPhase } from "@/types/domain";
import { eventPhase } from "@/lib/events/status";

/** The HUD shows at most one event: the most relevant live or upcoming one within this window. */
export const HUD_LOOKAHEAD_MS = 24 * 3600_000;
/** Under an hour the card counts down; beyond that it just names the time. */
export const COUNTDOWN_WINDOW_MS = 3600_000;

export interface HudEvent {
  event: CityEvent;
  phase: Exclude<CityEventPhase, "ended">;
}

export function pickEventForHud(
  events: ReadonlyArray<CityEvent>,
  now: number,
  lookaheadMs = HUD_LOOKAHEAD_MS,
): HudEvent | null {
  let best: { event: CityEvent; phase: HudEvent["phase"]; tier: number; start: number } | null = null;
  for (const e of events) {
    if (e.status === "cancelled") continue;
    const phase = eventPhase(e, now);
    if (phase === "ended") continue;
    const start = Date.parse(e.startsAt);
    if (phase === "scheduled" && start - now > lookaheadMs) continue;
    // Tiers: a live launch, then a launch about to start (a countdown is the point of the card),
    // then any other live event, then whatever comes next. A running promo must not hide a drop.
    const launch = rank(e) === 0;
    const tier =
      phase === "live" && launch ? 0 : phase === "scheduled" && launch && start - now <= COUNTDOWN_WINDOW_MS ? 1 : phase === "live" ? 2 : 3;
    if (
      !best ||
      tier < best.tier ||
      (tier === best.tier && (phase === "live" ? rank(e) < rank(best.event) || (rank(e) === rank(best.event) && start > best.start) : start < best.start))
    ) {
      best = { event: e, phase, tier, start };
    }
  }
  return best ? { event: best.event, phase: best.phase } : null;
}

const KIND_RANK: Record<CityEvent["kind"], number> = {
  launch: 0,
  live: 1,
  concert: 1,
  opening: 2,
  flash_deal: 3,
  promo: 4,
};
function rank(e: CityEvent): number {
  return KIND_RANK[e.kind] ?? 9;
}

/** "12:34" under an hour, "1:05:09" above it, "0:00" at zero. Never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
}

/** "8:00 PM" in the viewer's zone, with the day when it is not today. */
export function formatStart(iso: string, now: number, locale?: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const sameDay = d.toDateString() === new Date(now).toDateString();
  if (sameDay) return time;
  const tomorrow = new Date(now + 86_400_000).toDateString() === d.toDateString();
  return tomorrow ? `tomorrow ${time}` : `${d.toLocaleDateString(locale, { weekday: "short" })} ${time}`;
}
