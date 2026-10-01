import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __chifirDebug?: { inspectFirstProduct: (merchantId?: string) => boolean };
  }
}

/**
 * End-to-end slice in static mode: landing → city → walk → enter a store → inspect a product →
 * add to cart → demo checkout → order page. Selectors rely on data-testid hooks in the HUD.
 */

test("landing page loads and links into the city", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /walk in/i }).first()).toBeVisible();
});

test("city loads to an interactive state", async ({ page }) => {
  await page.goto("/city");
  await expect(page.getByTestId("city-ready")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("location-badge")).toContainText(/central plaza/i);
});

test("deep link teleports to a merchant and the door prompt appears", async ({ page }) => {
  await page.goto("/city?to=ember-and-oak");
  await expect(page.getByTestId("city-ready")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("interaction-prompt")).toContainText(/enter ember & oak/i, { timeout: 20_000 });
});

test("enter a store, inspect a product, add to cart, complete demo checkout", async ({ page }) => {
  test.setTimeout(180_000);
  // Low quality keeps software-rendered CI browsers responsive; real devices auto-detect.
  await page.goto("/city?to=ember-and-oak&quality=low");
  await expect(page.getByTestId("city-ready")).toBeVisible({ timeout: 60_000 });
  const prompt = page.getByTestId("interaction-prompt");
  await expect(prompt).toContainText(/enter/i, { timeout: 20_000 });
  await prompt.click();
  await expect(page.getByTestId("location-badge")).toContainText(/ember & oak/i, { timeout: 20_000 });

  // Walking to a display is exercised by the visual check; here the dev-only debug bridge opens
  // the first purchasable product so the commerce path is deterministic under any frame rate.
  await page.waitForFunction(() => Boolean(window.__chifirDebug), null, { timeout: 10_000 });
  const opened = await page.evaluate(() => window.__chifirDebug?.inspectFirstProduct() ?? false);
  expect(opened, "opened a product panel").toBe(true);

  const add = page.getByRole("button", { name: /add to cart/i }).first();
  await expect(add).toBeVisible({ timeout: 20_000 });
  await add.click();
  await expect(page.getByRole("button", { name: /^added/i })).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press("Escape");
  await page.getByTestId("cart-button").click();
  const getIt = page.getByRole("button", { name: /get it irl/i });
  await expect(getIt).toBeEnabled({ timeout: 10_000 });
  await getIt.click();

  await page.getByLabel(/^email/i).fill("smoke@example.com");
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
  await expect(page.getByText(/paid|on its way|order placed/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/ember & oak/i).first()).toBeVisible();
});
