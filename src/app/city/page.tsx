import type { Metadata } from "next";
import { getDataSource } from "@/lib/data";
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

export default async function CityPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const to = first(sp.to)?.slice(0, 120);
  const ask = first(sp.ask)?.slice(0, 500);
  const checkout = first(sp.checkout);
  const snapshot = await getDataSource().getCitySnapshot();
  return <CityAppLoader snapshot={snapshot} deepLinkTo={to} ask={ask} checkout={checkout} />;
}
