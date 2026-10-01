import type { CurrencyCode } from "@/types/domain";

const SYMBOLS: Record<CurrencyCode, string> = { USD: "$", EUR: "€", GBP: "£" };

export function formatCents(cents: number, currency: CurrencyCode = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const remStr = rem === 0 ? "" : `.${rem.toString().padStart(2, "0")}`;
  return `${sign}${SYMBOLS[currency]}${dollars.toLocaleString("en-US")}${remStr}`;
}

/** Parses "$25", "25", "25.50" into cents. Returns null when not parseable. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
