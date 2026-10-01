/**
 * Builds the static city preview (no server) into preview/dist and rewrites index.html into the
 * fragment form an artifact page expects: <title> + <style>/<link> + markup, relative asset paths.
 *   node scripts/build-preview.mjs
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
execSync("npx tsx preview/build-snapshot.ts", { cwd: root, stdio: "inherit" });
execSync("npx vite build --config preview/vite.config.mts", { cwd: root, stdio: "inherit" });

const dist = `${root}preview/dist/`;
const html = readFileSync(`${dist}index.html`, "utf8");
const tags = [...html.matchAll(/<(?:link|script)[^>]*>(?:<\/script>)?/g)].map((m) => m[0]).filter((t) => !/rel="icon"/.test(t));
const page = [
  "<title>Chifir City</title>",
  `<style>
  /* Layout: the city fills the frame; the HUD floats over it. Tokens live in the bundled stylesheet. */
  :root { color-scheme: dark; --bg: #0f1116; --fg: #e9e6df; }
  html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); overflow: hidden; }
  #root { position: fixed; inset: 0; }
  #preview-note { position: fixed; left: 50%; bottom: max(8px, env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 15; font: 12px/1.3 "Instrument Sans", system-ui, sans-serif; color: rgba(233,230,223,0.55); pointer-events: none; white-space: nowrap; }
</style>`,
  ...tags.map((t) => t.replace(/(href|src)="\.\//g, '$1="')),
  '<div id="root"></div>',
  '<div id="preview-note">Static preview &middot; click the city, then WASD to walk, drag to look, E to interact</div>',
].join("\n");
writeFileSync(`${dist}page.html`, page);
const assets = readdirSync(`${dist}assets`);
console.log("page.html written; assets:", assets.join(", "));
