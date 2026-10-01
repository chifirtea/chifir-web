import { describe, expect, it } from "vitest";
import type { OpeningHours } from "@/types/domain";
import { formatClock, houseNumber, localClock, openStatus } from "./hours";

const hours: OpeningHours = {
  timezone: "America/Chicago",
  weekly: {
    mon: [{ open: "11:30", close: "23:00" }],
    tue: [{ open: "11:30", close: "23:00" }],
    wed: [{ open: "11:30", close: "23:00" }],
    thu: [{ open: "11:30", close: "23:00" }],
    fri: [{ open: "11:30", close: "01:00" }],
    sat: [{ open: "11:30", close: "01:00" }],
    // Sunday closed.
  },
};

// 2026-09-30 is a Wednesday. Chicago is UTC-5 in September.
const chicago = (h: number, m = 0, day = 30) => Date.UTC(2026, 8, day, h + 5, m);

describe("openStatus", () => {
  it("is open inside an interval and says until when", () => {
    expect(openStatus(hours, chicago(19, 50))).toEqual({ open: true, label: "Open", detail: "Until 11 PM" });
  });

  it("announces the next opening earlier in the day", () => {
    expect(openStatus(hours, chicago(9, 0))).toEqual({ open: false, label: "Opens 11:30 AM", detail: "Closed" });
  });

  it("counts a late close past midnight as still open", () => {
    // Saturday 00:30 local: Friday's interval closes at 01:00.
    const satEarly = Date.UTC(2026, 9, 3, 0 + 5, 30);
    expect(openStatus(hours, satEarly)).toEqual({ open: true, label: "Open", detail: "Until 1 AM" });
  });

  it("points at the next day with hours when today has none", () => {
    // Sunday Oct 4 noon local.
    const sunday = Date.UTC(2026, 9, 4, 12 + 5, 0);
    expect(openStatus(hours, sunday)).toEqual({ open: false, label: "Closed", detail: "Back 11:30 AM" });
  });

  it("returns null without hours and survives an unknown zone", () => {
    expect(openStatus(undefined, 0)).toBeNull();
    const local = localClock("Not/AZone", chicago(12));
    expect(local.day).toBeGreaterThanOrEqual(0);
    expect(local.minutes).toBeGreaterThanOrEqual(0);
  });
});

describe("formatClock", () => {
  it("formats 24h strings as short 12h labels", () => {
    expect(formatClock("23:00")).toBe("11 PM");
    expect(formatClock("11:30")).toBe("11:30 AM");
    expect(formatClock("00:00")).toBe("12 AM");
    expect(formatClock("12:05")).toBe("12:05 PM");
  });
});

describe("houseNumber", () => {
  it("uses the street number from the address when present", () => {
    expect(houseNumber("214 Ember Row", { x: 58, z: -14 })).toBe("214");
    expect(houseNumber("  88 Lantern Lane", { x: 0, z: 0 })).toBe("88");
  });

  it("derives a stable number from the parcel otherwise", () => {
    expect(houseNumber(undefined, { x: 58, z: -14 })).toBe("140");
    expect(houseNumber("Unit B, Market Hall", { x: 58, z: -14 })).toBe("140");
    expect(houseNumber(undefined, { x: 82, z: -14 })).not.toBe(houseNumber(undefined, { x: 58, z: -14 }));
  });
});
