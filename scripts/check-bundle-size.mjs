#!/usr/bin/env node
/**
 * Route-chunk size check for `/city`.
 *
 * Sums the gzipped size of every JS chunk the `/city` page loads:
 *   - the app-router root chunks (`build-manifest.json` → rootMainFiles),
 *   - the route's own chunks (`app-build-manifest.json` → pages["/city/page"] + pages["/layout"]),
 *   - the lazily loaded CityApp chunks (`react-loadable-manifest.json`, the `next/dynamic` import),
 * and fails when the total is over the budget (600 KB gzipped, see docs/ARCHITECTURE.md §12).
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

function readJson(file) {
  const p = path.join(DIST, file);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

const appManifest = readJson("app-build-manifest.json");
const buildManifest = readJson("build-manifest.json");
const loadableManifest = readJson("react-loadable-manifest.json");

if (!appManifest && !buildManifest) {
  console.error(`No build manifests found in ${DIST}. Run \`pnpm build\` first.`);
  process.exit(2);
}

/** @type {Map<string, "root" | "route" | "lazy">} */
const files = new Map();
const add = (list, group) => {
  for (const f of list ?? []) {
    if (typeof f === "string" && f.endsWith(".js") && !files.has(f)) files.set(f, group);
  }
};

add(buildManifest?.rootMainFiles, "root");
add(appManifest?.pages?.["/layout"], "route");
add(appManifest?.pages?.[ROUTE], "route");

if (loadableManifest) {
  for (const [key, entry] of Object.entries(loadableManifest)) {
    if (/CityApp/.test(key)) add(entry?.files, "lazy");
  }
}

if (files.size === 0) {
  console.error(`Route ${ROUTE} not found in the manifests. Known routes: ${Object.keys(appManifest?.pages ?? {}).join(", ")}`);
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
  rows.push({ file, group, raw: statSync(p).size, gzip: gzipSync(buf, { level: 9 }).length, missing: false });
}

rows.sort((a, b) => b.gzip - a.gzip);
const kb = (n) => (n / 1024).toFixed(1).padStart(7);
const totals = { root: 0, route: 0, lazy: 0 };
for (const r of rows) totals[r.group] += r.gzip;
const total = totals.root + totals.route + totals.lazy;

console.log(`\n/city JS chunks (gzip, level 9) — dist: ${path.relative(process.cwd(), DIST)}\n`);
console.log(`${"gzip KB".padStart(8)}  ${"raw KB".padStart(8)}  group  file`);
for (const r of rows) {
  console.log(`${kb(r.gzip)}  ${kb(r.raw)}  ${r.group.padEnd(5)}  ${r.file}${r.missing ? "  (missing on disk)" : ""}`);
}
console.log("");
console.log(`  root chunks   ${kb(totals.root)} KB`);
console.log(`  route chunks  ${kb(totals.route)} KB`);
console.log(`  lazy CityApp  ${kb(totals.lazy)} KB${loadableManifest ? "" : "  (no react-loadable-manifest.json; lazy chunks not counted)"}`);
console.log(`  total         ${kb(total)} KB   budget ${BUDGET_KB} KB`);
if (missing) console.log(`  ${missing} listed file(s) missing on disk`);

if (total / 1024 > BUDGET_KB) {
  console.error(`\n✗ /city first-load JS is ${(total / 1024).toFixed(1)} KB gzipped, over the ${BUDGET_KB} KB budget.`);
  process.exit(1);
}
console.log(`\n✓ /city first-load JS is within budget.\n`);
