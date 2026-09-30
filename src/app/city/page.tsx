import type { Metadata } from "next";
import { getDataSource } from "@/lib/data";
import { parseClockOverride } from "@/lib/time/clock";
import { allowClockOverride } from "@/lib/time/serverClock";
import { CityAppLoader } from "./CityAppLoader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chifir — the city",
  description: "Walk through real restaurants, stores and events. Ask for anything. Get it IRL.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
};

/** Static mode builds its time-relative seed for the demo clock; production data ignores it. */
function snapshotOptions(clockOffsetMs: number | null): { now?: Date } {
  return clockOffsetMs !== null ? { now: new Date(Date.now() + clockOffsetMs) } : {};
}

export default async function CityPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const to = first(sp.to)?.slice(0, 120);
  const ask = first(sp.ask)?.slice(0, 500);
  const checkout = first(sp.checkout);
  const clockOffsetMs = allowClockOverride()
    ? parseClockOverride(first(sp.clock)?.slice(0, 40))
    : null;
  const snapshot = await getDataSource().getCitySnapshot(snapshotOptions(clockOffsetMs));
  return (
    <CityAppLoader
      snapshot={snapshot}
      deepLinkTo={to}
      ask={ask}
      checkout={checkout}
      {...(clockOffsetMs !== null ? { clockOffsetMs } : {})}
    />
  );
}
