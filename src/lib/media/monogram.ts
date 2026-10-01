/**
 * Initials for a brand or product name, used wherever an image is missing: "Ember & Oak" → "EO",
 * "Kōri Ramen" → "KR", "Northline" → "N". Punctuation and stop-words are skipped so the mark
 * reads like a real monogram rather than an ampersand.
 */
const STOP = new Set(["and", "the", "of", "a", "an", "&", "+", "de", "la", "le", "by"]);

export function monogram(name: string | undefined | null, max = 2): string {
  const words = (name ?? "")
    .split(/[\s\-_/·]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 0 && !STOP.has(w.toLowerCase()));
  const letters = words.slice(0, Math.max(1, max)).map((w) => w.charAt(0).toUpperCase());
  return letters.join("") || "•";
}
