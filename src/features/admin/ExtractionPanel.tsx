"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatCents } from "@/lib/utils/money";
import type { Extraction } from "@/lib/onboarding/types";
import { Section, Thumb } from "./fields";

/**
 * "What we found": the extraction exactly as stored, so the reviewer compares the proposal against
 * the source rather than trusting it. Everything here is untrusted page content rendered as text.
 */
export function ExtractionPanel({ extraction }: { extraction: Extraction }) {
  const x = extraction;
  const warnings = [...x.warnings, ...(x.meta.structuringWarnings ?? [])];
  return (
    <Section
      eyebrow="Source"
      title="What we found"
      aside={
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={x.platform === "shopify" ? "mint" : "sodium"}>{x.platform === "shopify" ? "Shopify catalog" : "Generic page"}</Badge>
          <Badge tone={x.meta.proposalSource === "ai" ? "signal" : "neutral"}>
            {x.meta.proposalSource === "ai" ? `AI proposal${x.meta.model ? ` · ${x.meta.model}` : ""}` : "Heuristic proposal (no AI)"}
          </Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-[14px]" data-testid="extraction-panel">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2">
          <dt className="text-fog-3">Source</dt>
          <dd className="min-w-0">
            <a href={x.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 break-all text-sky hover:underline">
              {x.sourceUrl}
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </a>
          </dd>
          <dt className="text-fog-3">Name</dt>
          <dd>{x.name ?? <span className="text-fog-3">—</span>}</dd>
          <dt className="text-fog-3">Description</dt>
          <dd className="text-fog-2">{x.description ?? <span className="text-fog-3">—</span>}</dd>
          <dt className="text-fog-3">Fetched</dt>
          <dd className="tabular text-fog-2">{x.fetchedAt ? new Date(x.fetchedAt).toLocaleString() : "—"}</dd>
          {x.categories.length ? (
            <>
              <dt className="text-fog-3">Collections</dt>
              <dd className="text-fog-2">{x.categories.map((c) => c.title).join(", ")}</dd>
            </>
          ) : null}
        </dl>

        <div>
          <p className="mb-2 text-[12px] font-medium text-fog-2">Logo candidates</p>
          {x.logoCandidates.length ? (
            <ul className="flex flex-wrap gap-2">
              {x.logoCandidates.map((url) => (
                <li key={url} className="flex flex-col items-center gap-1">
                  <Thumb src={url} alt="Logo candidate" className="h-14 w-14" />
                  <span className="max-w-[4.5rem] truncate text-[10px] text-fog-3" title={url}>
                    {url.split("/").pop()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-fog-3">None found.</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-[12px] font-medium text-fog-2">Colours</p>
          {x.colorCandidates.length ? (
            <ul className="flex flex-wrap gap-2">
              {x.colorCandidates.map((c) => (
                <li key={c} className="flex items-center gap-1.5 rounded-md border border-line px-1.5 py-1">
                  <span className="h-4 w-4 rounded-sm border border-white/20" style={{ background: c }} aria-hidden="true" />
                  <span className="font-mono text-[12px] text-fog-2">{c}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-fog-3">None found.</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-[12px] font-medium text-fog-2">Products ({x.products.length}), source prices</p>
          {x.products.length ? (
            <div className="scroll-thin max-h-80 overflow-auto rounded-lg border border-line">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-ink text-[11px] uppercase tracking-wide text-fog-3">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Item</th>
                    <th className="px-2 py-1.5 font-medium">Price</th>
                    <th className="hidden px-2 py-1.5 font-medium sm:table-cell">Variants</th>
                  </tr>
                </thead>
                <tbody>
                  {x.products.map((p) => {
                    const prices = [...new Set(p.variants.map((v) => v.priceCents))].sort((a, b) => a - b);
                    return (
                      <tr key={p.id || p.handle} className="border-t border-line align-top">
                        <td className="px-2 py-1.5">
                          <div className="flex items-start gap-2">
                            <Thumb src={p.images[0]} alt="" className="h-9 w-9" />
                            <div className="min-w-0">
                              <p className="font-medium text-fog">{p.title}</p>
                              <p className="text-[11px] text-fog-3">{[p.productType, p.handle].filter(Boolean).join(" · ")}</p>
                            </div>
                          </div>
                        </td>
                        <td className="tabular whitespace-nowrap px-2 py-1.5">
                          {prices.length > 1 ? `${formatCents(prices[0] ?? 0)}–${formatCents(prices.at(-1) ?? 0)}` : formatCents(p.priceCents)}
                        </td>
                        <td className="hidden px-2 py-1.5 text-fog-2 sm:table-cell">
                          {p.variants.length > 1 ? `${p.variants.length} (${p.variants.filter((v) => v.available).length} available)` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-fog-3">No catalog was found. Adding products by hand is not supported yet, so this draft cannot be approved.</p>
          )}
        </div>

        {warnings.length ? (
          <div className="rounded-lg border border-sodium/30 bg-sodium/8 p-3">
            <p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-sodium">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Warnings ({warnings.length})
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-fog-2">
              {warnings.slice(0, 20).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
