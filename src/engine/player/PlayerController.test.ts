import { describe, expect, it } from "vitest";
import type { AABB } from "@/engine/physics/types";
import type { PlayerRig } from "./playerRig";
import {
  createMotion,
  MAX_DT,
  PLAYER_RADIUS,
  RUN_SPEED,
  stepPlayer,
  WALK_SPEED,
  wrapAngle,
  type PlayerInput,
} from "./PlayerController";

const rigAt = (x = 0, z = 0, yaw = 0): PlayerRig => ({
  x,
  y: 0,
  z,
  yaw,
  speed: 0,
  moving: false,
  running: false,
});

const input = (moveX: number, moveY: number, run = false): PlayerInput => ({ moveX, moveY, run });

const box = (id: string, minX: number, minZ: number, maxX: number, maxZ: number): AABB => ({
  id,
  minX,
  minZ,
  maxX,
  maxZ,
});

/** Runs `steps` frames at a fixed dt. */
function simulate(
  rig: PlayerRig,
  inp: PlayerInput,
  cameraYaw: number,
  dt: number,
  steps: number,
  colliders: AABB[] = [],
) {
  const motion = createMotion();
  for (let i = 0; i < steps; i++) stepPlayer(rig, inp, cameraYaw, dt, colliders, motion);
  return motion;
}

