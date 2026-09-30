import type { AIAction } from "@/lib/ai/actions";
import { track } from "@/lib/analytics/client";
import { eventPhase } from "@/lib/events/status";
import { now as clockNow } from "@/lib/time/clock";
import type { Hotspot } from "@/engine/interaction/hotspots";
import { interiorOriginFor } from "@/engine/interior/types";
import { getInteriorTemplate } from "@/engine/interior/registry";
import { setRigPose } from "@/engine/player/playerRig";
import { useWorldStore, type Location, type PlayerPose } from "@/engine/store/worldStore";
import { useCartStore } from "@/features/cart/cartStore";
import { variantProblem } from "@/features/cart/pricing";
import type { NavTarget } from "@/types/domain";
import { getCityIndex } from "./cityStore";
import { resolveNavTarget } from "./navigation";

/**
 * The single action bus for moving through the city. The HUD, deep links and AI actions all go
 * through here so behaviour and analytics stay identical regardless of who triggered them.
 */

let enteredAt: number | null = null;

function beginMove(pose: PlayerPose, location: Location): boolean {
  const world = useWorldStore.getState();
  world.closeAllPanels();
  return world.beginTransition({
    pose,
    location,
    onCommit: () => setRigPose(pose),
  });
}

export function teleportTo(target: NavTarget, source: "ai" | "hud" | "deep_link"): boolean {
  const index = getCityIndex();
  if (!index) return false;
  const resolved = resolveNavTarget(target, index);
  if (!resolved) return false;
  const ok = beginMove(resolved.pose, { kind: "street" });
  if (ok) {
    useWorldStore.getState().setWaypoint(null);
    track("teleport", { targetKind: target.kind, source });
  }
  return ok;
}

export function guideTo(target: NavTarget, source: "ai" | "hud"): boolean {
  const index = getCityIndex();
  if (!index) return false;
  const resolved = resolveNavTarget(target, index);
  if (!resolved) return false;
  useWorldStore.getState().setWaypoint({
    target,
    x: resolved.pose.x,
    z: resolved.pose.z,
    label: resolved.label,
  });
  track("waypoint_set", { targetKind: target.kind, source });
  return true;
}

/**
 * Enters a merchant's room. `parcelId` picks which of the merchant's occupied parcels (its store
 * or its event pop-up); it defaults to the permanent storefront.
 */
export function enterMerchant(
  merchantId: string,
  via: "door" | "teleport" | "deep_link",
  parcelId?: string,
): boolean {
  const index = getCityIndex();
  const merchant = index?.merchantsById[merchantId];
  if (!index || !merchant) return false;
  const parcel = parcelId ? index.parcelsById[parcelId] : index.parcelByMerchant[merchantId];
  if (!parcel || parcel.merchantId !== merchantId) return false;
  if (!index.occupiedParcels.some((p) => p.id === parcel.id)) return false;
  const def = getInteriorTemplate(parcel.interiorTemplate ?? merchant.interiorTemplate);
  const origin = interiorOriginFor(parcel);
  const spawn: PlayerPose = {
    x: origin.x + def.spawn.x,
    z: origin.z + def.spawn.z,
    yaw: def.spawn.yaw,
  };
  const ok = beginMove(spawn, { kind: "interior", merchantId, parcelId: parcel.id });
  if (ok) {
    enteredAt = Date.now();
    const world = useWorldStore.getState();
    const wp = world.waypoint?.target;
    if (
      (wp?.kind === "merchant" && wp.merchantId === merchantId) ||
      (wp?.kind === "parcel" && wp.parcelId === parcel.id) ||
      (wp?.kind === "event" && index.eventsById[wp.eventId]?.parcelId === parcel.id)
    ) {
      world.setWaypoint(null);
    }
    track("store_entered", { merchantId, via });
    const event = index.eventByParcel[parcel.id];
    if (event && parcel.id !== index.parcelByMerchant[merchantId]?.id) {
      const phase = eventPhase(event, clockNow());
      if (phase !== "ended") track("event_joined", { eventId: event.id, phase, via: "popup" });
    }
  }
  return ok;
}

