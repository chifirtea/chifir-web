import { describe, expect, it } from "vitest";
import { adminGate, bearerToken, tokensMatch } from "./auth";

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
