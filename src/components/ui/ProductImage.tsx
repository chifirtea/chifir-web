"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { BrandPalette } from "@/types/domain";

export interface ProductImageProps {
  src?: string;
  alt: string;
  brand?: BrandPalette;
  className?: string;
  /** Fallback label when the image is missing or fails (usually the product title). */
  label?: string;
}

/**
 * External merchant images are untrusted URLs: render with a branded fallback rather than a
 * broken image. Never uses the Next image optimizer (per-merchant domain allowlists do not scale).
 */
export function ProductImage({ src, alt, brand, className, label }: ProductImageProps) {
  const [failed, setFailed] = useState(false);
  const showFallback = !src || failed;
  const primary = brand?.primary ?? "#1a1d24";
  const secondary = brand?.secondary ?? "#2c313c";
  const accent = brand?.accent ?? "#ffc46b";
  const initial = (label ?? alt).trim().charAt(0).toUpperCase() || "•";

  return (
    <div className={cn("relative overflow-hidden bg-ink-2", className)}>
      {showFallback ? (
        <div
          className="absolute inset-0 flex items-end p-3"
          style={{ background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)` }}
          role="img"
          aria-label={alt}
        >
          <span
            className="font-display text-5xl font-bold leading-none"
            style={{ color: accent, opacity: 0.9 }}
            aria-hidden="true"
          >
            {initial}
          </span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}
