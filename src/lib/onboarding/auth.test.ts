import { describe, expect, it } from "vitest";
import { adminGate, bearerToken, crossSiteProblem, tokensMatch } from "./auth";

const TOKEN = "s3cret-admin-token-0123456789";

describe("tokensMatch", () => {
  it("compares exactly, in constant time over digests", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokensMatch(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(tokensMatch(TOKEN.toUpperCase(), TOKEN)).toBe(false);
    expect(tokensMatch("", TOKEN)).toBe(false);
    expect(tokensMatch(undefined, TOKEN)).toBe(false);
    expect(tokensMatch(TOKEN, undefined)).toBe(false);
    expect(tokensMatch(undefined, undefined)).toBe(false);
  });
});

describe("bearerToken", () => {
  it("extracts a single bearer credential", () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`bearer   ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`Basic ${TOKEN}`)).toBeUndefined();
    expect(bearerToken(`Bearer ${TOKEN} extra`)).toBeUndefined();
    expect(bearerToken("Bearer")).toBeUndefined();
    expect(bearerToken(null)).toBeUndefined();
  });
});

describe("adminGate", () => {
  const base = { authorization: null, cookie: undefined };

  it("is open outside production without a token, and absent in production", () => {
    expect(adminGate({ ...base, configuredToken: undefined, isProduction: false })).toBe("ok");
    expect(adminGate({ ...base, configuredToken: undefined, isProduction: true })).toBe("not_found");
    expect(adminGate({ configuredToken: undefined, isProduction: true, authorization: `Bearer ${TOKEN}`, cookie: TOKEN })).toBe("not_found");
  });

  it("requires the bearer header or the cookie once a token is configured (any environment)", () => {
    for (const isProduction of [false, true]) {
      expect(adminGate({ ...base, configuredToken: TOKEN, isProduction })).toBe("unauthorized");
      expect(adminGate({ ...base, configuredToken: TOKEN, isProduction, authorization: `Bearer ${TOKEN}` })).toBe("ok");
      expect(adminGate({ ...base, configuredToken: TOKEN, isProduction, cookie: TOKEN })).toBe("ok");
      expect(adminGate({ ...base, configuredToken: TOKEN, isProduction, authorization: "Bearer wrong-token-wrong-token", cookie: "nope" })).toBe("unauthorized");
    }
  });
});

describe("crossSiteProblem (CSRF)", () => {
  const post = { method: "POST", secFetchSite: null, origin: null, hosts: ["localhost:3100", null] };

  it("lets reads through and refuses cross-site or same-site writes", () => {
    expect(crossSiteProblem({ ...post, method: "GET", secFetchSite: "cross-site" })).toBeNull();
    expect(crossSiteProblem({ ...post, secFetchSite: "same-origin" })).toBeNull();
    expect(crossSiteProblem({ ...post, secFetchSite: "none" })).toBeNull();
    expect(crossSiteProblem({ ...post, secFetchSite: "cross-site" })).toMatch(/refused/);
    expect(crossSiteProblem({ ...post, secFetchSite: "same-site" })).toMatch(/refused/); // a sibling subdomain
    expect(crossSiteProblem({ ...post, method: "PATCH", secFetchSite: "cross-site", origin: "http://localhost:3100" })).toMatch(/refused/);
  });

  it("falls back to Origin vs Host when Sec-Fetch-Site is missing", () => {
    expect(crossSiteProblem({ ...post, origin: "http://localhost:3100" })).toBeNull();
    expect(crossSiteProblem({ ...post, origin: "https://evil.example" })).toMatch(/refused/);
    expect(crossSiteProblem({ ...post, origin: "null" })).toMatch(/refused/);
    expect(crossSiteProblem({ ...post, origin: "https://app.chifir.com", hosts: ["internal:8080", "app.chifir.com"] })).toBeNull();
  });

  it("allows non-browser clients (no Sec-Fetch-Site, no Origin): a CSRF attack cannot send those", () => {
    expect(crossSiteProblem(post)).toBeNull();
  });
});
