#!/usr/bin/env node
/**
 * First-load JS size check for `/city`.
 *
 * Sums the gzipped size of every JS chunk a cold `/city` visit downloads before the first frame:
 *   - root  : the app-router runtime (`build-manifest.json` → rootMainFiles),
 *   - route : the layout + page entry chunks (Turbopack: `entryJSFiles` in the route's
 *             `page_client-reference-manifest.js`; webpack: `app-build-manifest.json`),
 *   - lazy  : the chunks the page entry loads on mount through `next/dynamic` (the 3D chunk:
 *             three.js, R3F, drei, the engine). Turbopack has no react-loadable manifest, so these
 *             are the `static/chunks/*.js` references inside the route entry chunks; webpack builds
 *             use `react-loadable-manifest.json`.
 * Panels and drawers that load on first open are not first-load and are not counted.
 * Fails when the total is over the budget (600 KB gzipped, see docs/PERFORMANCE.md).
 *
 * Usage: node scripts/check-bundle-size.mjs   (after `next build`)
 * Env:   BUNDLE_BUDGET_KB (default 600), NEXT_DIST_DIR (default .next)
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const DIST = path.resolve(process.env.NEXT_DIST_DIR ?? ".next");
const BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB ?? 600);
const ROUTE = "/city/page";
const ROUTE_ENTRY_KEYS = ["[project]/src/app/layout", "[project]/src/app/city/page"];

function readJson(file) {
  const p = path.join(DIST, file);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Turbopack writes the route's client manifest as a script that assigns `globalThis.__RSC_MANIFEST`. */
function readClientReferenceManifest() {
  const p = path.join(DIST, "server", "app", "city", "page_client-reference-manifest.js");
  if (!existsSync(p)) return null;
  const src = readFileSync(p, "utf8");
  const sandbox = { __RSC_MANIFEST: {} };
  try {
    // The file is build output from this repo's own `next build`, not untrusted input.
    new Function("globalThis", src)(sandbox);
  } catch {
    return null;
  }
  return sandbox.__RSC_MANIFEST[ROUTE] ?? null;
}

const buildManifest = readJson("build-manifest.json");
const appManifest = readJson("app-build-manifest.json");
const loadableManifest = readJson("react-loadable-manifest.json");
const clientManifest = readClientReferenceManifest();

if (!buildManifest && !appManifest && !clientManifest) {
  console.error(`No build manifests found in ${DIST}. Run \`pnpm build\` first.`);
  process.exit(2);
}

const normalize = (f) => f.replace(/^\/_next\//, "");

/** @type {Map<string, "root" | "route" | "lazy">} */
const files = new Map();
const add = (list, group) => {
  for (const raw of list ?? []) {
    if (typeof raw !== "string") continue;
    const f = normalize(raw);
    if (f.endsWith(".js") && !files.has(f)) files.set(f, group);
  }
};

add(buildManifest?.rootMainFiles, "root");

if (clientManifest?.entryJSFiles) {
  for (const key of ROUTE_ENTRY_KEYS) add(clientManifest.entryJSFiles[key], "route");
} else {
  add(appManifest?.pages?.["/layout"], "route");
  add(appManifest?.pages?.[ROUTE], "route");
}

if (loadableManifest) {
  for (const [key, entry] of Object.entries(loadableManifest)) {
    if (/CityApp/.test(key)) add(entry?.files, "lazy");
  }
} else {
  // Turbopack: the entry chunk lists the chunks its dynamic import loads, by path.
  const routeChunks = [...files].filter(([, g]) => g === "route").map(([f]) => f);
  for (const f of routeChunks) {
    const p = path.join(DIST, f);
    if (!existsSync(p)) continue;
    const refs = readFileSync(p, "utf8").match(/static\/chunks\/[A-Za-z0-9_-]+\.js/g) ?? [];
    add([...new Set(refs)], "lazy");
  }
}

if (files.size === 0) {
  console.error(
    `Route ${ROUTE} not found in the manifests. Known routes: ${Object.keys(appManifest?.pages ?? clientManifest?.entryJSFiles ?? {}).join(", ")}`,
  );
  process.exit(2);
}

const rows = [];
let missing = 0;
for (const [file, group] of files) {
  const p = path.join(DIST, file);
  if (!existsSync(p)) {
    missing += 1;
    rows.push({ file, group, raw: 0, gzip: 0, missing: true });
    continue;
  }
  const buf = readFileSync(p);
  rows.push({
    file,
    group,
    raw: statSync(p).size,
    gzip: gzipSync(buf, { level: 9 }).length,
    missing: false,
  });
}

rows.sort((a, b) => b.gzip - a.gzip);
const kb = (n) => (n / 1024).toFixed(1).padStart(7);
const totals = { root: 0, route: 0, lazy: 0 };
for (const r of rows) totals[r.group] += r.gzip;
const total = totals.root + totals.route + totals.lazy;

console.log(
  `\n/city first-load JS (gzip, level 9) — dist: ${path.relative(process.cwd(), DIST)}\n`,
);
console.log(`${"gzip KB".padStart(8)}  ${"raw KB".padStart(8)}  group  file`);
for (const r of rows) {
  console.log(
    `${kb(r.gzip)}  ${kb(r.raw)}  ${r.group.padEnd(5)}  ${r.file}${r.missing ? "  (missing on disk)" : ""}`,
  );
}
console.log("");
console.log(`  root chunks   ${kb(totals.root)} KB`);
console.log(`  route chunks  ${kb(totals.route)} KB`);
console.log(`  lazy 3D chunk ${kb(totals.lazy)} KB`);
console.log(`  total         ${kb(total)} KB   budget ${BUDGET_KB} KB`);
if (missing) console.log(`  ${missing} listed file(s) missing on disk`);

if (total / 1024 > BUDGET_KB) {
  console.error(
    `\n✗ /city first-load JS is ${(total / 1024).toFixed(1)} KB gzipped, over the ${BUDGET_KB} KB budget.`,
  );
  process.exit(1);
}
console.log(`\n✓ /city first-load JS is within budget.\n`);
