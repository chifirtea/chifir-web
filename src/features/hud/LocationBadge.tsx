"use client";

import { useEffect, useRef, useState } from "react";
import { districtAt } from "@/city/cityIndex";
import { useCityStore } from "@/city/cityStore";
import { playerRig } from "@/engine/player/playerRig";
import { useWorldStore } from "@/engine/store/worldStore";
import { track } from "@/lib/analytics/client";

const POLL_MS = 250; // ~4 Hz

interface Plate {
  eyebrow: string;
  name: string;
  background: string;
  border: string;
  text: string;
}

/**
 * The signature HUD element: an enamel street sign that names where you are. On the street it
 * shows the district (plate tinted by the district accent); inside a store it takes the merchant's
 * brand colours, like the sign above the door.
 */
export function LocationBadge() {
  const index = useCityStore((s) => s.index);
  const location = useWorldStore((s) => s.location);
  const [districtId, setDistrictId] = useState<string | null>(null);
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!index || location.kind !== "street") return;
    let raf = 0;
    let last = -Infinity;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < POLL_MS) return;
      last = t;
      const id = districtAt(index, playerRig.x, playerRig.z)?.id ?? null;
      setDistrictId((prev) => (prev === id ? prev : id));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [index, location.kind]);

  useEffect(() => {
    if (location.kind !== "street" || !districtId || lastTracked.current === districtId) return;
    lastTracked.current = districtId;
    track("district_entered", { districtId });
  }, [districtId, location.kind]);

  const merchant =
    location.kind === "interior" ? index?.merchantsById[location.merchantId] : undefined;
  const district = districtId ? index?.districtsById[districtId] : undefined;

  const plate: Plate = merchant
    ? {
        eyebrow: "Inside",
        name: merchant.name,
        background: merchant.brand.primary,
        border: merchant.brand.accent,
        text: merchant.brand.onPrimary,
      }
    : {
        eyebrow: "District",
        name: district?.name ?? "The city",
        background: `color-mix(in oklab, ${district?.theme.accent ?? "#ffc46b"} 22%, var(--color-ink))`,
        border: `color-mix(in oklab, ${district?.theme.accent ?? "#ffc46b"} 45%, var(--color-fog))`,
        text: "var(--color-fog)",
      };

  return (
    <div role="status" aria-live="polite" data-testid="location-badge" className="pointer-events-auto select-none">
      <div
        className="relative rounded-[10px] px-4 py-2 shadow-sign"
        style={{
          backgroundColor: plate.background,
          backgroundImage:
            "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0) 55%)",
          color: plate.text,
          transition: "background-color 400ms ease, color 400ms ease",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[3px] rounded-[7px] border"
          style={{ borderColor: plate.border, opacity: 0.85 }}
        />
        {RIVETS.map((pos) => (
          <span
            key={pos}
            aria-hidden="true"
            className={`pointer-events-none absolute h-[5px] w-[5px] rounded-full ${pos}`}
            style={{
              background:
                "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.95), rgba(255,255,255,0.35) 45%, rgba(0,0,0,0.55) 100%)",
            }}
          />
        ))}
        <div className="font-display text-[10px] leading-none tracking-[0.22em] uppercase opacity-75">
          {plate.eyebrow}
        </div>
        <div className="font-display mt-1 max-w-[52vw] truncate text-[17px] leading-tight font-semibold tracking-tight sm:max-w-[320px]">
          {plate.name}
        </div>
      </div>
    </div>
  );
}

const RIVETS = [
  "top-[4px] left-[4px]",
  "top-[4px] right-[4px]",
  "bottom-[4px] left-[4px]",
  "bottom-[4px] right-[4px]",
];
