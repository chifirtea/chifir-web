import type { NavTarget } from "@/types/domain";
import type { PlayerPose } from "@/engine/store/worldStore";
import { doorPose, localToWorld } from "@/engine/storefront/types";
import { getStorefrontTemplate } from "@/engine/storefront/registry";
import type { CityIndex } from "./cityIndex";

export interface ResolvedTarget {
  pose: PlayerPose;
  label: string;
}

/**
 * Turns any NavTarget into a concrete street pose. Used by teleport, waypoints, AI actions and
 * deep links so they all agree on where "Ember & Oak" is.
 */
export function resolveNavTarget(target: NavTarget, index: CityIndex): ResolvedTarget | null {
  switch (target.kind) {
    case "merchant": {
      const merchant = index.merchantsById[target.merchantId];
      const parcel = index.parcelByMerchant[target.merchantId];
      if (!merchant || !parcel) return null;
      const def = getStorefrontTemplate(parcel.storefrontTemplate ?? merchant.storefrontTemplate);
      return { pose: doorPose(parcel, def), label: merchant.name };
    }
    case "parcel": {
      const parcel = index.parcelsById[target.parcelId];
      if (!parcel) return null;
      const merchant = parcel.merchantId ? index.merchantsById[parcel.merchantId] : undefined;
      const occupiedNow = index.occupiedParcels.some((p) => p.id === parcel.id);
      if (merchant && occupiedNow) {
        const def = getStorefrontTemplate(parcel.storefrontTemplate ?? merchant.storefrontTemplate);
        const event = index.eventByParcel[parcel.id];
        const isPopup = parcel.id !== index.parcelByMerchant[merchant.id]?.id;
        return {
          pose: doorPose(parcel, def),
          label: isPopup && event ? `${merchant.name} pop-up` : merchant.name,
        };
      }
      // Not open yet (a pop-up before its window) or truly empty: stand in front of the lot.
      const front = localToWorld(parcel, { x: 0, z: parcel.size.depth / 2 + 3 });
      const event = index.eventByParcel[parcel.id];
      return {
        pose: { x: front.x, z: front.z, yaw: parcel.rotationY + Math.PI },
        label: event ? event.title : "Available lot",
      };
    }
    case "district": {
      const district = index.districtsById[target.districtId];
      if (!district) return null;
      const spawn = district.spawnPoint ?? {
        x: (district.bounds.minX + district.bounds.maxX) / 2,
        z: (district.bounds.minZ + district.bounds.maxZ) / 2,
        yaw: 0,
      };
      return { pose: spawn, label: district.name };
    }
    case "event": {
      const event = index.eventsById[target.eventId];
      if (!event) return null;
      const inner = event.parcelId
        ? resolveNavTarget({ kind: "parcel", parcelId: event.parcelId }, index)
        : event.merchantId
          ? resolveNavTarget({ kind: "merchant", merchantId: event.merchantId }, index)
          : event.districtId
            ? resolveNavTarget({ kind: "district", districtId: event.districtId }, index)
            : null;
      return inner ? { pose: inner.pose, label: event.title } : null;
    }
    case "point":
      return { pose: { x: target.x, z: target.z, yaw: 0 }, label: "Waypoint" };
  }
}

/** Parses a deep-link value (`?to=ember-and-oak`, `?to=district:food-street`, `?to=event:burger-rush`). */
export function parseDeepLinkTarget(value: string, index: CityIndex): NavTarget | null {
  const [prefix, rest] = value.includes(":") ? value.split(":", 2) : ["merchant", value];
  if (!rest) return null;
  switch (prefix) {
    case "merchant": {
      const m = index.merchantsBySlug[rest] ?? index.merchantsById[rest];
      return m ? { kind: "merchant", merchantId: m.id } : null;
    }
    case "district": {
      const d = index.districtsBySlug[rest] ?? index.districtsById[rest];
      return d ? { kind: "district", districtId: d.id } : null;
    }
    case "event": {
      const e = index.eventsBySlug[rest] ?? index.eventsById[rest];
      return e ? { kind: "event", eventId: e.id } : null;
    }
    case "parcel": {
      const p = index.parcelsBySlug[rest] ?? index.parcelsById[rest];
      return p ? { kind: "parcel", parcelId: p.id } : null;
    }
    default:
      return null;
  }
}

/** Yaw that makes `from` face `to` under the engine convention forward = (sin yaw, cos yaw). */
export function yawToward(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function distance2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
