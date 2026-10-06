import type { DigitalReward } from "@/types/domain";
import { sid } from "./ids";

const INK = "#141416";
const BONE = "#E8E4DA";
const SIGNAL = "#FF4D1F";

function hoodie(
  slug: string,
  name: string,
  primary: string,
  accent: string,
  print: string,
): DigitalReward {
  return {
    id: sid.reward(slug),
    slug,
    name,
    description: "The same hoodie you bought, on your avatar. Ships with the real one.",
    kind: "avatar_item",
    avatarSlot: "outfit",
    appearance: { style: "hoodie", primary, secondary: primary, accent, print },
    rarity: "rare",
  };
}

export const rewards: DigitalReward[] = [
  hoodie("northline-meridian-hoodie", "Meridian Hoodie (avatar)", INK, BONE, "NL"),
  hoodie("night-shift-hoodie-ink", "Night Shift Hoodie — Ink (avatar)", INK, SIGNAL, "NIGHT SHIFT"),
  hoodie(
    "night-shift-hoodie-signal",
    "Night Shift Hoodie — Signal (avatar)",
    SIGNAL,
    INK,
    "NIGHT SHIFT",
  ),
  hoodie(
    "night-shift-hoodie-bone",
    "Night Shift Hoodie — Bone (avatar)",
    BONE,
    SIGNAL,
    "NIGHT SHIFT",
  ),
  {
    ...hoodie("night-shift-zip-hoodie", "Night Shift Zip Hoodie (avatar)", INK, SIGNAL, ""),
    appearance: { style: "zip-hoodie", primary: INK, secondary: INK, accent: SIGNAL },
  },
  {
    id: sid.reward("northline-founder-badge"),
    slug: "northline-founder-badge",
    name: "Night Shift Founder Badge",
    description: "Given to everyone who bought from the collection while the drop was live.",
    kind: "badge",
    appearance: { style: "badge", primary: SIGNAL, secondary: INK, print: "NS" },
    rarity: "epic",
  },
  {
    id: sid.reward("bloom-date-night-flowers"),
    slug: "bloom-date-night-flowers",
    name: "Date Night Bouquet (apartment)",
    description: "A digital twin of the bouquet for your apartment table.",
    kind: "apartment_item",
    rarity: "common",
  },
  {
    id: sid.reward("kori-spicy-miso-bowl"),
    slug: "kori-spicy-miso-bowl",
    name: "Spicy Miso Bowl (table)",
    description: "Steams forever on your virtual table.",
    kind: "food_prop",
    rarity: "common",
  },
];
