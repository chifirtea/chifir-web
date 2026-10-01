import { describe, expect, it } from "vitest";
import {
  availabilityProblem,
  eventPhase,
  nextPhaseChangeAt,
  parcelOccupiedAt,
  productAvailability,
} from "./status";

const T0 = Date.parse("2026-09-30T01:00:00Z"); // 8 PM Chicago on Sep 29 (CDT)
const event = {
  startsAt: new Date(T0).toISOString(),
  endsAt: new Date(T0 + 2 * 3600_000).toISOString(),
  status: "scheduled" as const,
};

describe("eventPhase", () => {
  it("derives scheduled / live / ended from the clock, regardless of the stored status", () => {
    expect(eventPhase(event, T0 - 1)).toBe("scheduled");
    expect(eventPhase(event, T0)).toBe("live");
    expect(eventPhase(event, T0 + 2 * 3600_000 - 1)).toBe("live");
    expect(eventPhase(event, T0 + 2 * 3600_000)).toBe("ended");
    expect(eventPhase({ ...event, status: "live" }, T0 - 1)).toBe("scheduled");
  });
  it("treats cancelled as ended", () => {
    expect(eventPhase({ ...event, status: "cancelled" }, T0 + 10)).toBe("ended");
  });
});

describe("nextPhaseChangeAt", () => {
  it("returns the soonest future boundary across events and parcel tenancies", () => {
    const parcels = [
      {
        occupiedFrom: new Date(T0 + 30_000).toISOString(),
        occupiedUntil: new Date(T0 + 60_000).toISOString(),
      },
    ];
    expect(nextPhaseChangeAt([event], parcels, T0 - 10_000)).toBe(T0);
    expect(nextPhaseChangeAt([event], parcels, T0 + 1)).toBe(T0 + 30_000);
    expect(nextPhaseChangeAt([event], parcels, T0 + 45_000)).toBe(T0 + 60_000);
    expect(nextPhaseChangeAt([event], parcels, T0 + 3 * 3600_000)).toBeNull();
  });
  it("ignores cancelled events", () => {
    expect(nextPhaseChangeAt([{ ...event, status: "cancelled" }], [], T0 - 1)).toBeNull();
  });
});

describe("product availability", () => {
  const drop = { availableFrom: event.startsAt };
  it("is upcoming before the window, available inside it, closed after availableUntil", () => {
    expect(productAvailability(drop, T0 - 1)).toEqual({
      state: "upcoming",
      availableFrom: event.startsAt,
    });
    expect(productAvailability(drop, T0)).toEqual({ state: "available" });
    expect(productAvailability({ availableUntil: event.endsAt }, T0 + 3 * 3600_000)).toEqual({
      state: "closed",
      availableUntil: event.endsAt,
    });
    expect(productAvailability({}, T0)).toEqual({ state: "available" });
  });
  it("explains why a product cannot be bought", () => {
    expect(availabilityProblem(drop, T0 - 1)).toMatch(/^Drops at /);
    expect(availabilityProblem(drop, T0)).toBeNull();
    expect(availabilityProblem({ availableUntil: event.endsAt }, T0 + 3 * 3600_000)).toMatch(
      /no longer available/,
    );
  });
});

describe("parcelOccupiedAt", () => {
  it("open-ended tenancy is always occupied; windows are half-open [from, until)", () => {
    expect(parcelOccupiedAt({}, T0)).toBe(true);
    const w = { occupiedFrom: event.startsAt, occupiedUntil: event.endsAt };
    expect(parcelOccupiedAt(w, T0 - 1)).toBe(false);
    expect(parcelOccupiedAt(w, T0)).toBe(true);
    expect(parcelOccupiedAt(w, T0 + 2 * 3600_000)).toBe(false);
  });
});
