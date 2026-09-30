import { describe, expect, it } from "vitest";
import { buildParcels, districts } from "./districts";
import { employees, merchants } from "./merchants";
import { NIGHT_SHIFT_SLUGS, buildProducts } from "./products";
import { rewards } from "./rewards";
import { buildEvents } from "./events";
import { buildOffers } from "./offers";
import { dropWindow } from "./time";
import { sid } from "./ids";
import { aabbFromCenter } from "@/engine/physics/types";

const NOW = new Date("2026-09-30T20:00:00Z");
const parcels = buildParcels(NOW);
const products = buildProducts(NOW);

describe("seed integrity", () => {
  const merchantIds = new Set(merchants.map((m) => m.id));
  const productIds = new Set(products.map((p) => p.id));
  const rewardIds = new Set(rewards.map((r) => r.id));
  const parcelIds = new Set(parcels.map((p) => p.id));
  const districtIds = new Set(districts.map((d) => d.id));

  it("every occupied parcel references a published merchant, and every merchant has a storefront parcel", () => {
    for (const p of parcels) {
      if (p.merchantId) expect(merchantIds.has(p.merchantId), p.slug).toBe(true);
    }
    for (const m of merchants) {
      expect(
        parcels.some(
          (p) =>
            p.merchantId === m.id && p.tier !== "billboard" && !p.occupiedFrom && !p.occupiedUntil,
        ),
        `${m.slug} needs a permanent storefront parcel`,
      ).toBe(true);
    }
  });

  it("the drop is one consistent window: event, pop-up tenancy, product availability and launch offer agree", () => {
    const { start, end } = dropWindow(NOW);
    expect(end.getTime()).toBeGreaterThan(NOW.getTime());
    const event = buildEvents(NOW).find((e) => e.slug === "northline-night-shift")!;
    expect(event.startsAt).toBe(start.toISOString());
    expect(event.endsAt).toBe(end.toISOString());
    const popup = parcels.find((p) => p.slug === "es-pop1")!;
    expect(popup.merchantId).toBe(event.merchantId);
    expect(popup.id).toBe(event.parcelId);
    expect(popup.occupiedFrom).toBe(event.startsAt);
    expect(popup.occupiedUntil).toBe(event.endsAt);
    const collection = products.filter((p) => event.productIds.includes(p.id));
    expect(collection.map((p) => p.slug).sort()).toEqual([...NIGHT_SHIFT_SLUGS].sort());
    for (const p of collection) {
      expect(p.availableFrom).toBe(event.startsAt);
      expect(p.eventId).toBe(event.id);
      expect(p.digitalRewardId && rewardIds.has(p.digitalRewardId), p.slug).toBe(true);
    }
    const offer = buildOffers(NOW).find((o) => o.id === event.offerId)!;
    expect(offer.startsAt).toBe(event.startsAt);
    expect(offer.endsAt).toBe(event.endsAt);
    expect(new Set(offer.scope.productIds)).toEqual(new Set(event.productIds));
    expect(event.rewardId).toBe(sid.reward("northline-founder-badge"));
  });

  it("references resolve: products, employees, rewards, events, offers", () => {
    for (const p of products) {
      expect(merchantIds.has(p.merchantId), p.slug).toBe(true);
      if (p.digitalRewardId) expect(rewardIds.has(p.digitalRewardId), p.slug).toBe(true);
    }
    for (const e of employees) expect(merchantIds.has(e.merchantId)).toBe(true);
    for (const m of merchants)
      expect(
        employees.some((e) => e.merchantId === m.id),
        m.slug,
      ).toBe(true);
    for (const e of buildEvents(NOW)) {
      if (e.merchantId) expect(merchantIds.has(e.merchantId), e.slug).toBe(true);
      if (e.parcelId) expect(parcelIds.has(e.parcelId), e.slug).toBe(true);
      if (e.districtId) expect(districtIds.has(e.districtId), e.slug).toBe(true);
      if (e.productId) expect(productIds.has(e.productId), e.slug).toBe(true);
      if (e.rewardId) expect(rewardIds.has(e.rewardId), e.slug).toBe(true);
      for (const pid of e.productIds)
        expect(productIds.has(pid), `${e.slug} collection`).toBe(true);
      expect(Date.parse(e.endsAt)).toBeGreaterThan(Date.parse(e.startsAt));
    }
    for (const o of buildOffers(NOW)) {
      expect(merchantIds.has(o.merchantId), o.slug).toBe(true);
      if (o.productId) expect(productIds.has(o.productId), o.slug).toBe(true);
      expect(Date.parse(o.endsAt)).toBeGreaterThan(Date.parse(o.startsAt));
    }
    const eventIds = new Set(buildEvents(NOW).map((e) => e.id));
    for (const p of products) if (p.eventId) expect(eventIds.has(p.eventId), p.slug).toBe(true);
  });

  it("parcel ids and slugs are unique and deterministic", () => {
    expect(new Set(parcels.map((p) => p.slug)).size).toBe(parcels.length);
    expect(new Set(parcels.map((p) => p.id)).size).toBe(parcels.length);
    expect(new Set(products.map((p) => `${p.merchantId}/${p.slug}`)).size).toBe(products.length);
  });
});

