"use client";

import { useEffect } from "react";
import { getCityIndex } from "@/city/cityStore";
import { useAvatarStore } from "@/engine/store/avatarStore";
import { playerRig } from "@/engine/player/playerRig";
import { useWorldStore } from "@/engine/store/worldStore";
import { useUser } from "@/features/auth/useUser";
import { track } from "@/lib/analytics/client";
import { connectRoom } from "./connect";
import { PresenceController } from "./controller";
import { bodyColorFor, displayNameFor, getPeerId, hairColorFor } from "./identity";
import { selectRoomCount, usePresenceStore } from "./presenceStore";
import { roomForLocation } from "./rooms";
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
      connect: connectRoom,
      store,
      now: Date.now,
      onRoomJoined: (room, transport) => {
        track("presence_joined", { room, peers: selectRoomCount(usePresenceStore.getState()) - 1, transport });
      },
    });

    const tick = () => {
      const world = useWorldStore.getState();
      const me = usePresenceStore.getState().me;
      controller.tick({
        ready: world.ready,
        hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
        room: roomForLocation(world.location, getCityIndex(), playerRig.x, playerRig.z),
        x: playerRig.x,
        z: playerRig.z,
        yaw: playerRig.yaw,
        moving: playerRig.moving,
        me,
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
