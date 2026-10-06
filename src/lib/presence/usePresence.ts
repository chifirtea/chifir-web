"use client";

import { useEffect } from "react";
import { getCityIndex } from "@/city/cityStore";
import { useAvatarStore } from "@/engine/store/avatarStore";
import { playerRig } from "@/engine/player/playerRig";
import { useWorldStore } from "@/engine/store/worldStore";
import { useUser } from "@/features/auth/useUser";
import { track } from "@/lib/analytics/client";
import { presenceConnector } from "./connect";
import { PresenceController } from "./controller";
import { bodyColorFor, displayNameFor, getPeerId, hairColorFor } from "./identity";
import { partyNearbyElsewhere, selectRoomCount, usePresenceStore } from "./presenceStore";
import { nextRoom, type RoomTrack } from "./rooms";
import { MAX_NAME_CHARS, PUBLISH_INTERVAL_MS } from "./transport";

/**
 * Mounts presence for this tab: identity (random peer id, display name without email, body
 * colour, equipped outfit), the room that follows the player's location, the party channel, the
 * 10 Hz publisher and the despawn sweep. Mount once, inside the canvas (PresenceLayer).
 */
export function usePresence(): void {
  const { user } = useUser();
  const outfit = useAvatarStore((s) => s.outfit);
  const displayName = user?.displayName ?? null;

  useEffect(() => {
    const peerId = getPeerId();
    usePresenceStore.getState().setMe({
      peerId,
      name: displayNameFor(peerId, displayName, MAX_NAME_CHARS),
      bodyColor: bodyColorFor(peerId),
      hairColor: hairColorFor(peerId),
      outfit,
    });
  }, [displayName, outfit]);

  useEffect(() => {
    const store = usePresenceStore.getState();
    const controller = new PresenceController({
      connect: presenceConnector.connect,
      upgrade: presenceConnector.upgrade,
      store,
      now: Date.now,
      onRoomJoined: (room, transport) => {
        track("presence_joined", { room, peers: selectRoomCount(usePresenceStore.getState()) - 1, transport });
      },
    });

    // Previous tick's room and position, for the district-edge hysteresis.
    let lastRoom: RoomTrack | null = null;
    const tick = () => {
      const world = useWorldStore.getState();
      const presence = usePresenceStore.getState();
      const { x, z } = playerRig;
      const room = nextRoom(world.location, getCityIndex(), x, z, lastRoom);
      lastRoom = { room, x, z };
      controller.tick({
        ready: world.ready,
        hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
        room,
        x,
        z,
        yaw: playerRig.yaw,
        moving: playerRig.moving,
        me: presence.me,
        partyDetail: partyNearbyElsewhere(presence, room, x, z),
      });
    };
    const interval = setInterval(tick, PUBLISH_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") controller.nudge();
    };
    const onPageHide = () => controller.suspend();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      controller.dispose();
    };
  }, []);
}
