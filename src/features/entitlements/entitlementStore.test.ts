import { beforeEach, describe, expect, it } from "vitest";
import type { DigitalReward } from "@/types/domain";
import { useAvatarStore } from "@/engine/store/avatarStore";
import { useEntitlementStore } from "./entitlementStore";

const hoodie: DigitalReward = {
  id: "r-hoodie",
  slug: "hoodie",
  name: "Hoodie (avatar)",
  description: "",
  kind: "avatar_item",
  avatarSlot: "outfit",
  appearance: { style: "hoodie", primary: "#111", accent: "#f40", print: "NS" },
  rarity: "rare",
};
const hoodie2: DigitalReward = { ...hoodie, id: "r-hoodie-2", slug: "hoodie-2", appearance: { style: "hoodie", primary: "#eee" } };
const badge: DigitalReward = { id: "r-badge", slug: "badge", name: "Badge", description: "", kind: "badge", rarity: "epic" };

describe("entitlement store", () => {
  beforeEach(() => {
    useEntitlementStore.getState().clear();
  });

  it("grants idempotently and keeps the first grant's source", () => {
    const s = useEntitlementStore.getState();
    expect(s.grantFromOrder("o1", [hoodie, badge])).toEqual(["r-hoodie", "r-badge"]);
    expect(s.grant([hoodie], "account")).toEqual([]);
    const e = useEntitlementStore.getState().entitlements["r-hoodie"];
    expect(e?.source).toBe("purchase");
    expect(e?.orderId).toBe("o1");
    expect(Object.keys(useEntitlementStore.getState().entitlements)).toHaveLength(2);
  });

  it("equips wearables into their slot and mirrors the look into the avatar store", () => {
    const s = useEntitlementStore.getState();
    s.grantFromOrder("o1", [hoodie, hoodie2, badge]);
    expect(s.equip("r-badge")).toBe(false); // not wearable
    expect(s.equip("missing")).toBe(false);
    expect(s.equip("r-hoodie")).toBe(true);
    expect(useEntitlementStore.getState().equipped.outfit).toBe("r-hoodie");
    expect(useAvatarStore.getState().outfit?.print).toBe("NS");
    expect(s.equip("r-hoodie-2")).toBe(true); // one item per slot
    expect(useEntitlementStore.getState().equipped.outfit).toBe("r-hoodie-2");
    expect(useAvatarStore.getState().outfit?.primary).toBe("#eee");
    s.unequip("outfit");
    expect(useEntitlementStore.getState().equipped.outfit).toBeUndefined();
    expect(useAvatarStore.getState().outfit).toBeNull();
  });

  it("merges server grants without dropping local ones", () => {
    const s = useEntitlementStore.getState();
    s.grantFromOrder("o1", [hoodie]);
    s.mergeFromServer([badge]);
    const all = useEntitlementStore.getState().entitlements;
    expect(Object.keys(all).sort()).toEqual(["r-badge", "r-hoodie"]);
    expect(all["r-badge"]?.source).toBe("account");
  });
});
