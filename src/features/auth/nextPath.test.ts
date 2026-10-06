import { describe, expect, it } from "vitest";
import { authPath, safeNextPath } from "./nextPath";

describe("safeNextPath", () => {
  it("accepts same-origin absolute paths", () => {
    expect(safeNextPath("/account")).toBe("/account");
    expect(safeNextPath("/city?to=kori-ramen")).toBe("/city?to=kori-ramen");
    expect(safeNextPath("/orders/abc#status")).toBe("/orders/abc#status");
  });

  it("falls back for anything that could leave the origin", () => {
    expect(safeNextPath("//evil.example")).toBe("/city");
    expect(safeNextPath("/\\evil.example")).toBe("/city");
    expect(safeNextPath("https://evil.example")).toBe("/city");
    expect(safeNextPath("javascript:alert(1)")).toBe("/city");
    expect(safeNextPath("account")).toBe("/city");
    expect(safeNextPath("/account\r\nSet-Cookie: x=1")).toBe("/city");
  });

  it("falls back for non-strings, empty and oversized values", () => {
    expect(safeNextPath(undefined)).toBe("/city");
    expect(safeNextPath(null)).toBe("/city");
    expect(safeNextPath(42)).toBe("/city");
    expect(safeNextPath("")).toBe("/city");
    expect(safeNextPath("   ")).toBe("/city");
    expect(safeNextPath("/" + "a".repeat(600))).toBe("/city");
  });

  it("never redirects back into the auth pages", () => {
    expect(safeNextPath("/auth/login")).toBe("/city");
    expect(safeNextPath("/auth")).toBe("/city");
    expect(safeNextPath("/authors")).toBe("/authors");
  });

  it("honours a custom fallback", () => {
    expect(safeNextPath("//x", "/")).toBe("/");
  });
});

describe("authPath", () => {
  it("omits next when it is the default", () => {
    expect(authPath("login")).toBe("/auth/login");
    expect(authPath("login", "/city")).toBe("/auth/login");
    expect(authPath("signup", "//evil")).toBe("/auth/signup");
  });

  it("encodes a custom next path", () => {
    expect(authPath("login", "/account")).toBe("/auth/login?next=%2Faccount");
    expect(authPath("signup", "/city?to=a&b=c")).toBe("/auth/signup?next=%2Fcity%3Fto%3Da%26b%3Dc");
  });
});
