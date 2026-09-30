import type { CityEvent } from "@/types/domain";
import { sid } from "./ids";
import { CITY_TZ, addMinutes, todayAt, upcomingWeekdayAt } from "./time";

export function buildEvents(now = new Date()): CityEvent[] {
  const drop = upcomingWeekdayAt(CITY_TZ, 5, 19, 0, now);
  const live = upcomingWeekdayAt(CITY_TZ, 5, 21, 0, now);
  const rush = todayAt(CITY_TZ, 17, 0, now);
  const rushEnd = todayAt(CITY_TZ, 21, 0, now);
  const t = now.getTime();
  const rushStatus: CityEvent["status"] =
    t >= rush.getTime() && t < rushEnd.getTime() ? "live" : t >= rushEnd.getTime() ? "ended" : "scheduled";
  return [
    {
      id: sid.event("northline-winter-drop"),
      slug: "northline-winter-drop",
      title: "Northline Winter Drop — World Premiere",
      description:
        "Doors open at 7. The Founders Longsleeve goes on sale for one hour only. Everyone who buys gets the avatar version and the Founder badge.",
      kind: "launch",
      status: "scheduled",
      merchantId: sid.merchant("northline-supply"),
      districtId: sid.district("event-square"),
      parcelId: sid.parcel("es-venue"),
      productId: sid.product("northline-supply", "founders-longsleeve"),
      rewardId: sid.reward("northline-founder-badge"),
      startsAt: drop.toISOString(),
      endsAt: addMinutes(drop, 120).toISOString(),
      config: { countdown: true },
    },
    {
      id: sid.event("burger-rush"),
      slug: "burger-rush",
      title: "Burger Rush",
      description: "Ember & Oak takes 20% off every burger from 5 to 9 PM. Real discount, real burgers, delivered.",
      kind: "promo",
      status: rushStatus,
      merchantId: sid.merchant("ember-and-oak"),
      districtId: sid.district("food-street"),
      parcelId: sid.parcel("fs-n1"),
      offerId: sid.offer("ember-burger-rush"),
      startsAt: rush.toISOString(),
      endsAt: rushEnd.toISOString(),
      config: {},
    },
    {
      id: sid.event("friday-live-set"),
      slug: "friday-live-set",
      title: "Friday Live Set at The Hall",
      description: "A live DJ set streamed onto the big screens after the drop. General admission is a real ticket.",
      kind: "concert",
      status: "scheduled",
      merchantId: sid.merchant("the-hall"),
      districtId: sid.district("event-square"),
      parcelId: sid.parcel("es-venue"),
      productId: sid.product("the-hall", "friday-live-set-ga"),
      startsAt: live.toISOString(),
      endsAt: addMinutes(live, 150).toISOString(),
      config: { livestream: true },
    },
  ];
}