export function exitInterior(): boolean {
  const index = getCityIndex();
  const world = useWorldStore.getState();
  if (!index || world.location.kind !== "interior") return false;
  const { merchantId, parcelId } = world.location;
  const resolved =
    resolveNavTarget({ kind: "parcel", parcelId }, index) ??
    resolveNavTarget({ kind: "merchant", merchantId }, index);
  const pose = resolved?.pose ?? index.snapshot.districts[0]?.spawnPoint ?? { x: 0, z: 0, yaw: 0 };
  const ok = beginMove(pose, { kind: "street" });
  if (ok) {
    const seconds = enteredAt ? Math.round((Date.now() - enteredAt) / 1000) : 0;
    enteredAt = null;
    track("store_exited", { merchantId, seconds });
  }
  return ok;
}

export function inspectProduct(productId: string, source: "interior" | "ai" | "panel"): boolean {
  const index = getCityIndex();
  const product = index?.productsById[productId];
  if (!product) return false;
  useWorldStore.getState().setFocusedProduct(productId);
  track("product_inspected", { productId, merchantId: product.merchantId, source });
  return true;
}

export function talkToEmployee(merchantId: string): boolean {
  const index = getCityIndex();
  if (!index?.merchantsById[merchantId]) return false;
  useWorldStore.getState().setTalkingTo(merchantId);
  return true;
}

/** Executes a hotspot the player activated (E key / tap). */
export function interactWithHotspot(hotspot: Hotspot): boolean {
  switch (hotspot.kind) {
    case "door":
      return hotspot.payload.merchantId
        ? enterMerchant(hotspot.payload.merchantId, "door", hotspot.payload.parcelId)
        : false;
    case "exit":
      return exitInterior();
    case "product":
      return hotspot.payload.productId
        ? inspectProduct(hotspot.payload.productId, "interior")
        : false;
    case "employee":
      return hotspot.payload.merchantId ? talkToEmployee(hotspot.payload.merchantId) : false;
    case "event": {
      useWorldStore.getState().setPlacesOpen(true);
      const event = hotspot.payload.eventId
        ? getCityIndex()?.eventsById[hotspot.payload.eventId]
        : undefined;
      if (event)
        track("event_viewed", {
          eventId: event.id,
          phase: eventPhase(event, clockNow()),
          source: "hotspot",
        });
      return true;
    }
    case "info":
      useWorldStore.getState().setPlacesOpen(true);
      return true;
  }
}

/**
 * Executes an action proposed by the AI. Returns true when something happened.
 * Teleports are confirmed by the UI before reaching here.
 */
export function executeAIAction(action: AIAction): boolean {
  let accepted = false;
  switch (action.type) {
    case "navigate":
      accepted =
        action.mode === "teleport" ? teleportTo(action.target, "ai") : guideTo(action.target, "ai");
      break;
    case "propose_cart": {
      const index = getCityIndex();
      if (!index) break;
      const cart = useCartStore.getState();
      let added = 0;
      let needsChoice: string | null = null;
      for (const item of action.items) {
        const product = index.productsById[item.productId];
        if (!product) continue;
        const selection = item.variantSelection ?? {};
        const problem = variantProblem(product, selection);
        if (problem) {
          needsChoice ??= product.id;
          continue;
        }
        cart.addLine({
          productId: product.id,
          merchantId: product.merchantId,
          quantity: item.quantity,
          variantSelection: selection,
        });
        track("cart_item_added", {
          productId: product.id,
          merchantId: product.merchantId,
          quantity: item.quantity,
          source: "ai",
        });
        added += 1;
      }
      if (needsChoice) {
        inspectProduct(needsChoice, "ai");
      } else if (added > 0) {
        useWorldStore.getState().setCartOpen(true);
      }
      accepted = added > 0 || needsChoice !== null;
      break;
    }
    case "escalate":
      accepted = true;
      break;
  }
  track("ai_action_executed", { action: action.type, accepted });
  return accepted;
}
