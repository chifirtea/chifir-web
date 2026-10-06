import "server-only";
import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

/**
 * Outbound fetch policy for the merchant generator (ADR-007 security model). A reviewer pastes a
 * URL and the server fetches it, so every hop is checked against the same rules: https only, no
 * credentials, a hostname that resolves to a public unicast address, at most 3 redirects, 10 s,
 * 2 MB, HTML/JSON only. `allowLocal` (dev/test only, refused in production by the caller) admits
 * loopback over http so the flow can run against a local fixture store.
 *
 * Known gap: the address is resolved here and again by `fetch` (TOCTOU / DNS rebinding). Pinning
 * the socket to the checked address needs a custom agent; acceptable for an admin-only prototype.
 */

export type OnboardingErrorCode =
  | "invalid_url"
  | "blocked_host"
  | "fetch_failed"
  | "timeout"
  | "too_large"
  | "too_many_redirects"
  | "unsupported_content";

export class OnboardingError extends Error {
  constructor(
    readonly code: OnboardingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OnboardingError";
  }
}

export const USER_AGENT = "ChifirBot/0.2 (+merchant onboarding)";
export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

const ACCEPT: Record<"html" | "json", string> = {
  html: "text/html,application/xhtml+xml;q=0.9",
  json: "application/json",
};
const ALLOWED_CONTENT_TYPES = /^(text\/html|application\/xhtml\+xml|application\/json|application\/ld\+json|text\/plain|text\/json)\b/i;

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".home.arpa",
  ".onion",
];

// ---------------------------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------------------------

export function parseIPv4(ip: string): [number, number, number, number] | null {
  if (!isIPv4(ip)) return null;
  const parts = ip.split(".").map(Number);
  const [a, b, c, d] = parts;
  if (parts.length !== 4 || a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return [a, b, c, d];
}

/** Expands an IPv6 literal (no brackets, no zone id) into eight 16-bit groups. */
export function parseIPv6(ip: string): number[] | null {
  if (ip.includes("%") || !isIPv6(ip)) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (g.includes(".")) {
        const v4 = parseIPv4(g);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        out.push(parseInt(g, 16));
      }
    }
    return out;
  };
  const head = toGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

