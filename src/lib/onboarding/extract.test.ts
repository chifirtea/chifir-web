import { describe, expect, it } from "vitest";
import {
  cleanText,
  extractMerchant,
  htmlToText,
  nameFromHost,
  normalizeHex,
  normalizeUrl,
  parseAttrs,
  parseHomepage,
  parsePriceToCents,
  parseShopifyCollections,
  parseShopifyProducts,
  slugify,
  storeNameFromTitle,
} from "./extract";
import { COLLECTIONS_JSON, FIXTURE_ORIGIN, INDEX_HTML, INJECTION_IN_BODY, INJECTION_IN_META, PRODUCTS_JSON } from "./shopify.fixture";
import { OnboardingError, type FetchDeps } from "./ssrf";
import { asExtraction, sourcePrices } from "./types";

describe("text helpers", () => {
  it("strips markup, scripts and entities to capped plain text", () => {
    expect(htmlToText("<p>Hi &amp; <b>bye</b></p><script>alert(1)</script><style>p{}</style>", 100)).toBe("Hi & bye");
    expect(htmlToText("<li>a</li><li>b</li>", 100)).toBe("a b");
    expect(cleanText("a\u0000b\u0007  c\n\nd", 100)).toBe("ab c d");
    expect(cleanText("x".repeat(50), 10)).toHaveLength(10);
    expect(cleanText("x".repeat(50), 10).endsWith("…")).toBe(true);
    expect(cleanText(42, 10)).toBe("");
    expect(cleanText("&#x1F600; &#65; &bogus;", 20)).toBe("😀 A &bogus;");
  });

  it("slugifies", () => {
    expect(slugify("Café Crème — Bar!")).toBe("cafe-creme-bar");
    expect(slugify("---")).toBe("");
    expect(slugify("a".repeat(80), 10)).toBe("aaaaaaaaaa");
  });

  it("parses prices exactly or not at all", () => {
    expect(parsePriceToCents("68.00")).toBe(6800);
    expect(parsePriceToCents("1,249.00")).toBe(124900);
    expect(parsePriceToCents("12.5")).toBe(1250);
    expect(parsePriceToCents("7")).toBe(700);
    expect(parsePriceToCents(19.99)).toBe(1999);
    expect(parsePriceToCents("n/a")).toBeNull();
    expect(parsePriceToCents("-5.00")).toBeNull();
    expect(parsePriceToCents("1.999")).toBeNull();
    expect(parsePriceToCents(null)).toBeNull();
    expect(parsePriceToCents(Number.NaN)).toBeNull();
  });

  it("normalises URLs and colours", () => {
    expect(normalizeUrl("//cdn.shopify.com/a.jpg", FIXTURE_ORIGIN)).toBe("https://cdn.shopify.com/a.jpg");
    expect(normalizeUrl("/logo.svg#x", FIXTURE_ORIGIN)).toBe(`${FIXTURE_ORIGIN}/logo.svg`);
    expect(normalizeUrl("javascript:alert(1)", FIXTURE_ORIGIN)).toBeNull();
    expect(normalizeUrl("data:image/png;base64,AAAA", FIXTURE_ORIGIN)).toBeNull();
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#0B2545ff")).toBe("#0b2545");
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
  });

  it("reads tag attributes in any quoting", () => {
    expect(parseAttrs(`<meta content='a "b"' property=og:title data-x>`)).toEqual({ content: 'a "b"', property: "og:title", "data-x": "" });
    expect(parseAttrs(`<link rel="icon" href="/f.png?x=1&amp;y=2" />`)).toEqual({ rel: "icon", href: "/f.png?x=1&y=2" });
  });

  it("derives names", () => {
    expect(storeNameFromTitle("Northwind Goods – Coastal Streetwear | Shop")).toBe("Northwind Goods");
    expect(storeNameFromTitle("Plain")).toBe("Plain");
    expect(nameFromHost("www.kori-ramen.com")).toBe("Kori Ramen");
  });
});

