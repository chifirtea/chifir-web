import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clockOffsetMs, setClockOffsetMs } from "./clock";
import { clockHeaders, initClientClock } from "./clientClock";

/** Minimal browser shim: `initClientClock` only needs `window.sessionStorage`. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

describe("initClientClock", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = fakeStorage();
    (globalThis as unknown as { window: unknown }).window = { sessionStorage: storage };
    setClockOffsetMs(0);
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    setClockOffsetMs(0);
  });

  it("applies the page's offset and remembers it for the tab", () => {
    initClientClock(90_000, "2026-10-01T19:58:30");
    expect(clockOffsetMs()).toBe(90_000);
    expect(clockHeaders()).toEqual({ "x-chifir-clock-offset": "90000" });
    setClockOffsetMs(0);
    initClientClock(); // another page in the same tab, no param
    expect(clockOffsetMs()).toBe(90_000);
  });

  it("keeps the running clock on a reload with the same ?clock= value, re-anchors on a new one", () => {
    initClientClock(90_000, "2026-10-01T19:58:30");
    // Thirty seconds later the page reloads: the server recomputes a smaller offset for the same instant.
    initClientClock(60_000, "2026-10-01T19:58:30");
    expect(clockOffsetMs()).toBe(90_000);
    initClientClock(5_000, "+5");
    expect(clockOffsetMs()).toBe(5_000);
  });

  it("clears the stored clock when the offset is zero", () => {
    initClientClock(90_000, "x");
    initClientClock(0, "+0");
    expect(clockOffsetMs()).toBe(0);
    expect(storage.getItem("chifir.clockOffset.v1")).toBeNull();
    expect(clockHeaders()).toEqual({});
  });
});
