import { expect, test, type Page } from "@playwright/test";

/**
 * Party links over the same-origin transport: two pages in one browser context see each other
 * through `BroadcastChannel`. Page A walks away from the spawn and invites; page B opens the link,
 * lands in A's district, both count two people in the room, and B spawns within a few metres of A
 * (2 m behind, facing the same way). Software rendering is slow, so waits are generous.
 */

function parsePose(text: string | null): { x: number; z: number } | null {
  const [x, z] = (text ?? "").split(",").map(Number);
  return x !== undefined && z !== undefined && Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

async function readPose(page: Page): Promise<{ x: number; z: number } | null> {
  return parsePose(await page.getByTestId("rig-pose").textContent());
}

test("invite by link: the friend lands in the same district, next to the inviter", async ({ page, context }) => {
  test.setTimeout(240_000);

  await page.goto("/city?quality=low");
  await expect(page.getByTestId("city-ready")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("presence-count")).toHaveAttribute("data-count", "1", { timeout: 15_000 });

  // Walk away from the spawn so "near the inviter" is not just "at the spawn".
  await page.mouse.click(640, 400);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(2500);
  await page.keyboard.up("KeyW");
  await expect
    .poll(async () => {
      const pose = await readPose(page);
      return pose ? Math.hypot(pose.x, pose.z - 21) : 0;
    }, { timeout: 15_000, message: "A walked away from the spawn" })
    .toBeGreaterThan(6);

  const districtA = (await page.getByTestId("location-badge").innerText()).trim();

  await page.getByTestId("party-invite").click();
  const linkEl = page.getByTestId("party-invite-link");
  await expect(linkEl).toContainText(/\/city\?party=[A-Z0-9]{6,12}/, { timeout: 10_000 });
  const link = (await linkEl.textContent())!.trim();
  expect(link).toMatch(/party=[A-Z0-9]{6,12}&to=district%3A/);
  await expect(page.getByTestId("party-chip")).toBeVisible();

  const friend = await context.newPage();
  await friend.goto(link);
  await expect(friend.getByTestId("city-ready")).toBeVisible({ timeout: 90_000 });

  // Same district, two people in the room on both screens.
  await expect(friend.getByTestId("location-badge")).toContainText(districtA.split("\n").pop()!, { timeout: 20_000 });
  await expect(page.getByTestId("presence-count")).toHaveAttribute("data-count", "2", { timeout: 15_000 });
  await expect(friend.getByTestId("presence-count")).toHaveAttribute("data-count", "2", { timeout: 15_000 });
  await expect(friend.getByTestId("party-chip")).toContainText("2", { timeout: 15_000 });
  await expect(page.getByTestId("party-chip")).toContainText("2", { timeout: 15_000 });

  // The friend spawned next to the inviter.
  await expect
    .poll(
      async () => {
        const a = await readPose(page);
        const b = await readPose(friend);
        return a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity;
      },
      { timeout: 20_000, message: "B is within 6 m of A" },
    )
    .toBeLessThan(6);

  // Leaving drops the member count back on the inviter's side.
  await friend.getByTestId("party-chip").click();
  await friend.getByRole("button", { name: /leave/i }).click();
  await expect(page.getByTestId("party-chip")).toContainText("1", { timeout: 15_000 });
  await friend.close();
  await expect(page.getByTestId("presence-count")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
});
