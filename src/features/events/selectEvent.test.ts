import { describe, expect, it } from "vitest";
import type { CityEvent } from "@/types/domain";
import { formatCountdown, formatStart, pickEventForHud } from "./selectEvent";

const T0 = Date.parse("2026-10-01T01:00:00Z");
const H = 3600_000;

function ev(id: string, startOffsetMs: number, durationMs: number, kind: CityEvent["kind"] = "launch", status: CityEvent["status"] = "scheduled"): CityEvent {
  return {
    id,
    slug: id,
    title: id,
    description: "",
    kind,
    status,
    productIds: [],
    startsAt: new Date(T0 + startOffsetMs).toISOString(),
    endsAt: new Date(T0 + startOffsetMs + durationMs).toISOString(),
    config: {},
  };
}

describe("pickEventForHud", () => {
  it("prefers a live launch over a live promo, then the soonest upcoming event", () => {
    const events = [ev("promo", -H, 4 * H, "promo"), ev("drop", -10 * 60_000, 2 * H, "launch"), ev("later", 3 * H, H)];
    expect(pickEventForHud(events, T0)?.event.id).toBe("drop");
    expect(pickEventForHud(events, T0)?.phase).toBe("live");
  });
  it("a launch about to start beats a promo that is already running", () => {
    const events = [ev("promo", -H, 4 * H, "promo"), ev("drop", 75_000, 2 * H, "launch")];
    const picked = pickEventForHud(events, T0);
    expect(picked?.event.id).toBe("drop");
    expect(picked?.phase).toBe("scheduled");
    // …but a drop still hours away does not: the live thing is what is happening now.
    expect(pickEventForHud([ev("promo", -H, 4 * H, "promo"), ev("drop", 3 * H, 2 * H, "launch")], T0)?.event.id).toBe("promo");
  });
  it("picks the soonest scheduled event within the lookahead and ignores far-off ones", () => {
    const events = [ev("tomorrow-late", 30 * H, H), ev("soon", 2 * H, H), ev("sooner", 40 * 60_000, H)];
    const picked = pickEventForHud(events, T0);
    expect(picked?.event.id).toBe("sooner");
    expect(picked?.phase).toBe("scheduled");
    expect(pickEventForHud([ev("far", 30 * H, H)], T0)).toBeNull();
  });
  it("ignores ended and cancelled events", () => {
    expect(pickEventForHud([ev("done", -3 * H, H), ev("off", H, H, "launch", "cancelled")], T0)).toBeNull();
  });
});

describe("formatCountdown", () => {
  it("formats minutes:seconds under an hour and h:mm:ss above, never negative", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5000)).toBe("0:00");
    expect(formatCountdown(59_000)).toBe("0:59");
    expect(formatCountdown(12 * 60_000 + 34_000)).toBe("12:34");
    expect(formatCountdown(H + 5 * 60_000 + 9_000)).toBe("1:05:09");
  });
  it("rounds up so the last second reads 0:01, not 0:00", () => {
    expect(formatCountdown(400)).toBe("0:01");
  });
});

describe("formatStart", () => {
  it("names tomorrow and weekdays when the start is not today", () => {
    const todayStart = new Date(T0 + 2 * H).toISOString();
    expect(formatStart(todayStart, T0, "en-US")).not.toMatch(/tomorrow|Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
    const tomorrow = new Date(T0 + 24 * H).toISOString();
    expect(formatStart(tomorrow, T0, "en-US")).toMatch(/^tomorrow /);
  });
});
