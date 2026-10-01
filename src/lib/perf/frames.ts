/**
 * Frame-time statistics without allocation: a fixed ring of recent frame durations (ms) plus
 * rolling counters for the last second and the last ten seconds. `push()` is called once per
 * rendered frame; readers call `summary()` a few times a second at most.
 */
export interface FrameSummary {
  /** Frames per second over the last ~1 s and ~10 s of wall time. */
  fps1s: number;
  fps10s: number;
  /** Frame duration percentiles over the ring (ms). */
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  /** Frames longer than `longFrameMs` in the ring. */
  longFrames: number;
  /** How many frames the ring currently holds. */
  samples: number;
}

export interface FrameStatsOptions {
  /** Ring capacity in frames (about 10 s at 60 fps). */
  capacity?: number;
  longFrameMs?: number;
}

export class FrameStats {
  private readonly ring: Float32Array;
  private readonly sorted: Float32Array;
  private readonly stamps: Float64Array;
  private head = 0;
  private count = 0;
  private readonly longFrameMs: number;

  constructor(options: FrameStatsOptions = {}) {
    const capacity = Math.max(16, options.capacity ?? 600);
    this.ring = new Float32Array(capacity);
    this.sorted = new Float32Array(capacity);
    this.stamps = new Float64Array(capacity);
    this.longFrameMs = options.longFrameMs ?? 50;
  }

  /** Records a frame that finished at `nowMs` and took `deltaMs`. Ignores absurd values (tab switches). */
  push(deltaMs: number, nowMs: number): void {
    if (!(deltaMs > 0) || deltaMs > 5000) return;
    this.ring[this.head] = deltaMs;
    this.stamps[this.head] = nowMs;
    this.head = (this.head + 1) % this.ring.length;
    if (this.count < this.ring.length) this.count += 1;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
  }

  summary(nowMs: number): FrameSummary {
    const n = this.count;
    if (n === 0) return { fps1s: 0, fps10s: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, longFrames: 0, samples: 0 };
    let in1s = 0;
    let in10s = 0;
    let longFrames = 0;
    for (let i = 0; i < n; i++) {
      const idx = (this.head - 1 - i + this.ring.length) % this.ring.length;
      const age = nowMs - (this.stamps[idx] ?? 0);
      const d = this.ring[idx] ?? 0;
      if (age <= 1000) in1s += 1;
      if (age <= 10_000) in10s += 1;
      if (d > this.longFrameMs) longFrames += 1;
      this.sorted[i] = d;
    }
    const view = this.sorted.subarray(0, n);
    view.sort();
    const pick = (q: number) => view[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))] ?? 0;
    return {
      fps1s: in1s,
      fps10s: Math.round((in10s / Math.min(10, Math.max(1, (nowMs - this.oldestStamp(nowMs, 10_000)) / 1000))) * 10) / 10,
      p50Ms: round1(pick(0.5)),
      p95Ms: round1(pick(0.95)),
      p99Ms: round1(pick(0.99)),
      longFrames,
      samples: n,
    };
  }

  /** The oldest stamp within `windowMs`, or `nowMs - windowMs` when the ring spans more than that. */
  private oldestStamp(nowMs: number, windowMs: number): number {
    let oldest = nowMs;
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - 1 - i + this.ring.length) % this.ring.length;
      const s = this.stamps[idx] ?? nowMs;
      if (nowMs - s > windowMs) break;
      oldest = s;
    }
    return oldest;
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Process-wide stats the canvas probe writes to and the HUD/sampler read from. */
export const frameStats = new FrameStats();
