import type { DigitalReward } from "@/types/domain";
import { sid } from "./ids";

export const rewards: DigitalReward[] = [
  {
    id: sid.reward("northline-meridian-hoodie"),
    slug: "northline-meridian-hoodie",
    name: "Meridian Hoodie (avatar)",
    description: "The same hoodie you bought, on your avatar. Ships with the real one.",
    kind: "avatar_item",
    rarity: "rare",
  },
  {
    id: sid.reward("northline-founder-badge"),
    slug: "northline-founder-badge",
    name: "Northline Founder Badge",
    description: "Given to everyone who bought during the Winter Drop premiere.",
    kind: "badge",
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
    name: "Spicy Miso Bowl (apartment)",
    description: "Steams forever on your virtual table.",
    kind: "apartment_item",
    rarity: "common",
  },
];
