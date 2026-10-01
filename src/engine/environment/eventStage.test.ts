/* eslint-disable no-restricted-imports -- test only: seed modules never reach the client bundle */
import { describe, expect, it } from "vitest";
import type { CityEvent } from "@/types/domain";
import { districts, parcels } from "@/data/seed/districts";
import { employees, merchants } from "@/data/seed/merchants";
import { products } from "@/data/seed/products";
import { rewards } from "@/data/seed/rewards";
import { buildEvents } from "@/data/seed/events";
import { buildOffers } from "@/data/seed/offers";
import type { CitySnapshot } from "@/lib/data/types";
import { buildCityIndex } from "@/city/cityIndex";
import {
  DEFAULT_GATHER_FROM_MIN,
  formatCountdown,
  gatherFromMinutes,
  gatheringEvents,
  isGathering,
  nextGatherChangeAt,
  screenMode,
  stageEvent,
  upcomingEventsAt,
} from "./eventStage";

const NOW = new Date("2026-09-30T20:00:00Z");

function snapshot(now = NOW): CitySnapshot {
  return {
    districts,
    parcels,
    merchants,
    products,
    employees,
    events: buildEvents(now),
    offers: buildOffers(now),
    rewards,
    generatedAt: now.toISOString(),
  };
}

const event = (over: Partial<CityEvent> = {}): CityEvent => ({
  id: "e1",
  slug: "e1",
  title: "Test",
  description: "",
  kind: "launch",
  status: "scheduled",
  productIds: [],
  startsAt: "2026-10-01T20:00:00Z",
  endsAt: "2026-10-01T22:00:00Z",
  config: {},
  ...over,
});

const T = (iso: string) => Date.parse(iso);

describe("gatherFromMinutes", () => {
  it("defaults to 30 and accepts numbers or numeric strings", () => {
    expect(gatherFromMinutes(event())).toBe(DEFAULT_GATHER_FROM_MIN);
    expect(gatherFromMinutes(event({ config: { gatherFrom: 45 } }))).toBe(45);
    expect(gatherFromMinutes(event({ config: { gatherFrom: "15" } }))).toBe(15);
  });

  it("rejects nonsense and caps absurd values", () => {
    expect(gatherFromMinutes(event({ config: { gatherFrom: -5 } }))).toBe(DEFAULT_GATHER_FROM_MIN);
    expect(gatherFromMinutes(event({ config: { gatherFrom: "soon" } }))).toBe(DEFAULT_GATHER_FROM_MIN);
    expect(gatherFromMinutes(event({ config: { gatherFrom: 1e9 } }))).toBe(24 * 60);
  });
});

describe("isGathering / nextGatherChangeAt", () => {
  const e = event();
  it("gathers from gatherFrom minutes before the start until the end", () => {
    expect(isGathering(e, T("2026-10-01T19:29:59Z"))).toBe(false);
    expect(isGathering(e, T("2026-10-01T19:30:00Z"))).toBe(true);
    expect(isGathering(e, T("2026-10-01T21:59:59Z"))).toBe(true);
    expect(isGathering(e, T("2026-10-01T22:00:00Z"))).toBe(false);
  });

  it("never gathers for a cancelled event", () => {
    expect(isGathering(event({ status: "cancelled" }), T("2026-10-01T20:30:00Z"))).toBe(false);
  });

  it("reports the next boundary ahead of now", () => {
    expect(nextGatherChangeAt([e], T("2026-10-01T10:00:00Z"))).toBe(T("2026-10-01T19:30:00Z"));
    expect(nextGatherChangeAt([e], T("2026-10-01T20:30:00Z"))).toBe(T("2026-10-01T22:00:00Z"));
    expect(nextGatherChangeAt([e], T("2026-10-01T23:00:00Z"))).toBeNull();
    expect(nextGatherChangeAt([event({ status: "cancelled" })], T("2026-10-01T10:00:00Z"))).toBeNull();
  });
});

describe("formatCountdown", () => {
  it("renders HH:MM:SS, days when needed, and never goes negative", () => {
    expect(formatCountdown(14 * 60_000 + 59_000)).toBe("00:14:59");
    expect(formatCountdown(3 * 3600_000)).toBe("03:00:00");
    expect(formatCountdown(2 * 86_400_000 + 3 * 3600_000)).toBe("2d 03:00:00");
    expect(formatCountdown(-5000)).toBe("00:00:00");
  });
});

describe("screenMode", () => {
  const e = event();
  it("follows the clock, never the stored status", () => {
    expect(screenMode(null, 0)).toBe("idle");
    expect(screenMode(e, T("2026-10-01T19:00:00Z"))).toBe("countdown");
    expect(screenMode(e, T("2026-10-01T20:00:00Z"))).toBe("live");
    expect(screenMode(e, T("2026-10-01T22:00:00Z"))).toBe("idle");
    expect(screenMode(event({ status: "live" }), T("2026-10-01T19:00:00Z"))).toBe("countdown");
  });
});

describe("stageEvent with the seed", () => {
  // The seed's drop runs 8–10 PM Chicago on the day of `now`; 20:00Z is 3 PM Chicago.
  const index = buildCityIndex(snapshot(), NOW.getTime());
  const venue = parcels.find((p) => p.tier === "venue")!;

  it("shows the drop at the pop-up next door before the venue's own Friday show", () => {
    const e = stageEvent(index, venue, NOW.getTime());
    expect(e?.slug).toBe("northline-night-shift");
  });

  it("prefers a live event over a sooner-scheduled one", () => {
    const drop = index.eventsBySlug["northline-night-shift"]!;
    const during = Date.parse(drop.startsAt) + 60_000;
    const live = buildCityIndex(snapshot(), during);
    expect(stageEvent(live, venue, during)?.slug).toBe("northline-night-shift");
    expect(screenMode(stageEvent(live, venue, during), during)).toBe("live");
  });

  it("falls through to the venue's event once the drop has ended", () => {
    const drop = index.eventsBySlug["northline-night-shift"]!;
    const after = Date.parse(drop.endsAt) + 60_000;
    const later = buildCityIndex(snapshot(), after);
    expect(stageEvent(later, venue, after)?.slug).toBe("friday-live-set");
  });

  it("gathers a crowd at the pop-up parcel from 30 minutes before the drop", () => {
    const drop = index.eventsBySlug["northline-night-shift"]!;
    const before = Date.parse(drop.startsAt) - 31 * 60_000;
    const within = Date.parse(drop.startsAt) - 29 * 60_000;
    expect(gatheringEvents(buildCityIndex(snapshot(), before), before).map((g) => g.parcel.slug)).not.toContain("es-pop1");
    expect(gatheringEvents(buildCityIndex(snapshot(), within), within).map((g) => g.parcel.slug)).toContain("es-pop1");
  });

  it("lists upcoming events live-first by the clock", () => {
    const drop = index.eventsBySlug["northline-night-shift"]!;
    const during = Date.parse(drop.startsAt) + 60_000;
    const list = upcomingEventsAt(index.snapshot.events, during);
    // Burger Rush (5–9 PM) is live alongside the drop; both lead, by start time, then Friday's show.
    expect(list.slice(0, 2).map((e) => e.slug)).toEqual(["burger-rush", "northline-night-shift"]);
    expect(list[2]?.slug).toBe("friday-live-set");
  });
});
