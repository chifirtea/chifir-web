/**
 * What kind of machine is running the city. Read once; everything here is best-effort because
 * browsers expose different subsets (deviceMemory and performance.memory are Chromium-only).
 */
export interface DeviceInfo {
  ua: string;
  platform: string;
  mobile: boolean;
  cores?: number;
  deviceMemoryGb?: number;
  dpr: number;
  viewport: { width: number; height: number };
  gpu?: string;
  gpuShort?: string;
  webgl2: boolean;
  maxTextureSize?: number;
  connection?: string;
  reducedMotion: boolean;
}

interface NavigatorExtras {
  deviceMemory?: number;
  connection?: { effectiveType?: string };
  userAgentData?: { mobile?: boolean; platform?: string };
}

/** "Apple GPU", "Adreno 730", "Mali-G78", "NVIDIA RTX 3060", "SwiftShader" … from the renderer string. */
export function shortGpuName(renderer: string | undefined): string | undefined {
  if (!renderer) return undefined;
  const r = renderer.replace(/^ANGLE \((.*)\)$/i, "$1");
  if (/swiftshader|llvmpipe|softpipe/i.test(r)) return "Software (SwiftShader)";
  const apple = r.match(/Apple (M\d( (Pro|Max|Ultra))?|A\d+( Pro)?|GPU)/i);
  if (apple) return `Apple ${apple[1]}`;
  const adreno = r.match(/Adreno(?:\s*\(TM\))?\s*(\d{3})/i);
  if (adreno) return `Adreno ${adreno[1]}`;
  const mali = r.match(/Mali-([A-Z]?\d+)/i);
  if (mali) return `Mali-${mali[1]}`;
  const nvidia = r.match(/NVIDIA[^,]*?((?:GeForce )?(?:RTX|GTX)\s*\d{3,4}\w*)/i);
  if (nvidia) return `NVIDIA ${nvidia[1]!.replace(/GeForce /i, "")}`;
  const amd = r.match(/(Radeon[^,/(]*)/i);
  if (amd) return amd[1]!.trim();
  const intel = r.match(/Intel(?:\(R\))?[^,/]*?((?:Iris|UHD|HD|Arc)(?:\(R\))?[^,/]*)/i);
  if (intel) return `Intel ${intel[1]!.replace(/\(R\)|\(TM\)/gi, "").replace(/\s+/g, " ").trim()}`;
  const parts = r.split(",");
  return (parts[1] ?? parts[0] ?? r).trim().slice(0, 40);
}

export function readDeviceInfo(gpuRenderer: string | undefined): DeviceInfo {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { ua: "server", platform: "server", mobile: false, dpr: 1, viewport: { width: 0, height: 0 }, webgl2: false, reducedMotion: false };
  }
  const nav = navigator as Navigator & NavigatorExtras;
  const mobile = nav.userAgentData?.mobile ?? /\b(Android|iPhone|iPad|iPod|Mobile)\b/i.test(nav.userAgent);
  let webgl2 = false;
  let maxTextureSize: number | undefined;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    webgl2 = Boolean(gl && "drawBuffers" in gl);
    if (gl) maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // no WebGL
  }
  const short = shortGpuName(gpuRenderer);
  return {
    ua: nav.userAgent,
    platform: nav.userAgentData?.platform ?? nav.platform ?? "",
    mobile,
    ...(typeof nav.hardwareConcurrency === "number" ? { cores: nav.hardwareConcurrency } : {}),
    ...(typeof nav.deviceMemory === "number" ? { deviceMemoryGb: nav.deviceMemory } : {}),
    dpr: window.devicePixelRatio || 1,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    ...(gpuRenderer ? { gpu: gpuRenderer } : {}),
    ...(short ? { gpuShort: short } : {}),
    webgl2,
    ...(maxTextureSize ? { maxTextureSize } : {}),
    ...(nav.connection?.effectiveType ? { connection: nav.connection.effectiveType } : {}),
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  };
}

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/** JS heap in MB (Chromium only). */
export function readMemoryMb(): number | undefined {
  if (typeof performance === "undefined") return undefined;
  const mem = (performance as Performance & { memory?: PerformanceMemory }).memory;
  if (!mem || typeof mem.usedJSHeapSize !== "number") return undefined;
  return Math.round(mem.usedJSHeapSize / 1_048_576);
}
