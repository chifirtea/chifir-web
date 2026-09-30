"use client";

import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { useQualityStore } from "@/engine/canvas/qualityStore";
import { useInputStore } from "@/engine/input/inputStore";
import { segmentAABBEntry } from "@/engine/physics/collision";
import { getColliders } from "@/engine/physics/colliderStore";
import { selectInputLocked, useWorldStore } from "@/engine/store/worldStore";
import { playerRig } from "./playerRig";
import { wrapAngle } from "./PlayerController";

/** Runs after the player (-20) and before default-priority subscribers. */
export const CAMERA_PRIORITY = -10;

const HEAD_HEIGHT = 1.5;
const DEFAULT_PITCH = -0.35;
const PITCH_MIN = -1.1;
const PITCH_MAX = 0.2;
const DISTANCE_DESKTOP = 6.5;
const DISTANCE_MOBILE = 5;
const DISTANCE_MIN = 3.5;
const DISTANCE_MAX = 9;
/** rad per pixel of drag. */
const LOOK_SENSITIVITY = 0.0045;
/** metres per wheel unit. */
const ZOOM_SENSITIVITY = 0.005;
/** Seconds without look input before the camera drifts back behind the player. */
const RECENTER_DELAY = 1.5;
const RECENTER_RATE = 1.5;
const FOLLOW_RATE = 8;
/** How quickly the camera returns to its full distance after an occluder passes. */
const RECOVER_RATE = 4;
/** Keep this much air between the camera and the wall it was shortened by. */
const OCCLUSION_MARGIN = 0.3;
/** Colliders smaller than this on both axes (poles, bins) do not pull the camera in. */
const MIN_OCCLUDER_SIZE = 1.5;
/** Teleports are far larger than any one frame of walking; snap instead of gliding. */
const SNAP_DISTANCE_SQ = 10 * 10;
const CAMERA_MIN_Y = 0.4;

interface OrbitState {
  yaw: number;
  pitch: number;
  /** Requested distance (wheel-zoomed). */
  distance: number;
  /** Distance in use this frame, after occlusion and smoothing. */
  current: number;
  /** Seconds since the last look input. */
  sinceLook: number;
  initialised: boolean;
}

const orbit: OrbitState = {
  yaw: 0,
  pitch: DEFAULT_PITCH,
  distance: DISTANCE_DESKTOP,
  current: DISTANCE_DESKTOP,
  sinceLook: Infinity,
  initialised: false,
};

const target = new Vector3();
const followed = new Vector3();

/** Horizontal look direction of the camera: forward = (sin yaw, 0, cos yaw). */
export function getCameraYaw(): number {
  return orbit.yaw;
}

export function getCameraPitch(): number {
  return orbit.pitch;
}

/** Forces the orbit (e.g. behind the player after a teleport). The next frame also re-snaps. */
export function setCameraYaw(yaw: number): void {
  orbit.yaw = wrapAngle(yaw);
  orbit.sinceLook = Infinity;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Third-person orbit camera. Reads look/zoom from the input rig, follows `playerRig` with
 * exponential damping and shortens its boom when a building sits between it and the player.
 */
export function FollowCamera() {
  const camera = useThree((s) => s.camera);
  const domElement = useThree((s) => s.gl.domElement);
  const mobile = useQualityStore((s) => s.mobile);

  useEffect(() => {
    orbit.distance = mobile ? DISTANCE_MOBILE : DISTANCE_DESKTOP;
    orbit.current = Math.min(orbit.current, orbit.distance);
  }, [mobile]);

  // Desktop: any-button drag orbits, wheel zooms. Touch reaches us only when the joystick layer
  // is not mounted (it captures touches itself), so no pointer-type filter is needed.
  useEffect(() => {
    const el = domElement;
    let dragId = -1;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: PointerEvent) => {
      if (dragId !== -1) return;
      dragId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return;
      useInputStore.getState().addLook(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === dragId) dragId = -1;
    };
    const onWheel = (e: WheelEvent) => {
      useInputStore.getState().addZoom(e.deltaY);
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("contextmenu", onContextMenu);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }, [domElement]);

  useFrame((_, dt) => {
    const world = useWorldStore.getState();
    const locked = selectInputLocked(world);
    const input = useInputStore.getState();
    // Always drain the accumulators, otherwise a drag made while a panel is open lands as one
    // big jump when it closes.
    const look = input.consumeLook();
    const zoom = input.consumeZoom();
    const rig = playerRig;

    orbit.sinceLook += dt;
    if (!locked) {
      if (look.dx !== 0 || look.dy !== 0) {
        // Drag right turns the view right, which under forward = (sin yaw, cos yaw) is yaw down.
        orbit.yaw = wrapAngle(orbit.yaw - look.dx * LOOK_SENSITIVITY);
        orbit.pitch = clamp(orbit.pitch - look.dy * LOOK_SENSITIVITY, PITCH_MIN, PITCH_MAX);
        orbit.sinceLook = 0;
      }
      if (zoom !== 0) {
        orbit.distance = clamp(orbit.distance + zoom * ZOOM_SENSITIVITY, DISTANCE_MIN, DISTANCE_MAX);
      }
    }

    // Auto-recenter behind the player while walking, but only in proportion to how much of the
    // stick is "forward": recentring while strafing would rotate the movement frame under the
    // player and send them in circles.
    if (rig.moving && orbit.sinceLook > RECENTER_DELAY) {
      const forwardness = clamp(input.move.y, 0, 1);
      if (forwardness > 0) {
        const k = 1 - Math.exp(-RECENTER_RATE * forwardness * forwardness * dt);
        orbit.yaw = wrapAngle(orbit.yaw + wrapAngle(rig.yaw - orbit.yaw) * k);
      }
    }

    target.set(rig.x, rig.y + HEAD_HEIGHT, rig.z);
    if (!orbit.initialised || followed.distanceToSquared(target) > SNAP_DISTANCE_SQ) {
      followed.copy(target);
      orbit.yaw = rig.yaw;
      orbit.current = orbit.distance;
      orbit.sinceLook = Infinity;
      orbit.initialised = true;
    } else {
      followed.lerp(target, 1 - Math.exp(-FOLLOW_RATE * dt));
    }

    // Unit boom direction from the head toward the camera. Negative pitch lifts the camera.
    const cp = Math.cos(orbit.pitch);
    const ox = -Math.sin(orbit.yaw) * cp;
    const oy = -Math.sin(orbit.pitch);
    const oz = -Math.cos(orbit.yaw) * cp;

    const scope = world.location.kind === "interior" ? "interior" : "street";
    const t = segmentAABBEntry(
      followed.x,
      followed.z,
      followed.x + ox * orbit.distance,
      followed.z + oz * orbit.distance,
      getColliders(scope),
      MIN_OCCLUDER_SIZE,
    );
    const allowed =
      t < 1 ? Math.max(DISTANCE_MIN * 0.5, t * orbit.distance - OCCLUSION_MARGIN) : orbit.distance;
    // Pull in immediately (never clip into a wall), ease back out.
    orbit.current =
      allowed < orbit.current
        ? allowed
        : orbit.current + (allowed - orbit.current) * (1 - Math.exp(-RECOVER_RATE * dt));

    camera.position.set(
      followed.x + ox * orbit.current,
      Math.max(CAMERA_MIN_Y, followed.y + oy * orbit.current),
      followed.z + oz * orbit.current,
    );
    camera.lookAt(followed);
  }, CAMERA_PRIORITY);

  return null;
}
