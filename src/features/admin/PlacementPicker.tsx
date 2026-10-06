"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { District, Parcel } from "@/types/domain";
import type { ParcelOutline, PlacementsResponse } from "@/lib/onboarding/api";
import { placementProblem } from "@/lib/onboarding/placement";
import { facing, parcelRect, type ProposalMerchant } from "./editor";
import { Section, SelectField } from "./fields";

export interface PlacementChoice {
  districtId: string;
  parcelId: string;
}

/**
 * District → free parcel. Fit is recomputed here from the template and type being edited (the
 * server re-checks on approval), so changing the template immediately shows which lots it fits.
 */
export function PlacementPicker({
  data,
  error,
  merchant,
  placement,
  onChange,
}: {
  data: PlacementsResponse | null;
  error: string | null;
  merchant: Pick<ProposalMerchant, "storefrontTemplate" | "merchantType">;
  placement: PlacementChoice | undefined;
  onChange: (p: PlacementChoice | null) => void;
}) {
  const [districtId, setDistrictId] = useState<string | undefined>(placement?.districtId);
  const activeDistrictId = districtId ?? placement?.districtId ?? data?.suggestedDistrictId ?? data?.districts[0]?.id;
  const district = data?.districts.find((d) => d.id === activeDistrictId);
  const free = (data?.parcels ?? [])
    .filter((o) => o.parcel.districtId === activeDistrictId)
    .map((o) => ({ parcel: o.parcel, problem: placementProblem(merchant.storefrontTemplate, merchant.merchantType, o.parcel) }));
  const taken = (data?.taken ?? []).filter((p) => p.districtId === activeDistrictId);
  const selected = placement && (data?.parcels ?? []).find((o) => o.parcel.id === placement.parcelId)?.parcel;
  const suggested = data?.districts.find((d) => d.id === data.suggestedDistrictId);

  return (
    <Section eyebrow="City" title="Placement" aside={selected ? <Badge tone="mint">{selected.slug}</Badge> : <Badge tone="sodium">Not placed</Badge>}>
      {error ? <p className="text-[14px] text-danger">{error}</p> : null}
      {!data ? (
        <p className="text-[14px] text-fog-3">Loading free parcels…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" data-testid="placement-picker">
          <div className="flex flex-col gap-3">
            <SelectField
              label="District"
              value={activeDistrictId ?? ""}
              testId="placement-district"
              options={data.districts.map((d) => {
                const n = data.parcels.filter((o) => o.parcel.districtId === d.id).length;
                return { value: d.id, label: `${d.name} (${n} free)${d.id === data.suggestedDistrictId ? " · suggested" : ""}` };
              })}
              onChange={(id) => setDistrictId(id)}
              hint={suggested ? `Suggested for ${merchant.merchantType}: ${suggested.name}` : undefined}
            />
            {free.length === 0 ? (
              <p className="text-[14px] text-fog-3">No free parcels in this district.</p>
            ) : (
              <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label="Free parcels">
                {free.map(({ parcel, problem }) => {
                  const isSelected = placement?.parcelId === parcel.id;
                  return (
                    <li key={parcel.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        disabled={Boolean(problem)}
                        onClick={() => onChange({ districtId: parcel.districtId, parcelId: parcel.id })}
                        data-testid="parcel-option"
                        data-parcel={parcel.slug}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-[14px] transition-colors",
                          isSelected ? "border-signal bg-signal/12" : "border-line hover:bg-white/4",
                          problem && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <MapPin className={cn("h-4 w-4", isSelected ? "text-signal" : "text-fog-3")} aria-hidden="true" />
                          <span className="font-medium">{parcel.slug}</span>
                          <Badge tone={parcel.tier === "corner" || parcel.tier === "flagship" ? "sodium" : "neutral"}>{parcel.tier}</Badge>
                          {parcel.sponsored ? <Badge tone="signal">sponsored lot</Badge> : null}
                        </span>
                        <span className="text-[12px] text-fog-3">{problem ? "Template does not fit" : `${parcel.size.width}×${parcel.size.depth} m`}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {placement ? (
              <button type="button" className="self-start text-[12px] text-fog-3 underline-offset-2 hover:text-fog hover:underline" onClick={() => onChange(null)}>
                Clear placement
              </button>
            ) : null}
          </div>
          {district ? (
            <ParcelMap
              district={district}
              free={free}
              taken={taken}
              selectedId={placement?.parcelId}
              onSelect={(parcel) => onChange({ districtId: parcel.districtId, parcelId: parcel.id })}
            />
          ) : null}
        </div>
      )}
    </Section>
  );
}

const COLORS = {
  ground: "#14171d",
  taken: "#2a2e38",
  takenEdge: "#3a3f4b",
  fit: "rgba(127, 224, 193, 0.18)",
  fitEdge: "#7fe0c1",
  misfitEdge: "rgba(233, 230, 223, 0.35)",
  selected: "rgba(255, 90, 54, 0.55)",
  selectedEdge: "#ff5a36",
  label: "rgba(233, 230, 223, 0.7)",
};

/** Top-down sketch of the district: bounds, every lot, the facing side of each, the selection. */
function ParcelMap({
  district,
  free,
  taken,
  selectedId,
  onSelect,
}: {
  district: District;
  free: Array<{ parcel: Parcel; problem: string | null }>;
  taken: ParcelOutline[];
  selectedId: string | undefined;
  onSelect: (p: Parcel) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const b = district.bounds;
  const pad = 6;
  const spanX = b.maxX - b.minX + pad * 2;
  const spanZ = b.maxZ - b.minZ + pad * 2;
  const height = width ? Math.round(Math.min(360, Math.max(160, (width * spanZ) / spanX))) : 0;

  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = Math.min(width / spanX, height / spanZ);
    const ox = (width - spanX * scale) / 2 - (b.minX - pad) * scale;
    const oz = (height - spanZ * scale) / 2 - (b.minZ - pad) * scale;
    const X = (x: number) => ox + x * scale;
    const Z = (z: number) => oz + z * scale;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.ground;
    ctx.strokeStyle = district.theme.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.fillRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
    ctx.strokeRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);

    const drawLot = (p: Pick<Parcel, "position" | "rotationY" | "size" | "slug">, fill: string, edge: string, dashed: boolean, lineWidth = 1) => {
      const r = parcelRect(p);
      ctx.fillStyle = fill;
      ctx.strokeStyle = edge;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(dashed ? [3, 3] : []);
      ctx.fillRect(X(r.minX), Z(r.minZ), (r.maxX - r.minX) * scale, (r.maxZ - r.minZ) * scale);
      ctx.strokeRect(X(r.minX), Z(r.minZ), (r.maxX - r.minX) * scale, (r.maxZ - r.minZ) * scale);
      // Facade side: a bar along the edge the storefront faces.
      const f = facing(p.rotationY);
      ctx.setLineDash([]);
      ctx.strokeStyle = edge;
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (f.z !== 0) {
        const z = f.z > 0 ? r.maxZ : r.minZ;
        ctx.moveTo(X(r.minX + 1), Z(z));
        ctx.lineTo(X(r.maxX - 1), Z(z));
      } else {
        const x = f.x > 0 ? r.maxX : r.minX;
        ctx.moveTo(X(x), Z(r.minZ + 1));
        ctx.lineTo(X(x), Z(r.maxZ - 1));
      }
      ctx.stroke();
      if ((r.maxX - r.minX) * scale > 34) {
        ctx.fillStyle = COLORS.label;
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.slug, X(p.position.x), Z(p.position.z));
      }
    };

    for (const p of taken) drawLot(p, COLORS.taken, COLORS.takenEdge, false);
    for (const { parcel, problem } of free) {
      if (parcel.id === selectedId) continue;
      drawLot(parcel, problem ? "transparent" : COLORS.fit, problem ? COLORS.misfitEdge : COLORS.fitEdge, Boolean(problem));
    }
    const sel = free.find((o) => o.parcel.id === selectedId)?.parcel;
    if (sel) drawLot(sel, COLORS.selected, COLORS.selectedEdge, false, 2);
  }, [width, height, district, free, taken, selectedId, b, spanX, spanZ]);

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = Math.min(width / spanX, height / spanZ);
    const ox = (width - spanX * scale) / 2 - (b.minX - pad) * scale;
    const oz = (height - spanZ * scale) / 2 - (b.minZ - pad) * scale;
    const wx = (e.clientX - rect.left - ox) / scale;
    const wz = (e.clientY - rect.top - oz) / scale;
    const hit = free.find(({ parcel, problem }) => {
      if (problem) return false;
      const r = parcelRect(parcel);
      return wx >= r.minX && wx <= r.maxX && wz >= r.minZ && wz <= r.maxZ;
    });
    if (hit) onSelect(hit.parcel);
  };

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <div className="w-full overflow-hidden rounded-xl border border-line bg-night">
        <canvas
          ref={canvasRef}
          onClick={onClick}
          style={{ width: "100%", height: height || 200, display: "block", cursor: "pointer" }}
          role="img"
          aria-label={`Map of ${district.name}: free parcels outlined, taken lots filled, the selected lot in orange`}
          data-testid="placement-map"
        />
      </div>
      <figcaption className="flex flex-wrap gap-3 text-[11px] text-fog-3">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm border border-mint bg-mint/20" /> free, fits</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-fog-3" /> free, does not fit</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#2a2e38]" /> taken</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-signal/60" /> selected</span>
        <span>Thick edge = storefront side. North is up.</span>
      </figcaption>
    </figure>
  );
}