export function isPublicIPv4([a, b, c]: readonly [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return false; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier NAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF protocol, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

export function isPublicIPv6(g: readonly number[]): boolean {
  if (g.length !== 8) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const embedded = (hi: number, lo: number): [number, number, number, number] => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  const leadingZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (leadingZero && g5 === 0xffff) return isPublicIPv4(embedded(g6, g7)); // IPv4-mapped
  if (leadingZero) return false; // ::, ::1, IPv4-compatible (deprecated)
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPublicIPv4(embedded(g6, g7)); // NAT64 well-known prefix
  }
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return false; // discard-only 100::/64
  if ((g0 & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return false; // link-local
  if ((g0 & 0xffc0) === 0xfec0) return false; // site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return false; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  if (g0 === 0x2001 && g1 === 0) return false; // Teredo tunnels (obfuscated inner address)
  if (g0 === 0x2002) return isPublicIPv4(embedded(g1, g2)); // 6to4
  return true;
}

/** True when the literal is a routable public unicast address (v4 or v6). Unparseable = false. */
export function isPublicIp(ip: string): boolean {
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const v4 = parseIPv4(bare);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(bare);
  return v6 ? isPublicIPv6(v6) : false;
}

export function isLoopbackIp(ip: string): boolean {
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const v4 = parseIPv4(bare);
  if (v4) return v4[0] === 127;
  const v6 = parseIPv6(bare);
  if (!v6) return false;
  if (v6.slice(0, 5).every((x) => x === 0) && v6[5] === 0xffff) return (v6[6] ?? 0) >> 8 === 127;
  return v6.slice(0, 7).every((x) => x === 0) && v6[7] === 1;
}

export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

// ---------------------------------------------------------------------------------------------
// URL policy
// ---------------------------------------------------------------------------------------------

export interface UrlPolicyOptions {
  /** Permit http + loopback (local fixture server). Callers must refuse this in production. */
  allowLocal?: boolean;
}

const isLocalHostname = (h: string) => h === "localhost" || h.endsWith(".localhost");

/** Parses and checks a URL against the fetch policy; throws `OnboardingError("invalid_url" | "blocked_host")`. */
export function checkUrlPolicy(input: string, opts: UrlPolicyOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new OnboardingError("invalid_url", "That is not a valid URL.");
  }
  if (url.username || url.password) {
    throw new OnboardingError("invalid_url", "URLs with credentials are not allowed.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new OnboardingError("invalid_url", "The URL has no host.");
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  const literal = isIPv4(bare) || isIPv6(bare);
  const local = opts.allowLocal === true && (isLocalHostname(host) || (literal && isLoopbackIp(bare)));

  if (local) {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new OnboardingError("invalid_url", "Only http(s) URLs are allowed for local fixtures.");
    }
  } else {
    if (url.protocol !== "https:") throw new OnboardingError("invalid_url", "Only https:// store URLs are allowed.");
    if (url.port && url.port !== "443") throw new OnboardingError("invalid_url", "Only the default https port is allowed.");
    if (isBlockedHostname(host)) throw new OnboardingError("blocked_host", `"${host}" is not a public host.`);
    if (literal && !isPublicIp(bare)) throw new OnboardingError("blocked_host", "That address is not public.");
  }
  url.hash = "";
  return url;
}

// ---------------------------------------------------------------------------------------------
// Guarded fetch
// ---------------------------------------------------------------------------------------------

export interface FetchDeps {
  fetch?: typeof fetch;
  /** Resolves a hostname to every address it maps to. Defaults to `dns.promises.lookup(all: true)`. */
  resolve?: (hostname: string) => Promise<string[]>;
}

export interface SafeFetchOptions extends UrlPolicyOptions {
  accept: "html" | "json";
}

export interface SafeFetchResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
}

const defaultResolve = async (hostname: string): Promise<string[]> =>
  (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

/** Every address a hostname resolves to must be public (or loopback when `allowLocal`). */
export async function assertPublicHost(url: URL, opts: UrlPolicyOptions, deps: FetchDeps = {}): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  if (isIPv4(bare) || isIPv6(bare)) return; // literals were classified by the URL policy
  let addresses: string[];
  try {
    addresses = await (deps.resolve ?? defaultResolve)(host);
  } catch {
    throw new OnboardingError("fetch_failed", `Could not resolve "${host}".`);
  }
  if (addresses.length === 0) throw new OnboardingError("blocked_host", `"${host}" does not resolve.`);
  for (const address of addresses) {
    const ok = isPublicIp(address) || (opts.allowLocal === true && isLoopbackIp(address));
    if (!ok) throw new OnboardingError("blocked_host", `"${host}" resolves to a non-public address.`);
  }
}

async function readCapped(res: Response, controller: AbortController): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new OnboardingError("too_large", "The page is larger than 2 MB.");
  if (!res.body) {
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) throw new OnboardingError("too_large", "The page is larger than 2 MB.");
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      controller.abort();
      throw new OnboardingError("too_large", "The page is larger than 2 MB.");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    joined.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(joined);
}

/**
 * GET with the policy applied to the first URL and to every redirect target. Non-2xx responses
 * are returned (with an empty body) so callers can tell "not a Shopify store" from "blocked".
 */
export async function safeFetch(input: string, opts: SafeFetchOptions, deps: FetchDeps = {}): Promise<SafeFetchResult> {
  const fetchImpl = deps.fetch ?? fetch;
  let current = checkUrlPolicy(input, opts);
  for (let hop = 0; ; hop++) {
    await assertPublicHost(current, opts, deps);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { accept: ACCEPT[opts.accept], "user-agent": USER_AGENT, "accept-language": "en" },
        });
      } catch (err) {
        if (controller.signal.aborted) throw new OnboardingError("timeout", "The store took longer than 10 seconds to answer.");
        throw new OnboardingError("fetch_failed", `Could not reach ${current.hostname}.`, { cause: err });
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new OnboardingError("fetch_failed", "The store redirected without a destination.");
        if (hop >= MAX_REDIRECTS) throw new OnboardingError("too_many_redirects", "Too many redirects.");
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new OnboardingError("invalid_url", "The store redirected to an invalid URL.");
        }
        current = checkUrlPolicy(next.toString(), opts);
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) return { url: current.toString(), status: res.status, ok: false, contentType, text: "" };
      if (contentType && !ALLOWED_CONTENT_TYPES.test(contentType)) {
        throw new OnboardingError("unsupported_content", `Unsupported content type "${contentType.split(";")[0]}".`);
      }
      const text = await readCapped(res, controller);
      return { url: current.toString(), status: res.status, ok: true, contentType, text };
    } finally {
      clearTimeout(timer);
    }
  }
}