describe("parseShopifyProducts", () => {
  const { products, warnings } = parseShopifyProducts(PRODUCTS_JSON, FIXTURE_ORIGIN);

  it("keeps priced products in order and skips the unpriced one", () => {
    expect(products.map((p) => p.handle)).toEqual(["harbor-hoodie", "dockside-cap", "lighthouse-jacket"]);
    expect(warnings.some((w) => w.includes("Gift Card"))).toBe(true);
  });

  it("copies prices exactly and uses the lowest variant as base", () => {
    const hoodie = products[0]!;
    expect(hoodie.priceCents).toBe(6800);
    expect(hoodie.variants.map((v) => v.priceCents)).toEqual([6800, 6800, 7200, 7200]);
    expect(hoodie.variants[0]?.compareAtPriceCents).toBe(8500);
    expect(hoodie.variants[1]?.compareAtPriceCents).toBeUndefined();
    expect(hoodie.variants[2]?.available).toBe(false);
    const jacket = products[2]!;
    expect(jacket.priceCents).toBe(124900);
    expect(jacket.variants).toHaveLength(3);
    expect(warnings.some((w) => w.includes("Lighthouse Jacket") && w.includes("Broken"))).toBe(true);
  });

  it("sanitises descriptions, tags, images and options", () => {
    const [hoodie, cap, jacket] = products;
    expect(hoodie?.description).toBe("Heavyweight fleece hoodie & relaxed fit. 400 gsm Garment dyed");
    expect(hoodie?.description).not.toContain("alert");
    expect(hoodie?.tags).toEqual(["streetwear", "fleece", "new arrival"]);
    expect(cap?.tags).toEqual(["caps", "accessories"]);
    expect(hoodie?.images[0]).toBe("https://cdn.shopify.com/s/files/1/0001/harbor-hoodie-front.jpg");
    expect(hoodie?.options).toEqual([{ name: "Size", values: ["S", "M", "L", "XL"] }]);
    expect(cap?.options).toEqual([]); // "Title / Default Title" is Shopify's placeholder
    expect(jacket?.variants[0]?.options).toEqual(["Navy", "M"]);
    expect(hoodie?.url).toBe(`${FIXTURE_ORIGIN}/products/harbor-hoodie`);
    expect(hoodie?.productType).toBe("Hoodies");
    expect(hoodie?.vendor).toBe("Northwind Goods");
  });

  it("caps the catalog and tolerates junk", () => {
    const many = { products: Array.from({ length: 60 }, (_, i) => ({ title: `P${i}`, handle: `p-${i}`, variants: [{ price: "1.00" }] })) };
    const parsed = parseShopifyProducts(many, FIXTURE_ORIGIN);
    expect(parsed.products).toHaveLength(50);
    expect(parsed.warnings[0]).toMatch(/first 50 of 60/);
    expect(parseShopifyProducts({ products: [null, 3, { title: "" }, { title: "No variants" }] }, FIXTURE_ORIGIN).products).toEqual([]);
    expect(parseShopifyProducts("nope", FIXTURE_ORIGIN).products).toEqual([]);
  });

  it("caps long text", () => {
    const parsed = parseShopifyProducts(
      { products: [{ title: "T".repeat(500), body_html: `<p>${"d".repeat(5000)}</p>`, variants: [{ price: "1.00" }] }] },
      FIXTURE_ORIGIN,
    );
    expect(parsed.products[0]?.title.length).toBeLessThanOrEqual(120);
    expect(parsed.products[0]?.description.length).toBeLessThanOrEqual(600);
  });
});

describe("parseShopifyCollections", () => {
  it("maps collections", () => {
    expect(parseShopifyCollections(COLLECTIONS_JSON)).toEqual([
      { handle: "frontpage", title: "Front page", productsCount: 3 },
      { handle: "outerwear", title: "Outerwear", productsCount: 1 },
    ]);
    expect(parseShopifyCollections(null)).toEqual([]);
  });
});

