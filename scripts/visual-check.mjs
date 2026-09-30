import { chromium, devices } from "@playwright/test";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/claude-0/-home-user-chifir-web/68e939da-bf13-5955-be07-b7b84d7d7849/scratchpad/shots";
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const args = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args });

async function run(name, ctxOpts, fn) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  const failed = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e).slice(0, 300)}`));
  page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 120)}`));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("loremflickr")) failed.push(`${r.status()} ${r.url().slice(0, 120)}`); });
  try {
    await fn(page);
  } catch (e) {
    console.log(`!! ${name} failed: ${String(e).split("\n")[0]}`);
    await page.screenshot({ path: `${SHOTS}/${name}-FAILED.png` }).catch(() => {});
  }
  console.log(`== ${name}: ${errors.length} console issues, ${failed.length} failed requests`);
  for (const e of errors.slice(0, 12)) console.log("   " + e);
  for (const f of failed.slice(0, 12)) console.log("   " + f);
  await ctx.close();
}

const waitReady = async (page, timeout = 60000) => {
  // Loading screen fades out when the world store reports ready; wait until the HUD interaction layer exists
  await page.waitForFunction(() => !document.querySelector('[data-loading-screen]') || document.querySelector('[data-loading-screen]')?.getAttribute('data-hidden') === 'true', null, { timeout }).catch(() => {});
  await page.waitForTimeout(2500);
};

await run("landing-desktop", { viewport: { width: 1280, height: 800 } }, async (page) => {
  const t0 = Date.now();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  console.log("   landing networkidle in", Date.now() - t0, "ms");
  await page.screenshot({ path: `${SHOTS}/landing-desktop.png`, fullPage: true });
});

await run("landing-mobile", { ...devices["Pixel 7"] }, async (page) => {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SHOTS}/landing-mobile.png`, fullPage: true });
});

await run("city-desktop", { viewport: { width: 1280, height: 800 } }, async (page) => {
  const t0 = Date.now();
  let jsBytes = 0;
  page.on("response", async (r) => { try { if (r.url().includes("/_next/static/") && r.url().endsWith(".js")) { const h = r.headers()["content-length"]; jsBytes += Number(h ?? 0); } } catch {} });
  await page.goto(BASE + "/city", { waitUntil: "domcontentloaded" });
  await waitReady(page);
  console.log("   city settled in", Date.now() - t0, "ms; JS transferred (content-length sum):", Math.round(jsBytes / 1024), "KB");
  await page.screenshot({ path: `${SHOTS}/city-spawn.png` });
  // walk forward for 2.5s, then look around
  await page.keyboard.down("KeyW"); await page.waitForTimeout(2500); await page.keyboard.up("KeyW");
  await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(900, 380, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/city-walked.png` });
  const hudText = await page.evaluate(() => document.body.innerText.slice(0, 600));
  console.log("   HUD text:", hudText.replace(/\n+/g, " | ").slice(0, 300));
});

await run("city-deeplink-ember", { viewport: { width: 1280, height: 800 } }, async (page) => {
  await page.goto(BASE + "/city?to=ember-and-oak", { waitUntil: "domcontentloaded" });
  await waitReady(page);
  await page.screenshot({ path: `${SHOTS}/city-ember-door.png` });
  const txt = await page.evaluate(() => document.body.innerText);
  console.log("   prompt visible:", /Enter Ember/i.test(txt), "| badge:", (txt.match(/DISTRICT[\s\S]{0,40}/) || [""])[0].replace(/\n/g, " "));
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/interior-ember.png` });
  const txt2 = await page.evaluate(() => document.body.innerText);
  console.log("   after E:", txt2.replace(/\n+/g, " | ").slice(0, 300));
  // walk a bit inside
  await page.keyboard.down("KeyW"); await page.waitForTimeout(1200); await page.keyboard.up("KeyW");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/interior-ember-walk.png` });
  const txt3 = await page.evaluate(() => document.body.innerText);
  console.log("   inside prompt:", (txt3.match(/(Look at|Talk to|Back to)[^\n]*/) || ["none"])[0]);
});

await run("city-mobile", { ...devices["Pixel 7"] }, async (page) => {
  await page.goto(BASE + "/city?to=kori-ramen", { waitUntil: "domcontentloaded" });
  await waitReady(page);
  await page.screenshot({ path: `${SHOTS}/city-mobile.png` });
});

await browser.close();