describe("seed geometry", () => {
  it("parcel rotations are multiples of 90 degrees (axis-aligned colliders)", () => {
    for (const p of parcels) {
      const q = p.rotationY / (Math.PI / 2);
      expect(Math.abs(q - Math.round(q)), p.slug).toBeLessThan(1e-9);
    }
  });

  it("parcel footprints do not overlap each other or the 14 m street", () => {
    const boxes = parcels.map((p) => ({
      slug: p.slug,
      districtId: p.districtId,
      box: aabbFromCenter(
        p.id,
        p.position.x,
        p.position.z,
        p.size.width,
        p.size.depth,
        p.rotationY,
      ),
    }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!.box;
        const b = boxes[j]!.box;
        const overlap = a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
        expect(overlap, `${boxes[i]!.slug} overlaps ${boxes[j]!.slug}`).toBe(false);
      }
    }
    const streetDistricts = new Set(
      districts.filter((d) => d.slug.endsWith("-street")).map((d) => d.id),
    );
    for (const b of boxes) {
      if (!streetDistricts.has(b.districtId)) continue;
      const EPS = 1e-6;
      const intrudes = b.box.minZ < 7 - EPS && b.box.maxZ > -7 + EPS;
      expect(intrudes, `${b.slug} intrudes into the street`).toBe(false);
    }
  });

  it("parcels sit inside their district bounds", () => {
    const byId = new Map(districts.map((d) => [d.id, d]));
    for (const p of parcels) {
      const d = byId.get(p.districtId)!;
      const box = aabbFromCenter(
        p.id,
        p.position.x,
        p.position.z,
        p.size.width,
        p.size.depth,
        p.rotationY,
      );
      expect(
        box.minX >= d.bounds.minX &&
          box.maxX <= d.bounds.maxX &&
          box.minZ >= d.bounds.minZ &&
          box.maxZ <= d.bounds.maxZ,
        p.slug,
      ).toBe(true);
    }
  });

  it("district spawn points face into their district", () => {
    for (const d of districts) {
      if (!d.spawnPoint) continue;
      const cx = (d.bounds.minX + d.bounds.maxX) / 2;
      const cz = (d.bounds.minZ + d.bounds.maxZ) / 2;
      const fx = Math.sin(d.spawnPoint.yaw);
      const fz = Math.cos(d.spawnPoint.yaw);
      const dot = fx * (cx - d.spawnPoint.x) + fz * (cz - d.spawnPoint.z);
      expect(dot, `${d.slug} spawn faces away from its centre`).toBeGreaterThan(0);
    }
  });
});
