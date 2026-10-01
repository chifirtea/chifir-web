import { expect, test, type Page } from "@playwright/test";
import { dropWindow } from "../src/data/seed/time";

declare global {
  interface Window {
    __chifirDebug?: {
      inspectFirstProduct: (merchantId?: string) => boolean;
      inspectProductBySlug: (slug: string) => boolean;
      teleportToDeepLink: (value: string) => boolean;
      now: () => number;
    };
  }
}

/**
 * The live drop, rehearsed with the demo clock: arrive at Event Square just before 8 PM city
 * time, watch the countdown, enter the pop-up when it opens, buy a hoodie through the demo
 * checkout and wear its digital twin. Software rendering is slow, so the clock starts well
 * before the drop and every wait is generous.
 */

/** Real-time seconds between page load and the drop, leaving room for a slow software render. */
const LEAD_S = 75;

async function buyFromPopup(page: Page) {
  await page.waitForFunction(() => Boolean(window.__chifirDebug), null, { timeout: 10_000 });
  const opened = await page.evaluate(() => window.__chifirDebug?.inspectFirstProduct() ?? false);
  expect(opened, "opened a product panel in the pop-up").toBe(true);

  // Drop pieces need a size; the first option is enough.
  await page.getByRole("radio", { name: /^S(\s|$)/ }).first().click();
  const add = page.getByTestId("add-to-cart");
  await expect(add).toHaveText(/add to cart/i, { timeout: 20_000 });
  await add.click();
  await expect(page.getByRole("button", { name: /^added/i })).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press("Escape");
  await page.getByTestId("cart-button").click();
  const getIt = page.getByRole("button", { name: /get it irl/i });
  await expect(getIt).toBeEnabled({ timeout: 10_000 });
  await getIt.click();

  await page.getByLabel(/^email/i).fill("drop@example.com");
  const street = page.getByLabel(/^street/i);
  if (await street.isVisible().catch(() => false)) {
    await street.fill("1 Test St");
    await page.getByLabel(/^city/i).fill("Austin");
    await page.getByLabel(/state \/ region/i).fill("TX");
    await page.getByLabel(/postal code/i).fill("78701");
    const country = page.getByLabel(/^country/i);
    if ((await country.inputValue().catch(() => "")) === "") await country.fill("US");
  }
  await page.getByRole("button", { name: /^pay/i }).click();
  await expect(page).toHaveURL(/\/checkout\/demo/, { timeout: 30_000 });
  await page.getByRole("button", { name: /^pay/i }).click();
  await expect(page).toHaveURL(/\/orders\//, { timeout: 30_000 });
}

test("countdown → pop-up opens → buy a hoodie → wear the digital twin", async ({ page }) => {
  test.setTimeout(300_000);
  const { start } = dropWindow(new Date());
  const clock = new Date(start.getTime() - LEAD_S * 1000).toISOString();
  await page.goto(`/city?to=event:northline-night-shift&clock=${encodeURIComponent(clock)}&quality=low`);
  await expect(page.getByTestId("city-ready")).toBeVisible({ timeout: 90_000 });

  // The HUD knows about tonight: a countdown before the drop, a live pulse after.
  const hud = page.getByTestId("event-hud");
  await expect(hud).toBeVisible({ timeout: 20_000 });
  await expect(hud).toContainText(/night shift/i);
  const phase = await hud.getAttribute("data-phase");
  if (phase === "scheduled") {
    await expect(page.getByTestId("event-hud-countdown")).toBeVisible();
  }

  // At zero the lot becomes the pop-up. The player waited a few metres in front of the lot; step
  // to the door (what "Take me there" does once it is open) and the door prompt appears.
  await expect(hud).toHaveAttribute("data-phase", "live", { timeout: (LEAD_S + 60) * 1000 });
  await page.waitForFunction(() => Boolean(window.__chifirDebug), null, { timeout: 10_000 });
  await expect
    .poll(() => page.evaluate(() => window.__chifirDebug?.teleportToDeepLink("event:northline-night-shift") ?? false), { timeout: 20_000 })
    .toBe(true);
  const prompt = page.getByTestId("interaction-prompt");
  await expect(prompt).toContainText(/enter the northline supply pop-up/i, { timeout: 30_000 });
  await prompt.click();
  await expect(page.getByTestId("location-badge")).toContainText(/northline/i, { timeout: 20_000 });

  await buyFromPopup(page);

  // The order page unlocks the twin; wearing it is one tap.
  await expect(page.getByTestId("order-rewards")).toContainText(/digital twin unlocked/i, { timeout: 30_000 });
  const wear = page.getByTestId("reward-wear").first();
  await expect(wear).toHaveText(/wear it/i);
  await wear.click();
  await expect(wear).toHaveText(/wearing/i);
  const equipped = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("chifir.entitlements.v1") ?? "{}") as { state?: { equipped?: Record<string, string> } };
    } catch {
      return {};
    }
  });
  expect(equipped.state?.equipped?.outfit, "an outfit is equipped in local entitlements").toBeTruthy();
});

test("before the drop a collection piece cannot be added to the cart", async ({ page }) => {
  test.setTimeout(180_000);
  const { start } = dropWindow(new Date());
  const clock = new Date(start.getTime() - 3 * 3600_000).toISOString();
  await page.goto(`/city?to=northline-supply&clock=${encodeURIComponent(clock)}&quality=low`);
  await expect(page.getByTestId("city-ready")).toBeVisible({ timeout: 90_000 });
  await page.waitForFunction(() => Boolean(window.__chifirDebug), null, { timeout: 10_000 });
  const opened = await page.evaluate(
    () => window.__chifirDebug?.inspectProductBySlug("night-shift-hoodie-ink") ?? false,
  );
  expect(opened).toBe(true);
  await page.getByRole("radio", { name: /^S(\s|$)/ }).first().click();
  const add = page.getByTestId("add-to-cart");
  await expect(add).toHaveText(/drops/i);
  await expect(add).toBeDisabled();
});