describe("parseHomepage", () => {
  const meta = parseHomepage(INDEX_HTML, `${FIXTURE_ORIGIN}/`);

  it("reads title, description, og tags and theme colour", () => {
    expect(meta.title).toBe("Northwind Goods – Coastal Streetwear | Shop");
    expect(meta.description).toBe(`Heavyweight hoodies, caps & waxed jackets made for the harbour. ${INJECTION_IN_META}`);
    expect(meta.siteName).toBe("Northwind Goods");
    expect(meta.ogImage).toBe("https://cdn.shopify.com/s/files/1/0001/og-hero.jpg");
    expect(meta.themeColor).toBe("#0b2545");
  });

  it("ranks logo candidates: touch icon, logo images, icons, og:image", () => {
    expect(meta.logoCandidates).toEqual([
      `${FIXTURE_ORIGIN}/apple-touch-icon.png`,
      `${FIXTURE_ORIGIN}/cdn/logo.svg`,
      `${FIXTURE_ORIGIN}/favicon.ico`,
      "https://cdn.shopify.com/s/files/1/0001/favicon-32.png",
      "https://cdn.shopify.com/s/files/1/0001/og-hero.jpg",
    ]);
  });

  it("collects colours from theme-color and CSS custom properties", () => {
    expect(meta.colorCandidates[0]).toBe("#0b2545");
    expect(meta.colorCandidates).toEqual(expect.arrayContaining(["#13315c", "#eef4ed", "#ff6b35", "#ffffff"]));
    expect(new Set(meta.colorCandidates).size).toBe(meta.colorCandidates.length);
  });

  it("keeps page text as inert plain text and never reads the page body", () => {
    // The meta description is read (it is the store's description), verbatim and as text only.
    expect(meta.description).toContain(INJECTION_IN_META);
    expect(JSON.stringify(meta)).not.toContain(INJECTION_IN_BODY);
  });

  it("copes with an empty page", () => {
    expect(parseHomepage("", FIXTURE_ORIGIN)).toEqual({ logoCandidates: [], colorCandidates: [] });
  });
});

describe("extractMerchant", () => {
  const resolve: FetchDeps["resolve"] = async () => ["23.227.38.65"];
  const store = (routes: Record<string, () => Response>): FetchDeps["fetch"] =>
    (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const route = routes[url.pathname];
      return route ? route() : new Response("not found", { status: 404 });
    }) as typeof fetch;
  const shopify = store({
    "/products.json": () => Response.json(PRODUCTS_JSON),
    "/collections.json": () => Response.json(COLLECTIONS_JSON),
    "/": () => new Response(INDEX_HTML, { headers: { "content-type": "text/html; charset=utf-8" } }),
  });
  const now = () => new Date("2026-10-06T12:00:00Z");

  it("extracts a Shopify store end to end", async () => {
    const x = await extractMerchant(`${FIXTURE_ORIGIN}/`, { deps: { resolve, fetch: shopify }, now });
    expect(x.platform).toBe("shopify");
    expect(x.name).toBe("Northwind Goods");
    expect(x.origin).toBe(FIXTURE_ORIGIN);
    expect(x.products).toHaveLength(3);
    expect(x.categories).toHaveLength(2);
    expect(x.fetchedAt).toBe("2026-10-06T12:00:00.000Z");
    expect(x.meta).toEqual({});
    expect(sourcePrices(x)).toEqual(new Set([6800, 7200, 3200, 124900, 129900]));
    // Survives a JSON round trip through the draft store.
    expect(asExtraction(JSON.parse(JSON.stringify(x)))).toEqual(x);
  });

  it("falls back to a generic extraction when there is no catalog", async () => {
    const generic = store({ "/": () => new Response("<title>Kiln Studio | Ceramics</title>", { headers: { "content-type": "text/html" } }) });
    const x = await extractMerchant("https://kiln.example.com/", { deps: { resolve, fetch: generic }, now });
    expect(x.platform).toBe("generic");
    expect(x.name).toBe("Kiln Studio");
    expect(x.products).toEqual([]);
    expect(x.warnings.join(" ")).toMatch(/No Shopify catalog/);
  });

  it("fails readably when nothing can be read", async () => {
    const dead = store({});
    await expect(extractMerchant("https://gone.example.com/", { deps: { resolve, fetch: dead }, now })).rejects.toMatchObject({ code: "fetch_failed" });
  });

  it("refuses blocked URLs before fetching", async () => {
    let calls = 0;
    const counting = (async () => {
      calls++;
      return new Response("");
    }) as typeof fetch;
    const err = await extractMerchant("https://192.168.0.10/", { deps: { resolve, fetch: counting } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OnboardingError);
    expect((err as OnboardingError).code).toBe("blocked_host");
    expect(calls).toBe(0);
  });

  it("asExtraction is defensive about stored JSON", () => {
    const x = asExtraction({ products: [{ title: 5, variants: [{ priceCents: "9" }] }], meta: { proposalSource: "magic" } });
    expect(x.products[0]?.title).toBe("");
    expect(x.products[0]?.variants[0]?.priceCents).toBe(0);
    expect(x.meta.proposalSource).toBeUndefined();
    expect(asExtraction(null).products).toEqual([]);
  });
});
