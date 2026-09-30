/**
 * Public surface of the 3D engine core. Contracts (stores, rig, types) keep their own module
 * paths; this barrel covers the components and hooks built on top of them.
 */

// Canvas
export { CityCanvas } from "./canvas/CityCanvas";
export { detectInitialQuality, isMobileDevice, readGpuRenderer, tierFromSignals } from "./canvas/detectQuality";
export type { DetectedQuality, QualitySignals } from "./canvas/detectQuality";

// Input
export { inputRig, useInputStore } from "./input/inputStore";
export type { InputRig, InputState, LookDelta, MoveVector } from "./input/inputStore";
export { useKeyboard } from "./input/useKeyboard";
export { VirtualJoystick } from "./input/VirtualJoystick";

// Physics
export { resolveCircleAABB, segmentAABBEntry } from "./physics/collision";
export type { CollisionAxis, CollisionResult } from "./physics/collision";

// Player
export {
  createMotion,
  MAX_DT,
  PLAYER_RADIUS,
  RUN_SPEED,
  stepPlayer,
  TURN_RATE,
  WALK_SPEED,
  wrapAngle,
} from "./player/PlayerController";
export type { PlayerInput, PlayerMotion } from "./player/PlayerController";
export { CAMERA_PRIORITY, FollowCamera, getCameraPitch, getCameraYaw, setCameraYaw } from "./player/FollowCamera";
export { Avatar, DEFAULT_AVATAR, NpcAvatar } from "./player/Avatar";
export type { NpcAvatarProps } from "./player/Avatar";
export { Player, PLAYER_PRIORITY } from "./player/Player";

// Transitions
export { Fade } from "./transitions/Fade";

// Interaction
export { HotspotScanner } from "./interaction/HotspotScanner";
export { HotspotMarker, HotspotMarkers } from "./interaction/HotspotMarker";

// Navigation
export { WaypointBeacon } from "./navigation/WaypointBeacon";
