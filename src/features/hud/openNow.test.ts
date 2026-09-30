import { describe, expect, it } from "vitest";
import type { OpeningHours } from "@/types/domain";
import {
  formatClock,
  fulfillmentEtaLabel,
  openNowLabel,
  openNowStatus,
  priceLevelLabel,
} from "./openNow";

// September 2026 is CDT (UTC-5). 2026-09-30 is a Wednesday.
const chicago = (iso: string) => new Date(`${iso}-05:00`);

const diner: OpeningHours = {
  timezone: "America/Chicago",
  weekly: {
    mon: [{ open: "11:30", close: "23:00" }],
    tue: [{ open: "11:30", close: "23:00" }],
    wed: [{ open: "11:30", close: "23:00" }],
    thu: [{ open: "11:30", close: "23:00" }],
    fri: [{ open: "11:30", close: "01:00" }],
    sat: [{ open: "11:30", close: "01:00" }],
    sun: [{ open: "11:30", close: "23:00" }],
  },
};

describe("openNowStatus", () => {
  it("is open during a same-day interval and says when it closes", () => {
    expect(openNowStatus(diner, chicago("2026-09-30T13:00:00"))).toEqual({
      open: true,
      label: "Open · closes 11 PM",
      at: "23:00",
    });
  });

  it("says when it opens later the same day", () => {
    expect(openNowLabel(diner, chicago("2026-09-30T09:15:00"))).toBe("Opens 11:30 AM");
  });

  it("is open after midnight when yesterday's interval runs late", () => {
    // Saturday 00:30 local: Friday's 11:30–01:00 interval is still running.
    expect(openNowLabel(diner, chicago("2026-10-03T00:30:00"))).toBe("Open · closes 1 AM");
  });

  it("is closed after a late close and points to today's opening", () => {
    expect(openNowLabel(diner, chicago("2026-10-03T01:30:00"))).toBe("Opens 11:30 AM");
  });

  it("points to tomorrow after closing", () => {
    expect(openNowLabel(diner, chicago("2026-09-30T23:30:00"))).toBe("Opens tomorrow 11:30 AM");
  });

  it("skips days with no hours", () => {
    const weekendOnly: OpeningHours = {
      timezone: "America/Chicago",
      weekly: { sat: [{ open: "10:00", close: "18:00" }] },
    };
    expect(openNowLabel(weekendOnly, chicago("2026-09-30T12:00:00"))).toBe("Opens Sat 10 AM");
  });

  it("is 'Closed' when no day has hours", () => {
    expect(
      openNowStatus({ timezone: "America/Chicago", weekly: {} }, chicago("2026-09-30T12:00:00")),
    ).toEqual({
      open: false,
      label: "Closed",
    });
  });

  it("returns null without hours", () => {
    expect(openNowStatus(undefined)).toBeNull();
    expect(openNowLabel(undefined)).toBeNull();
  });

  it("evaluates in the merchant's zone, not the process zone", () => {
    const tokyo: OpeningHours = {
      timezone: "Asia/Tokyo",
      weekly: { thu: [{ open: "09:00", close: "17:00" }] },
    };
    // 2026-09-30T13:00 Chicago = 2026-10-01T03:00 Tokyo (Thursday, before opening).
    expect(openNowLabel(tokyo, chicago("2026-09-30T13:00:00"))).toBe("Opens 9 AM");
  });
});

describe("formatClock", () => {
  it("formats 12-hour clock without dead zeros", () => {
    expect(formatClock("19:00")).toBe("7 PM");
    expect(formatClock("22:30")).toBe("10:30 PM");
    expect(formatClock("09:05")).toBe("9:05 AM");
    expect(formatClock("00:30")).toBe("12:30 AM");
  });
  it("names midnight and noon", () => {
    expect(formatClock("00:00")).toBe("midnight");
    expect(formatClock("23:59")).toBe("midnight");
    expect(formatClock("24:00")).toBe("midnight");
    expect(formatClock("12:00")).toBe("noon");
  });
  it("passes through garbage untouched", () => {
    expect(formatClock("late")).toBe("late");
  });
});

describe("chip helpers", () => {
  it("renders price levels as dollar signs", () => {
    expect(priceLevelLabel(1)).toBe("$");
    expect(priceLevelLabel(4)).toBe("$$$$");
    expect(priceLevelLabel(undefined)).toBeNull();
  });
  it("prefers delivery, then pickup, then shipping, then booking", () => {
    expect(
      fulfillmentEtaLabel({
        provider: "simulated",
        delivery: { enabled: true, feeCents: 399, minutesMin: 25, minutesMax: 40 },
        pickup: { enabled: true, minutesMin: 10, minutesMax: 15 },
      }),
    ).toBe("25–40 min delivery");
    expect(
      fulfillmentEtaLabel({
        provider: "simulated",
        pickup: { enabled: true, minutesMin: 10, minutesMax: 15 },
      }),
    ).toBe("10–15 min pickup");
    expect(
      fulfillmentEtaLabel({
        provider: "shippo",
        shipping: { enabled: true, feeCents: 900, daysMin: 3, daysMax: 5 },
      }),
    ).toBe("3–5 day shipping");
    expect(
      fulfillmentEtaLabel({ provider: "simulated", booking: { enabled: true, slotMinutes: 60 } }),
    ).toBe("Bookings");
    expect(fulfillmentEtaLabel({ provider: "simulated" })).toBeNull();
    expect(fulfillmentEtaLabel(undefined)).toBeNull();
  });
});
