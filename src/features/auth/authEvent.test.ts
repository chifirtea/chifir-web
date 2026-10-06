import { describe, expect, it } from "vitest";
import { decodeAuthEvent, encodeAuthEvent } from "./authEvent";

describe("auth event cookie encoding", () => {
  it("round-trips both flows", () => {
    expect(decodeAuthEvent(encodeAuthEvent("login"))).toEqual({
      name: "login",
      method: "magic_link",
    });
    expect(decodeAuthEvent(encodeAuthEvent("signup"))).toEqual({
      name: "signup",
      method: "magic_link",
    });
  });

  it("rejects anything it did not write", () => {
    expect(decodeAuthEvent(undefined)).toBeNull();
    expect(decodeAuthEvent(null)).toBeNull();
    expect(decodeAuthEvent("")).toBeNull();
    expect(decodeAuthEvent("purchase_completed:magic_link")).toBeNull();
    expect(decodeAuthEvent("login:password")).toBeNull();
    expect(decodeAuthEvent("login")).toBeNull();
  });
});
