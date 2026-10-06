/**
 * Dev-only fake Shopify store for walking the merchant generator end to end without the
 * internet. Not imported by the app. Run:
 *
 *   pnpm exec tsx src/lib/onboarding/fixture-server.ts [port]     # default 4317
 *
 * then open http://localhost:3000/admin/generate?allowLocal=1 and extract
 * http://127.0.0.1:4317/ (loopback is only accepted outside production; see
 * docs/MERCHANT-GENERATOR.md). Serves the unit-test fixture with image URLs rewritten to this
 * server, plus generated PNGs, with CORS so the city can use them as textures.
 */
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";
import { COLLECTIONS_JSON, INDEX_HTML, PRODUCTS_JSON } from "./shopify.fixture";

const port = Number(process.argv[2] ?? process.env.FIXTURE_PORT ?? 4317);
const origin = `http://127.0.0.1:${port}`;
const CDN = /(?:https:)?\/\/cdn\.shopify\.com\/s\/files\/1\/0001\//g;
const localise = (text: string) => text.replace(CDN, `${origin}/img/`);

// ------------------------------------------------------------------ tiny PNG encoder (no deps)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** A 256×256 product shot stand-in: a two-tone gradient with a lighter "item" disc. */
function png(seed: string): Buffer {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const rgb = (l: number): [number, number, number] => {
    const a = 0.45 * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + hue / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  };
  const size = 256;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - 128;
      const dy = y - 140;
      const inDisc = dx * dx + dy * dy < 70 * 70;
      const [r, g, b] = rgb(inDisc ? 0.72 : 0.22 + (y / size) * 0.18);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0B2545"/><path d="M14 46V18h6l16 18V18h6v28h-6L20 28v18z" fill="#FF6B35"/></svg>`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", origin);
  const send = (status: number, type: string, body: string | Buffer) => {
    res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "cache-control": "no-store" });
    res.end(body);
  };
  console.log(`[fixture] ${req.method} ${url.pathname}${url.search} (${req.headers["user-agent"] ?? "?"})`);
  if (url.pathname === "/products.json") return send(200, "application/json", localise(JSON.stringify(PRODUCTS_JSON)));
  if (url.pathname === "/collections.json") return send(200, "application/json", JSON.stringify(COLLECTIONS_JSON));
  if (url.pathname === "/") return send(200, "text/html; charset=utf-8", localise(INDEX_HTML));
  if (url.pathname === "/cdn/logo.svg") return send(200, "image/svg+xml", LOGO_SVG);
  if (url.pathname === "/apple-touch-icon.png" || url.pathname.startsWith("/img/")) return send(200, "image/png", png(url.pathname));
  if (url.pathname === "/favicon.ico") return send(200, "image/png", png("favicon"));
  return send(404, "text/plain", "not found");
});

server.listen(port, "127.0.0.1", () => console.log(`[fixture] fake Shopify store on ${origin}`));
