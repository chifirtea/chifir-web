import type { AnalyticsEventMap, AnalyticsEventName, AnalyticsRecord } from "./events";

/**
 * Browser analytics client: typed `track()`, batching, beacon flush on hide.
 * Safe to import from server code (all browser access is guarded); no-ops there.
 */

const ANON_KEY = "chifir.aid";
const SESSION_KEY = "chifir.sid";
const ENDPOINT = "/api/analytics";
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_AT = 20;

let queue: AnalyticsRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let userId: string | undefined;
let device: AnalyticsRecord["device"] | undefined;
let installed = false;

const isBrowser = () => typeof window !== "undefined";

function readOrCreate(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    storage.setItem(key, id);
    return id;
  } catch {
    return "ephemeral";
  }
}

export function getAnonymousId(): string {
  return isBrowser() ? readOrCreate(localStorage, ANON_KEY) : "server";
}

export function getSessionId(): string {
  return isBrowser() ? readOrCreate(sessionStorage, SESSION_KEY) : "server";
}

const SESSION_STARTED_KEY = "chifir.sid.started";

/**
 * Emits `session_started` exactly once per browser session (tab). Every funnel in
 * docs/ANALYTICS.md starts here; later page loads in the same tab only emit `app_loaded`.
 */
export function trackSessionStart(extra: { party?: boolean } = {}): void {
  if (!isBrowser()) return;
  try {
    const sid = getSessionId();
    if (sessionStorage.getItem(SESSION_STARTED_KEY) === sid) return;
    sessionStorage.setItem(SESSION_STARTED_KEY, sid);
  } catch {
    // Private mode: fall through and count the start anyway.
  }
  track("session_started", {
    path: window.location.pathname,
    ...(document.referrer ? { referrer: document.referrer.slice(0, 200) } : {}),
    ...(extra.party !== undefined ? { party: extra.party } : {}),
  });
}

export function setAnalyticsUser(id: string | null): void {
  userId = id ?? undefined;
}

export function setAnalyticsDevice(info: NonNullable<AnalyticsRecord["device"]>): void {
  device = info;
}

function install(): void {
  if (installed || !isBrowser()) return;
  installed = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("pagehide", () => flush(true));
}

export function track<N extends AnalyticsEventName>(name: N, props: AnalyticsEventMap[N]): void {
  if (!isBrowser()) return;
  install();
  const record: AnalyticsRecord<N> = {
    name,
    props,
    ts: Date.now(),
    sessionId: getSessionId(),
    anonymousId: getAnonymousId(),
    ...(userId ? { userId } : {}),
    ...(device ? { device } : {}),
  };
  queue.push(record as AnalyticsRecord);
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[analytics] ${name}`, props);
  }
  if (queue.length >= FLUSH_AT) {
    flush();
  } else if (!timer) {
    timer = setTimeout(() => flush(), FLUSH_INTERVAL_MS);
  }
}

export function flush(useBeacon = false): void {
  if (!isBrowser() || queue.length === 0) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const batch = queue;
  queue = [];
  const body = JSON.stringify({ records: batch });
  if (useBeacon && typeof navigator.sendBeacon === "function") {
    const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    if (ok) return;
  }
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Analytics must never break the product; drop on failure.
  });
}
