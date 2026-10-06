import { chromium, devices } from "@playwright/test";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/claude-0/-home-user-chifir-web/68e939da-bf13-5955-be07-b7b84d7d7849/scratchpad/shots";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
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
  // The HUD reports data-ready="true" once the canvas has presented its first frames.
  const t0 = Date.now();
  await page.waitForSelector('[data-testid="hud"][data-ready="true"]', { timeout }).catch(() => {});
  console.log("   time to ready:", Date.now() - t0, "ms");
  await page.waitForTimeout(1500);
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


await run("panels-desktop", { viewport: { width: 1280, height: 800 } }, async (page) => {
  await page.goto(BASE + "/city?to=ember-and-oak&quality=low", { waitUntil: "domcontentloaded" });
  await waitReady(page);
  // Concierge without an API key must degrade gracefully.
  await page.getByTestId("concierge-button").click();
  await page.getByRole("textbox").first().fill("Something spicy under $25");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/panel-concierge.png` });
  const t = await page.evaluate(() => document.body.innerText);
  console.log("   concierge copy:", (t.match(/off duty[^\n]*/i) || t.match(/not (set up|available)[^\n]*/i) || ["(no unavailable message found)"])[0]);
  await page.keyboard.press("Escape");
  await page.getByTestId("places-button").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/panel-places.png` });
  await page.keyboard.press("Escape");
  // Enter and talk to the employee via the door prompt + debug bridge.
  await page.getByTestId("interaction-prompt").click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/interior-ember-sconces.png` });
  await page.evaluate(() => window.__chifirDebug?.talkToEmployee(window.__chifirDebug.world().location.merchantId));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/panel-employee.png` });
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__chifirDebug?.inspectFirstProduct());
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/panel-product.png` });
  await page.keyboard.press("Escape");
  await page.getByTestId("cart-button").click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/panel-cart-empty.png` });
});

await browser.close();
