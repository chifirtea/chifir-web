import { describe, expect, it } from "vitest";
import {
  MAX_BODY_BYTES,
  OnboardingError,
  USER_AGENT,
  assertPublicHost,
  checkUrlPolicy,
  isBlockedHostname,
  isLoopbackIp,
  isPublicIp,
  parseIPv6,
  safeFetch,
  type FetchDeps,
} from "./ssrf";

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof OnboardingError ? err.code : "other";
  }
  return undefined;
};

const asyncCode = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
  } catch (err) {
    return err instanceof OnboardingError ? err.code : `other: ${String(err)}`;
  }
  return undefined;
};

describe("isPublicIp (IPv4)", () => {
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.169.254", // cloud metadata
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
  ])("rejects %s", (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "23.227.38.65", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "192.167.1.1", "198.17.0.1", "223.255.255.254"])(
    "accepts %s",
    (ip) => {
      expect(isPublicIp(ip)).toBe(true);
    },
  );

  it("rejects malformed literals", () => {
    expect(isPublicIp("256.1.1.1")).toBe(false);
    expect(isPublicIp("1.2.3")).toBe(false);
    expect(isPublicIp("example.com")).toBe(false);
    expect(isPublicIp("")).toBe(false);
  });
});

describe("isPublicIp (IPv6)", () => {
  it.each([
    "::",
    "::1",
    "[::1]",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "::127.0.0.1", // IPv4-compatible (deprecated)
    "64:ff9b::a00:1", // NAT64 of 10.0.0.1
    "100::1",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "ff0e::1",
    "2001:db8::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo
    "2002:0a00:0001::1", // 6to4 of 10.0.0.1
    "fe80::1%eth0", // zone ids are refused outright
    "::ffff:0:a9fe:a9fe", // IPv4-translated 169.254.169.254
    "::ffff:0:7f00:1", // IPv4-translated loopback
    "::ffff:0:a00:1", // IPv4-translated 10.0.0.1
    "64:ff9b:1::a9fe:a9fe", // local-use NAT64 (embedded address position varies): refused outright
    "64:ff9b:1:ffff::808:808",
    "::1:0:0:1", // rest of ::/8
    "1::1", // outside 2000::/3
    "4000::1",
    "2001:2::1", // benchmarking
    "2001:20::1", // ORCHIDv2
    "3fff::1", // documentation 3fff::/20
  ])("rejects %s", (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each([
    "2606:4700:4700::1111",
    "2a00:1450:4001:82b::200e",
    "::ffff:8.8.8.8",
    "::ffff:0:808:808", // IPv4-translated public address
    "64:ff9b::808:808",
    "2002:0808:0808::1",
    "2001:4860:4860::8888",
    "3fff:1000::1", // just past the 3fff::/20 documentation block
  ])(
    "accepts %s",
    (ip) => {
      expect(isPublicIp(ip)).toBe(true);
    },
  );

  it("expands compressed forms", () => {
    expect(parseIPv6("2001:db8::1")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIPv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIPv6("1::2::3")).toBeNull();
    expect(parseIPv6("12345::")).toBeNull();
  });
});

describe("isLoopbackIp / isBlockedHostname", () => {
  it("knows loopback in both families", () => {
    expect(isLoopbackIp("127.0.0.1")).toBe(true);
    expect(isLoopbackIp("127.8.9.10")).toBe(true);
    expect(isLoopbackIp("::1")).toBe(true);
    expect(isLoopbackIp("[::1]")).toBe(true);
    expect(isLoopbackIp("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackIp("10.0.0.1")).toBe(false);
    expect(isLoopbackIp("::2")).toBe(false);
  });

  it("blocks local-only names", () => {
    for (const h of ["localhost", "LOCALHOST", "localhost.", "api.localhost", "printer.local", "db.internal", "box.localdomain", "nas.home.arpa", "x.onion"]) {
      expect(isBlockedHostname(h)).toBe(true);
    }
    for (const h of ["shop.example.com", "localhosting.com", "internal.com", "my-local.store"]) {
      expect(isBlockedHostname(h)).toBe(false);
    }
  });
});

describe("checkUrlPolicy", () => {
  it("accepts public https URLs and drops the fragment", () => {
    const url = checkUrlPolicy("  https://shop.example.com/collections/all#top ");
    expect(url.toString()).toBe("https://shop.example.com/collections/all");
    expect(checkUrlPolicy("https://shop.example.com:443/").port).toBe("");
    expect(checkUrlPolicy("https://8.8.8.8/").hostname).toBe("8.8.8.8");
  });

  it("rejects non-https, credentials, odd ports and garbage", () => {
    expect(code(() => checkUrlPolicy("http://shop.example.com"))).toBe("invalid_url");
    expect(code(() => checkUrlPolicy("ftp://shop.example.com"))).toBe("invalid_url");
    expect(code(() => checkUrlPolicy("file:///etc/passwd"))).toBe("invalid_url");
    expect(code(() => checkUrlPolicy("javascript:alert(1)"))).toBe("invalid_url");
    expect(code(() => checkUrlPolicy("https://user:pass@shop.example.com"))).toBe("invalid_url");
    expect(code(() => checkUrlPolicy("https://user@shop.example.com"))).toBe("invalid_url");
    expect(code(() => checkUrlPolicy("https://shop.example.com:8443"))).toBe("invalid_url");
    expect(code(() => checkUrlPolicy("not a url"))).toBe("invalid_url");
  });

  it("rejects private literals, including the forms WHATWG URL normalises", () => {
    for (const u of [
      "https://127.0.0.1/",
      "https://0x7f.0.0.1/",
      "https://2130706433/",
      "https://0177.0.0.1/",
      "https://10.1.2.3/",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[fd00::1]/",
      "https://localhost/",
      "https://printer.local/",
      "https://metadata.google.internal/",
    ]) {
      expect(code(() => checkUrlPolicy(u)), u).toBe("blocked_host");
    }
  });

  it("allowLocal admits loopback over http, and nothing else", () => {
    expect(checkUrlPolicy("http://127.0.0.1:4310/", { allowLocal: true }).port).toBe("4310");
    expect(checkUrlPolicy("http://localhost:4310/", { allowLocal: true }).hostname).toBe("localhost");
    expect(checkUrlPolicy("http://[::1]:4310/", { allowLocal: true }).hostname).toBe("[::1]");
    expect(code(() => checkUrlPolicy("http://10.0.0.1/", { allowLocal: true }))).toBe("invalid_url");
    expect(code(() => checkUrlPolicy("https://10.0.0.1/", { allowLocal: true }))).toBe("blocked_host");
    expect(code(() => checkUrlPolicy("http://shop.example.com/", { allowLocal: true }))).toBe("invalid_url");
    expect(code(() => checkUrlPolicy("ftp://127.0.0.1/", { allowLocal: true }))).toBe("invalid_url");
  });
});

describe("assertPublicHost", () => {
  const resolveTo =
    (...addresses: string[]): FetchDeps["resolve"] =>
    async () =>
      addresses;

  it("passes when every address is public", async () => {
    await expect(assertPublicHost(new URL("https://shop.example.com"), {}, { resolve: resolveTo("23.227.38.65", "2606:4700::1") })).resolves.toBeUndefined();
  });

  it("fails when any address is private (DNS pointing inside)", async () => {
    expect(await asyncCode(assertPublicHost(new URL("https://evil.example.com"), {}, { resolve: resolveTo("23.227.38.65", "10.0.0.5") }))).toBe("blocked_host");
    expect(await asyncCode(assertPublicHost(new URL("https://evil.example.com"), {}, { resolve: resolveTo("fe80::1") }))).toBe("blocked_host");
    expect(await asyncCode(assertPublicHost(new URL("https://evil.example.com"), {}, { resolve: resolveTo() }))).toBe("blocked_host");
  });

  it("allows loopback resolution only with allowLocal", async () => {
    const url = new URL("http://localhost:4310");
    expect(await asyncCode(assertPublicHost(url, {}, { resolve: resolveTo("127.0.0.1") }))).toBe("blocked_host");
    await expect(assertPublicHost(url, { allowLocal: true }, { resolve: resolveTo("127.0.0.1", "::1") })).resolves.toBeUndefined();
    expect(await asyncCode(assertPublicHost(url, { allowLocal: true }, { resolve: resolveTo("192.168.0.2") }))).toBe("blocked_host");
  });

  it("maps resolver failures to fetch_failed", async () => {
    const resolve = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await asyncCode(assertPublicHost(new URL("https://nope.example.com"), {}, { resolve }))).toBe("fetch_failed");
  });
});

describe("safeFetch", () => {
  type Route = (url: URL, init: RequestInit) => Response;
  const fakeFetch = (route: Route, seen: Array<{ url: string; init: RequestInit }> = []) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      seen.push({ url: url.toString(), init: init ?? {} });
      return route(url, init ?? {});
    }) as typeof fetch;
  const publicDns: FetchDeps["resolve"] = async (host) => (host.endsWith("inside.example") ? ["10.0.0.9"] : ["23.227.38.65"]);

  it("sends the bot UA, a narrow Accept and manual redirects", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const res = await safeFetch(
      "https://shop.example.com/products.json",
      { accept: "json" },
      { resolve: publicDns, fetch: fakeFetch(() => Response.json({ products: [] }), seen) },
    );
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.text)).toEqual({ products: [] });
    const headers = seen[0]?.init.headers as Record<string, string>;
    expect(headers["user-agent"]).toBe(USER_AGENT);
    expect(headers.accept).toBe("application/json");
    expect(seen[0]?.init.redirect).toBe("manual");
  });

  it("re-checks every redirect target", async () => {
    const fetchImpl = fakeFetch((url) =>
      url.hostname === "shop.example.com"
        ? new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } })
        : new Response("secret"),
    );
    expect(await asyncCode(safeFetch("https://shop.example.com/", { accept: "html" }, { resolve: publicDns, fetch: fetchImpl }))).toBe("blocked_host");

    const toPrivateName = fakeFetch((url) =>
      url.hostname === "shop.example.com" ? new Response(null, { status: 301, headers: { location: "https://db.inside.example/" } }) : new Response("secret"),
    );
    expect(await asyncCode(safeFetch("https://shop.example.com/", { accept: "html" }, { resolve: publicDns, fetch: toPrivateName }))).toBe("blocked_host");

    const toHttp = fakeFetch(() => new Response(null, { status: 301, headers: { location: "http://shop.example.com/" } }));
    expect(await asyncCode(safeFetch("https://shop.example.com/", { accept: "html" }, { resolve: publicDns, fetch: toHttp }))).toBe("invalid_url");
  });

  it("follows up to 3 redirects and refuses the 4th", async () => {
    const hops = (limit: number) =>
      fakeFetch((url) => {
        const n = Number(url.searchParams.get("n") ?? "0");
        return n < limit
          ? new Response(null, { status: 302, headers: { location: `/?n=${n + 1}` } })
          : new Response("<title>ok</title>", { headers: { "content-type": "text/html" } });
      });
    const ok = await safeFetch("https://shop.example.com/", { accept: "html" }, { resolve: publicDns, fetch: hops(3) });
    expect(ok.url).toBe("https://shop.example.com/?n=3");
    expect(await asyncCode(safeFetch("https://shop.example.com/", { accept: "html" }, { resolve: publicDns, fetch: hops(4) }))).toBe("too_many_redirects");
  });

  it("caps the body at 2 MB (declared and streamed)", async () => {
    const declared = fakeFetch(() => new Response("x", { headers: { "content-type": "text/html", "content-length": String(MAX_BODY_BYTES + 1) } }));
    expect(await asyncCode(safeFetch("https://shop.example.com/", { accept: "html" }, { resolve: publicDns, fetch: declared }))).toBe("too_large");

    const big = new Uint8Array(256 * 1024).fill(97);
    const streamed = fakeFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < 9; i++) controller.enqueue(big);
              controller.close();
            },
          }),
          { headers: { "content-type": "text/html" } },
        ),
    );
    expect(await asyncCode(safeFetch("https://shop.example.com/", { accept: "html" }, { resolve: publicDns, fetch: streamed }))).toBe("too_large");
  });

  it("refuses binary content and returns non-2xx without a body", async () => {
    const binary = fakeFetch(() => new Response("PK", { headers: { "content-type": "application/zip" } }));
    expect(await asyncCode(safeFetch("https://shop.example.com/x.zip", { accept: "html" }, { resolve: publicDns, fetch: binary }))).toBe("unsupported_content");

    const missing = await safeFetch(
      "https://shop.example.com/products.json",
      { accept: "json" },
      { resolve: publicDns, fetch: fakeFetch(() => new Response("nope", { status: 404 })) },
    );
    expect(missing).toMatchObject({ ok: false, status: 404, text: "" });
  });

  it("maps network errors and aborts", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await asyncCode(safeFetch("https://shop.example.com/", { accept: "html" }, { resolve: publicDns, fetch: failing }))).toBe("fetch_failed");
  });

  it("never fetches a blocked first URL", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = fakeFetch(() => new Response("x"), seen);
    expect(await asyncCode(safeFetch("https://db.inside.example/", { accept: "html" }, { resolve: publicDns, fetch: fetchImpl }))).toBe("blocked_host");
    expect(await asyncCode(safeFetch("https://localhost/", { accept: "html" }, { resolve: publicDns, fetch: fetchImpl }))).toBe("blocked_host");
    expect(seen).toHaveLength(0);
  });
});