describe("stepPlayer", () => {
  it("moves forward along the camera yaw and faces the movement direction (+X ⇒ yaw ≈ PI/2)", () => {
    const rig = rigAt();
    simulate(rig, input(0, 1), Math.PI / 2, 1 / 60, 120);
    expect(rig.x).toBeGreaterThan(5);
    expect(Math.abs(rig.z)).toBeLessThan(1e-6);
    expect(rig.yaw).toBeCloseTo(Math.PI / 2, 3);
    expect(rig.moving).toBe(true);
  });

  it("strafes right toward world -X when the camera faces +Z (right-handed frame)", () => {
    const rig = rigAt();
    simulate(rig, input(1, 0), 0, 1 / 60, 60);
    expect(rig.x).toBeLessThan(-1);
    expect(Math.abs(rig.z)).toBeLessThan(1e-6);
    expect(rig.yaw).toBeCloseTo(-Math.PI / 2, 2);
  });

  it("reaches walk speed when walking and run speed when running", () => {
    const walker = rigAt();
    simulate(walker, input(0, 1), 0, 1 / 60, 180);
    expect(walker.speed).toBeCloseTo(WALK_SPEED, 1);
    expect(walker.running).toBe(false);

    const runner = rigAt();
    simulate(runner, input(0, 1, true), 0, 1 / 60, 180);
    expect(runner.speed).toBeCloseTo(RUN_SPEED, 1);
    expect(runner.running).toBe(true);
  });

  it("normalises diagonal input so it is not faster than straight input", () => {
    const rig = rigAt();
    simulate(rig, input(1, 1), 0, 1 / 60, 180);
    expect(rig.speed).toBeLessThanOrEqual(WALK_SPEED + 1e-6);
  });

  it("decelerates to a stop when input is released", () => {
    const rig = rigAt();
    const motion = simulate(rig, input(0, 1), 0, 1 / 60, 60);
    for (let i = 0; i < 90; i++) stepPlayer(rig, input(0, 0), 0, 1 / 60, [], motion);
    expect(rig.speed).toBe(0);
    expect(rig.moving).toBe(false);
    expect(motion.vx).toBe(0);
    expect(motion.vz).toBe(0);
  });

  it("clamps dt so a long frame cannot teleport the player", () => {
    const rig = rigAt();
    simulate(rig, input(0, 1, true), 0, 1, 1);
    // One clamped step can cover at most RUN_SPEED * MAX_DT (velocity is still ramping up).
    expect(rig.z).toBeLessThanOrEqual(RUN_SPEED * MAX_DT + 1e-9);
    expect(rig.z).toBeGreaterThan(0);
  });

  it("is blocked by a wall in front", () => {
    const wall = box("wall", -5, 3, 5, 4);
    const rig = rigAt();
    simulate(rig, input(0, 1, true), 0, 1 / 60, 240, [wall]);
    expect(rig.z).toBeCloseTo(3 - PLAYER_RADIUS, 5);
    expect(rig.x).toBeCloseTo(0, 5);
    // Pressing against the wall: no displacement, so the walk cycle reports a stop.
    expect(rig.speed).toBeLessThan(0.01);
  });

  it("slides along a wall when moving diagonally into it", () => {
    const wall = box("wall", 2, -50, 3, 50);
    const rig = rigAt();
    // Camera faces +X, so "right" is +Z: forward-right heads +X and +Z. X is blocked, Z is free.
    simulate(rig, input(1, 1), Math.PI / 2, 1 / 60, 180, [wall]);
    expect(rig.x).toBeCloseTo(2 - PLAYER_RADIUS, 5);
    expect(rig.z).toBeGreaterThan(3);
  });

  it("slides around an outer corner instead of sticking", () => {
    const block = box("block", 2, -1, 4, 1);
    const rig = rigAt(0, 0.9);
    // Heading +X, slightly above the block's +Z edge line: gets clamped on X first, then keeps
    // moving on Z (input has a +Z component), and once past the corner continues on X.
    simulate(rig, input(0, 1), Math.PI / 2 - 0.35, 1 / 60, 300, [block]);
    expect(rig.x).toBeGreaterThan(4);
    expect(rig.z).toBeGreaterThan(1 + PLAYER_RADIUS - 1e-6);
  });

  it("never tunnels through a thin wall at 50 ms steps while running", () => {
    const thin = box("thin", -10, 5, 10, 5.1);
    const rig = rigAt();
    const motion = createMotion();
    for (let i = 0; i < 200; i++) {
      stepPlayer(rig, input(0, 1, true), 0, MAX_DT, [thin], motion);
      expect(rig.z).toBeLessThanOrEqual(5 - PLAYER_RADIUS + 1e-9);
    }
    expect(rig.z).toBeCloseTo(5 - PLAYER_RADIUS, 5);
  });

  it("never tunnels through a thin wall approached diagonally with dt above the clamp", () => {
    const thin = box("thin", -100, 5, 100, 5.05);
    const rig = rigAt(1, 0);
    const motion = createMotion();
    for (let i = 0; i < 200; i++) {
      stepPlayer(rig, input(0.6, 1, true), -0.3, 0.2, [thin], motion);
      expect(rig.z).toBeLessThanOrEqual(5 - PLAYER_RADIUS + 1e-9);
    }
  });

  it("pushes a player who spawned inside a box out along the smallest penetration", () => {
    const b = box("b", 0, 0, 10, 2);
    const rig = rigAt(5, 1.8);
    stepPlayer(rig, input(0, 0), 0, 1 / 60, [b], createMotion());
    expect(rig.z).toBeCloseTo(2 + PLAYER_RADIUS, 5);
    expect(rig.x).toBeCloseTo(5, 5);
  });

  it("does not turn while idle", () => {
    const rig = rigAt(0, 0, 1.2);
    simulate(rig, input(0, 0), 0, 1 / 60, 30);
    expect(rig.yaw).toBe(1.2);
  });

  it("turns the short way round", () => {
    const rig = rigAt(0, 0, Math.PI - 0.1);
    // Moving -Z with the camera facing +Z: target yaw is PI; from PI-0.1 that is +0.1, not -2PI+0.1.
    stepPlayer(rig, input(0, -1), 0, 1 / 60, [], createMotion());
    expect(rig.yaw).toBeGreaterThan(Math.PI - 0.1);
    expect(rig.yaw).toBeLessThanOrEqual(Math.PI);
  });
});

describe("wrapAngle", () => {
  it("wraps into [-PI, PI)", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(Math.PI * 0.999)).toBeCloseTo(Math.PI * 0.999);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(Math.PI * 2.5)).toBeCloseTo(Math.PI / 2);
  });
});
