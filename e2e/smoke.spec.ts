import { expect, test } from "@playwright/test";

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
  await page.goto("/city?to=ember-and-oak");
  await expect(page.getByTestId("city-ready")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("interaction-prompt")).toContainText(/enter/i, { timeout: 20_000 });
  await page.getByTestId("interaction-prompt").click();
  await expect(page.getByTestId("location-badge")).toContainText(/ember & oak/i, { timeout: 20_000 });

  // Products are reachable from the places/menu list without walking to a slot.
  await page.getByTestId("interaction-prompt").waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
  const prompt = page.getByTestId("interaction-prompt");
  const text = (await prompt.textContent().catch(() => "")) ?? "";
  if (/look at/i.test(text)) {
    await prompt.click();
  } else {
    // Fall back to the employee panel product list.
    await page.getByTestId("places-button").click();
  }
  await expect(page.getByRole("button", { name: /add to cart/i }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /add to cart/i }).first().click();
  await page.getByTestId("cart-button").click();
  await expect(page.getByRole("button", { name: /get it irl/i })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: /get it irl/i }).click();
  await page.getByLabel(/email/i).fill("smoke@example.com");
  const address = page.getByLabel(/address line 1|street/i);
  if (await address.isVisible().catch(() => false)) {
    await address.fill("1 Test St");
    await page.getByLabel(/city/i).first().fill("Austin");
    await page.getByLabel(/state|region/i).fill("TX");
    await page.getByLabel(/postal|zip/i).fill("78701");
  }
  await page.getByRole("button", { name: /pay/i }).click();
  await expect(page).toHaveURL(/\/checkout\/demo/, { timeout: 20_000 });
  await page.getByRole("button", { name: /pay/i }).click();
  await expect(page).toHaveURL(/\/orders\//, { timeout: 20_000 });
  await expect(page.getByText(/paid|on its way|accepted/i).first()).toBeVisible({ timeout: 20_000 });
});
