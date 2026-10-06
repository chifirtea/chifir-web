/**
 * The image pipeline. Merchant and product imagery are plain URLs in the data (`logoUrl`,
 * `heroImageUrl`, `images[]`, `product.imageUrl`, `product.images[]`); nothing else in the app
 * knows where an image is hosted. Every `<img>` and every 3D texture resolves its URL through
 * `resolveImage`, which is the single place to add a CDN prefix or an optimizer later.
 *
 * Policy (see docs/MEDIA.md):
 * - Absolute URLs (`https://…`, `data:`, `blob:`, protocol-relative) pass through untouched.
 * - Relative paths are prefixed with `NEXT_PUBLIC_IMAGE_CDN_BASE` when set, else served as-is
 *   from `/public`.
 * - An optimizer, when configured, rewrites the final URL for a requested width/height/quality.
 *   Without one, `imageSrcSet` returns "" so callers fall back to a single `src`.
 */

export type MediaRef =
  | string
  | {
      url: string;
      alt?: string;
      width?: number;
      height?: number;
    };

export interface ImageOptions {
  /** Requested rendered width in CSS px (or texture px). */
  width?: number;
  height?: number;
  /** 1–100; only meaningful once an optimizer is configured. */
  quality?: number;
}

export type ImageOptimizer = (url: string, opts: ImageOptions) => string;

const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** Default candidate widths for `srcset`; covers thumbs through a full-width product panel. */
export const DEFAULT_SRCSET_WIDTHS: readonly number[] = [320, 640, 960, 1280];

let optimizer: ImageOptimizer | null = null;

export function isAbsoluteUrl(url: string): boolean {
  return ABSOLUTE_URL.test(url);
}

/**
 * Registers the optimizer that rewrites resolved URLs. Called once at startup by whoever wires
 * an image service; `null` restores pass-through. Exposed for tests.
 */
export function setImageOptimizer(fn: ImageOptimizer | null): void {
  optimizer = fn;
}

export function getImageOptimizer(): ImageOptimizer | null {
  return optimizer;
}

/**
 * An optimizer driven by a URL template such as
 * `https://img.example.com/fetch?url={url}&w={width}&h={height}&q={quality}`.
 * `{url}` is percent-encoded; parameters left unspecified in `opts` become empty strings.
 */
export function templateOptimizer(template: string): ImageOptimizer {
  return (url, opts) =>
    template
      .replace(/\{url\}/g, encodeURIComponent(url))
      .replace(/\{width\}/g, opts.width ? String(Math.round(opts.width)) : "")
      .replace(/\{height\}/g, opts.height ? String(Math.round(opts.height)) : "")
      .replace(/\{quality\}/g, opts.quality ? String(Math.round(opts.quality)) : "");
}

function envCdnBase(): string {
  // Referenced literally so Next.js inlines it into the client bundle.
  const raw = process.env.NEXT_PUBLIC_IMAGE_CDN_BASE ?? "";
  return raw.trim().replace(/\/+$/, "");
}

let cdnBaseOverride: string | null = null;

/** Tests only: pins the CDN base without touching the environment. */
export function setImageCdnBase(base: string | null): void {
  cdnBaseOverride = base === null ? null : base.trim().replace(/\/+$/, "");
}

export function imageCdnBase(): string {
  return cdnBaseOverride ?? envCdnBase();
}

/**
 * Largest texture a product card or hero wall needs for a quality tier. Textures never exceed
 * 1024 px: a framed card is well under a metre wide, and the optimizer (when configured)
 * downsizes the merchant's original so phones do not download desktop-sized imagery.
 */
export function textureImageWidth(maxTextureSize: number): number {
  return Math.max(256, Math.min(1024, Math.round(maxTextureSize)));
}

/**
 * Whether a resolved URL can be loaded as a WebGL texture: same-origin paths and remote
 * `http(s)` imagery (loaded with `crossOrigin = "anonymous"`, so the host must send CORS
 * headers; see docs/MEDIA.md). `data:` and `blob:` URLs are allowed; anything else is not.
 */
export function isTextureUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  return /^(?:https?:|data:image\/|blob:|\/\/)/i.test(url);
}

/** The URL string behind a `MediaRef`, or undefined when there is none. */
export function mediaUrl(ref: MediaRef | null | undefined): string | undefined {
  if (!ref) return undefined;
  const url = (typeof ref === "string" ? ref : ref.url).trim();
  return url || undefined;
}

/**
 * The URL to load for an image at the requested size. Never throws; an empty ref resolves to
 * an empty string so callers can branch on it.
 */
export function resolveImage(ref: MediaRef | null | undefined, opts: ImageOptions = {}): string {
  const url = mediaUrl(ref);
  if (!url) return "";
  let base: string;
  if (isAbsoluteUrl(url)) {
    base = url;
  } else {
    const cdn = imageCdnBase();
    const path = url.replace(/^\/+/, "");
    base = cdn ? `${cdn}/${path}` : `/${path}`;
  }
  return optimizer ? optimizer(base, opts) : base;
}

/**
 * `srcset` for an image, one candidate per width. Returns "" when no optimizer is configured
 * (every candidate would be the same file) so the attribute can simply be omitted.
 */
export function imageSrcSet(
  ref: MediaRef | null | undefined,
  widths: readonly number[] = DEFAULT_SRCSET_WIDTHS,
  opts: Omit<ImageOptions, "width"> = {},
): string {
  const url = mediaUrl(ref);
  if (!url || !optimizer) return "";
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const w of [...widths].sort((a, b) => a - b)) {
    const candidate = resolveImage(url, { ...opts, width: w });
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(`${candidate} ${Math.round(w)}w`);
  }
  return candidates.length > 1 ? candidates.join(", ") : "";
}

/** Boots the optimizer from `NEXT_PUBLIC_IMAGE_OPTIMIZER_TEMPLATE`, when the deployment sets one. */
export function initImagePipelineFromEnv(): void {
  const template = (process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_TEMPLATE ?? "").trim();
  if (template && template.includes("{url}")) setImageOptimizer(templateOptimizer(template));
}

initImagePipelineFromEnv();
