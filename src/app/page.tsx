import Link from "next/link";
import { buildCityIndex } from "@/city/cityIndex";
import { AskTheCity } from "@/features/landing/AskTheCity";
import { HowItWorks } from "@/features/landing/HowItWorks";
import { LandingFooter } from "@/features/landing/LandingFooter";
import { Skyline } from "@/features/landing/Skyline";
import { TonightStrip, type TonightEvent } from "@/features/landing/TonightStrip";
import styles from "@/features/landing/landing.module.css";
import { openNowStatus } from "@/features/hud/openNow";
import { getDataSource } from "@/lib/data";
import type { Merchant } from "@/types/domain";

/** Events and "open now" are time-relative; refresh the page a few times an hour. */
export const revalidate = 300;

const EVENT_COUNT = 3;
const MERCHANT_COUNT = 6;

export default async function LandingPage() {
  const snapshot = await getDataSource().getCitySnapshot();
  const index = buildCityIndex(snapshot);
  const now = new Date();

  const placed: Merchant[] = Object.values(index.merchantsById).filter((m) => index.parcelByMerchant[m.id]);
  const palettes = placed.map((m) => ({ slug: m.slug, name: m.name, brand: m.brand }));

  const events: TonightEvent[] = snapshot.events
    .filter((e) => e.status !== "cancelled" && Date.parse(e.endsAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, EVENT_COUNT)
    .map((event) => ({ event, merchant: event.merchantId ? index.merchantsById[event.merchantId] : undefined }));

  const merchants = [...placed]
    .sort((a, b) => {
      const openA = openNowStatus(a.openingHours, now)?.open ? 1 : 0;
      const openB = openNowStatus(b.openingHours, now)?.open ? 1 : 0;
      return openB - openA || (b.rating ?? 0) - (a.rating ?? 0);
    })
    .slice(0, MERCHANT_COUNT);

  return (
    <main className="min-h-screen bg-night text-fog">
      <section className={`relative isolate flex min-h-svh flex-col overflow-hidden ${styles.hero}`}>
        <Skyline palettes={palettes} className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[44%] min-h-[220px] w-full" />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[52%]"
          style={{ background: "linear-gradient(180deg, rgba(15,17,22,0) 0%, rgba(15,17,22,0.35) 100%)" }}
          aria-hidden="true"
        />

        <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-5">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight">
            Chifir
          </Link>
          <a href="#tonight" className="text-[13px] text-fog-2 hover:text-fog">
            Tonight in the city ↓
          </a>
        </header>

        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 pt-12 pb-[46%] sm:pb-[30%] lg:pb-[22%]">
          <div className="max-w-3xl">
            <div className={`eyebrow ${styles.rise}`}>A city of real places</div>
            <h1
              className={`font-display mt-3 text-[clamp(2.75rem,9vw,6rem)] leading-[0.95] font-bold tracking-[-0.03em] text-balance ${styles.rise}`}
              style={{ animationDelay: "60ms" }}
            >
              What should we do tonight?
            </h1>
            <p className={`mt-5 max-w-xl text-[17px] leading-relaxed text-fog-2 ${styles.rise}`} style={{ animationDelay: "90ms" }}>
              Real restaurants, stores and events, built as a city you can walk through. Ask for what you want, or
              just wander in.
            </p>
            <div className="mt-8 max-w-2xl">
              <AskTheCity />
            </div>
          </div>
        </div>
      </section>

      <TonightStrip events={events} merchants={merchants} now={now} />
      <HowItWorks />
      <LandingFooter />
    </main>
  );
}
