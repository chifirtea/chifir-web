/**
 * Pure pose interpolation for remote peers. The receiver renders each peer a little in the past
 * (`INTERP_DELAY_MS`) so there is always a later sample to blend toward; when the network stalls
 * it extrapolates briefly, then holds. All functions mutate caller-owned objects and allocate
 * nothing per frame.
 */

export const INTERP_DELAY_MS = 120;
export const MAX_EXTRAPOLATION_MS = 200;
/** A jump larger than this between consecutive samples is a teleport: snap instead of gliding. */
export const SNAP_DISTANCE_M = 8;
/** A peer that has not been heard from for this long is removed. */
export const DESPAWN_MS = 8000;
/** Samples older than this behind the newest are dropped (keeps the buffer tiny). */
const RETAIN_MS = 1500;
const MAX_SAMPLES = 24;

export interface PoseSample {
  /** Receiver clock when the sample arrived (ms). */
  t: number;
  x: number;
  z: number;
  yaw: number;
  moving: boolean;
}

export interface InterpolatedPose {
  x: number;
  z: number;
  yaw: number;
  /** Horizontal speed implied by the samples (m/s), for the walk cycle. */
  speed: number;
}

export interface InterpolationBuffer {
  samples: PoseSample[];
}

export function createBuffer(): InterpolationBuffer {
  return { samples: [] };
}

/** Wraps an angle to [-PI, PI). */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Interpolates yaw along the shortest arc. */
export function lerpAngle(a: number, b: number, k: number): number {
  return wrapAngle(a + wrapAngle(b - a) * k);
}

/**
 * Appends a sample. Out-of-order samples are ignored; a jump beyond `SNAP_DISTANCE_M` clears the
 * buffer so the peer appears at the new place at once. Returns whether the sample was kept.
 */
export function pushSample(buf: InterpolationBuffer, sample: PoseSample): boolean {
  const samples = buf.samples;
  const last = samples[samples.length - 1];
  if (last) {
    if (sample.t <= last.t) return false;
    const dx = sample.x - last.x;
    const dz = sample.z - last.z;
    if (dx * dx + dz * dz > SNAP_DISTANCE_M * SNAP_DISTANCE_M) samples.length = 0;
  }
  samples.push(sample);
  // Trim: keep what the delay window and a short extrapolation could still need.
  const cutoff = sample.t - RETAIN_MS;
  let drop = 0;
  while (drop < samples.length - 2 && samples[drop]!.t < cutoff) drop++;
  if (samples.length - drop > MAX_SAMPLES) drop = samples.length - MAX_SAMPLES;
  if (drop > 0) samples.splice(0, drop);
  return true;
}

/** The newest sample, or null when the buffer is empty. */
export function latestSample(buf: InterpolationBuffer): PoseSample | null {
  return buf.samples[buf.samples.length - 1] ?? null;
}

/**
 * Writes the pose at time `t` into `out`. Between samples: linear position, shortest-arc yaw.
 * Past the newest sample: constant-velocity extrapolation for at most `MAX_EXTRAPOLATION_MS`,
 * then hold. Before the oldest: hold the oldest. Returns false when the buffer is empty.
 */
export function sampleAt(buf: InterpolationBuffer, t: number, out: InterpolatedPose): boolean {
  const samples = buf.samples;
  const n = samples.length;
  if (n === 0) return false;
  const first = samples[0]!;
  const last = samples[n - 1]!;

  if (n === 1 || t <= first.t) {
    out.x = first.x;
    out.z = first.z;
    out.yaw = first.yaw;
    out.speed = 0;
    return true;
  }

  if (t >= last.t) {
    const prev = samples[n - 2]!;
    const dt = (last.t - prev.t) / 1000;
    const ahead = Math.min(t - last.t, MAX_EXTRAPOLATION_MS) / 1000;
    if (dt <= 0 || !last.moving || ahead <= 0) {
      out.x = last.x;
      out.z = last.z;
      out.yaw = last.yaw;
      out.speed = 0;
      return true;
    }
    const vx = (last.x - prev.x) / dt;
    const vz = (last.z - prev.z) / dt;
    out.x = last.x + vx * ahead;
    out.z = last.z + vz * ahead;
    out.yaw = last.yaw;
    // Once the extrapolation window is spent the figure stands still.
    out.speed = t - last.t < MAX_EXTRAPOLATION_MS ? Math.hypot(vx, vz) : 0;
    return true;
  }

  // Find the segment containing t (buffers are short; a linear scan from the end is cheapest).
  let i = n - 2;
  while (i > 0 && samples[i]!.t > t) i--;
  const a = samples[i]!;
  const b = samples[i + 1]!;
  const span = b.t - a.t;
  const k = span > 0 ? (t - a.t) / span : 1;
  out.x = a.x + (b.x - a.x) * k;
  out.z = a.z + (b.z - a.z) * k;
  out.yaw = lerpAngle(a.yaw, b.yaw, k);
  out.speed = span > 0 ? (Math.hypot(b.x - a.x, b.z - a.z) / span) * 1000 : 0;
  return true;
}

/** True when the peer has been silent long enough to despawn. */
export function isSilent(lastSeen: number, now: number): boolean {
  return now - lastSeen > DESPAWN_MS;
}
