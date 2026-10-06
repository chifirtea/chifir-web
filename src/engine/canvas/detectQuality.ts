import type { QualityTier } from "./quality";

/** Everything the heuristics look at, so the mapping can be unit-tested without a browser. */
export interface QualitySignals {
  mobile: boolean;
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.deviceMemory in GB (Chromium only). */
  deviceMemory?: number;
  /** WEBGL_debug_renderer_info unmasked renderer string. */
  gpu?: string;
}

export interface DetectedQuality {
  tier: QualityTier;
  mobile: boolean;
  gpu?: string;
}

/** Software rasterisers: nothing runs well, whatever the CPU says. */
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|microsoft basic render|mesa offscreen/i;

/** Phone GPUs that struggle with shadows and 1.5× DPR. */
const WEAK_MOBILE_GPU = [
  /\bMali-4\d\d\b/i, // Mali-400/450
  /\bMali-T[67]\d\d\b/i, // Mali-T6xx/T7xx
  /\bAdreno\b[^0-9]*[345]\d\d\b/i, // Adreno 3xx/4xx/5xx
  /\bPowerVR\b/i,
  /\bApple A(9|10|11) GPU\b/i,
];

/** Integrated Intel from the HD/UHD Graphics era (Iris Xe / Arc are not matched). */
const INTEGRATED_INTEL = /\bIntel\b.*\b(U?HD Graphics|Iris(?! Xe)( Plus| Pro)? Graphics)\b/i;

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

/** Pure mapping from device signals to a starting tier. */
export function tierFromSignals(signals: QualitySignals): QualityTier {
  const gpu = signals.gpu ?? "";
  if (gpu && SOFTWARE_GPU.test(gpu)) return "low";

  if (signals.mobile) {
    if (signals.deviceMemory !== undefined && signals.deviceMemory <= 3) return "low";
    if (signals.cores !== undefined && signals.cores <= 4) return "low";
    if (gpu && matchesAny(gpu, WEAK_MOBILE_GPU)) return "low";
    return "medium";
  }

  if (signals.cores !== undefined && signals.cores <= 4) return "medium";
  if (gpu && INTEGRATED_INTEL.test(gpu)) return "medium";
  if (gpu && matchesAny(gpu, WEAK_MOBILE_GPU)) return "medium";
  return "high";
}

/**
 * Phone/tablet detection from the UA plus touch points. iPadOS 13+ reports a Macintosh UA, but a
 * Mac never has more than one touch point.
 */
export function isMobileDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/\b(Android|iPhone|iPad|iPod|Mobile|Windows Phone)\b/i.test(userAgent)) return true;
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

/** Reads the unmasked renderer through a throwaway context. Returns undefined without WebGL. */
export function readGpuRenderer(): string | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return undefined;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const raw: unknown = info
      ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return typeof raw === "string" && raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

type NavigatorWithMemory = Navigator & { deviceMemory?: number };

/**
 * Decides the starting quality tier and form factor. Browser-only; on the server it returns the
 * medium desktop preset so SSR never throws.
 */
const TIERS = new Set<QualityTier>(["low", "medium", "high"]);

/** Explicit override for QA and support: `?quality=low` or localStorage `chifir.quality`. */
export function readQualityOverride(): QualityTier | null {
  if (typeof window === "undefined") return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("quality");
    if (fromUrl && TIERS.has(fromUrl as QualityTier)) return fromUrl as QualityTier;
    const stored = window.localStorage.getItem("chifir.quality");
    if (stored && TIERS.has(stored as QualityTier)) return stored as QualityTier;
  } catch {
    // Storage may be unavailable (private mode); ignore.
  }
  return null;
}

export function detectInitialQuality(): DetectedQuality {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { tier: "medium", mobile: false };
  }
  const nav = navigator as NavigatorWithMemory;
  const mobile = isMobileDevice(nav.userAgent ?? "", nav.maxTouchPoints ?? 0);
  const gpu = readGpuRenderer();
  const override = readQualityOverride();
  if (override) return gpu ? { tier: override, mobile, gpu } : { tier: override, mobile };
  const tier = tierFromSignals({
    mobile,
    cores: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined,
    gpu,
  });
  return gpu ? { tier, mobile, gpu } : { tier, mobile };
}
