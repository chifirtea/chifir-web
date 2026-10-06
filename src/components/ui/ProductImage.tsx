"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { DEFAULT_SRCSET_WIDTHS, imageSrcSet, resolveImage } from "@/lib/media/images";
import { monogram } from "@/lib/media/monogram";
import type { BrandPalette } from "@/types/domain";

export interface ProductImageProps {
  src?: string;
  alt: string;
  brand?: BrandPalette;
  className?: string;
  /** Fallback label when the image is missing or fails (usually the product title). */
  label?: string;
  /** `sizes` hint for the srcset (only used once an image optimizer is configured). */
  sizes?: string;
  /** Rendered width hint for the optimizer, CSS px. */
  width?: number;
}

/**
 * Merchant imagery is an untrusted URL: it goes through the image pipeline (`resolveImage`), fades
 * in once decoded, and falls back to a brand-coloured monogram card instead of a broken image.
 * Never uses the Next image optimizer (per-merchant domain allowlists do not scale).
 */
export function ProductImage({
  src,
  alt,
  brand,
  className,
  label,
  sizes,
  width = 960,
}: ProductImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showFallback = !src || failed;
  const primary = brand?.primary ?? "#1a1d24";
  const secondary = brand?.secondary ?? "#2c313c";
  const accent = brand?.accent ?? "#ffc46b";
  const mark = monogram(label ?? alt) || "•";
  const url = src ? resolveImage(src, { width, quality: 80 }) : "";
  const srcSet = src ? imageSrcSet(src, DEFAULT_SRCSET_WIDTHS) : "";

  return (
    <div
      className={cn("relative overflow-hidden bg-ink-2", className)}
      style={{ background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)` }}
    >
      {showFallback ? (
        <div className="absolute inset-0 flex items-end p-3" role="img" aria-label={alt}>
          <span
            className="font-display text-5xl font-bold leading-none"
            style={{ color: accent, opacity: 0.9 }}
            aria-hidden="true"
          >
            {mark}
          </span>
        </div>
      ) : (
        <img
          src={url}
          {...(srcSet ? { srcSet, sizes: sizes ?? "(max-width: 640px) 100vw, 480px" } : {})}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
