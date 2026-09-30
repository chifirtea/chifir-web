import type { Offer } from "@/types/domain";
import { sid } from "./ids";
import { NIGHT_SHIFT_SLUGS } from "./products";
import { CITY_TZ, addDays, dropWindow, todayAt } from "./time";

/**
 * Every offer here is real and applied by `computeTotals`. Never seed a promotion the checkout
 * cannot honour.
 */
export function buildOffers(now = new Date()): Offer[] {
  const drop = dropWindow(now);
  return [
    {
      id: sid.offer("northline-night-shift-launch"),
      slug: "northline-night-shift-launch",
      merchantId: sid.merchant("northline-supply"),
      scope: { productIds: NIGHT_SHIFT_SLUGS.map((slug) => sid.product("northline-supply", slug)) },
      title: "Night Shift launch: 10% off the collection",
      description:
        "10% off every Night Shift hoodie while the pop-up is open (8 to 10 PM). Applied automatically at checkout.",
      kind: "percent_off",
      value: 10,
      startsAt: drop.start.toISOString(),
      endsAt: drop.end.toISOString(),
      redemptionsCount: 0,
      active: true,
    },
    {
      id: sid.offer("ember-burger-rush"),
      slug: "ember-burger-rush",
      merchantId: sid.merchant("ember-and-oak"),
      scope: { categories: ["burgers"] },
      title: "Burger Rush: 20% off burgers",
      description:
        "20% off every burger ordered for delivery or pickup between 5 and 9 PM. Applied automatically at checkout.",
      kind: "percent_off",
      value: 20,
      startsAt: todayAt(CITY_TZ, 17, 0, now).toISOString(),
      endsAt: todayAt(CITY_TZ, 21, 0, now).toISOString(),
      maxRedemptions: 300,
      redemptionsCount: 112,
      active: true,
    },
    {
      id: sid.offer("bloom-date-night-5-off"),
      slug: "bloom-date-night-5-off",
      merchantId: sid.merchant("bloom-and-co"),
      productId: sid.product("bloom-and-co", "date-night-bouquet"),
      scope: {},
      title: "$5 off the Date Night Bouquet",
      description: "Same-day delivery before 8 PM. Enter code DATE5 at checkout.",
      kind: "amount_off",
      value: 500,
      code: "DATE5",
      startsAt: addDays(now, -1).toISOString(),
      endsAt: addDays(now, 14).toISOString(),
      redemptionsCount: 27,
      active: true,
    },
    {
      id: sid.offer("kori-late-bowls"),
      slug: "kori-late-bowls",
      merchantId: sid.merchant("kori-ramen"),
      scope: { categories: ["ramen"] },
      title: "Late bowls: 10% off ramen after 9 PM",
      description: "10% off any ramen bowl ordered between 9 PM and close. Applied automatically.",
      kind: "percent_off",
      value: 10,
      startsAt: todayAt(CITY_TZ, 21, 0, now).toISOString(),
      endsAt: todayAt(CITY_TZ, 23, 59, now).toISOString(),
      redemptionsCount: 8,
      active: true,
    },
  ];
}
