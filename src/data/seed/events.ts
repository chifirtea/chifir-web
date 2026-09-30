import type { CityEvent } from "@/types/domain";
import { sid } from "./ids";
import { NIGHT_SHIFT_SLUGS } from "./products";
import { CITY_TZ, addMinutes, dropWindow, todayAt, upcomingWeekdayAt } from "./time";

const img = (keywords: string, lock: number) =>
  `https://loremflickr.com/1280/720/${keywords}/all?lock=${lock}`;

/**
 * Stored `status` is always "scheduled" (or "cancelled"); the live/ended phase is derived from
 * the clock everywhere (`lib/events/status.ts`), so nothing here goes stale between rebuilds.
 */
export function buildEvents(now = new Date()): CityEvent[] {
  const drop = dropWindow(now);
  const live = upcomingWeekdayAt(CITY_TZ, 5, 21, 0, now);
  const rush = todayAt(CITY_TZ, 17, 0, now);
  const rushEnd = todayAt(CITY_TZ, 21, 0, now);
  return [
    {
      id: sid.event("northline-night-shift"),
      slug: "northline-night-shift",
      title: "Northline — Night Shift",
      description:
        "Four hoodies, one night. The Night Shift collection launches at 8 PM at the Event Square pop-up: heavyweight fleece in Ink, Signal and Bone, plus a zip. Every hoodie ships with its avatar twin, and buying during the drop earns the Founder badge. 10% off the collection while the pop-up is open.",
      kind: "launch",
      status: "scheduled",
      merchantId: sid.merchant("northline-supply"),
      districtId: sid.district("event-square"),
      parcelId: sid.parcel("es-pop1"),
      offerId: sid.offer("northline-night-shift-launch"),
      productId: sid.product("northline-supply", "night-shift-hoodie-ink"),
      productIds: NIGHT_SHIFT_SLUGS.map((slug) => sid.product("northline-supply", slug)),
      rewardId: sid.reward("northline-founder-badge"),
      startsAt: drop.start.toISOString(),
      endsAt: drop.end.toISOString(),
      capacity: 500,
      heroImageUrl: img("hoodie,streetwear,night", 301),
      // Venue screens: add `heroVideoUrl` (loop) or `livestreamUrl` here when the brand has them.
      config: { countdown: true, gatherFrom: 30, popupOpensAtStart: true },
    },
    {
      id: sid.event("burger-rush"),
      slug: "burger-rush",
      title: "Burger Rush",
      description:
        "Ember & Oak takes 20% off every burger from 5 to 9 PM. Real discount, real burgers, delivered.",
      kind: "promo",
      status: "scheduled",
      merchantId: sid.merchant("ember-and-oak"),
      districtId: sid.district("food-street"),
      parcelId: sid.parcel("fs-n1"),
      offerId: sid.offer("ember-burger-rush"),
      productIds: [],
      startsAt: rush.toISOString(),
      endsAt: rushEnd.toISOString(),
      config: {},
    },
    {
      id: sid.event("friday-live-set"),
      slug: "friday-live-set",
      title: "Friday Live Set at The Hall",
      description:
        "A live DJ set streamed onto the big screens. General admission is a real ticket.",
      kind: "concert",
      status: "scheduled",
      merchantId: sid.merchant("the-hall"),
      districtId: sid.district("event-square"),
      parcelId: sid.parcel("es-venue"),
      productId: sid.product("the-hall", "friday-live-set-ga"),
      productIds: [],
      startsAt: live.toISOString(),
      endsAt: addMinutes(live, 150).toISOString(),
      capacity: 300,
      heroImageUrl: img("dj,concert,lights", 302),
      config: { livestream: true },
    },
  ];
}
