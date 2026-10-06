import { expect, test, type Page } from "@playwright/test";

/**
 * Party links over the same-origin transport: two pages in one browser context see each other
 * through `BroadcastChannel`. Page A moves to the Night Shift pop-up lot on Event Square (far from
 * the district spawn, so "near the inviter" cannot be "at the spawn") and invites; page B opens the
 * link, lands in A's district, both count two people in the room, and B spawns within a few metres
 * of A (2 m behind, facing the same way). Walking is frame-rate bound under software rendering, so
 * A is placed through the dev-only action bus; waits are generous for the same reason.
 */

/** The dev-only action bus (src/app/city/DebugBridge.tsx), typed locally to the one call used. */
type DebugWindow = { __chifirDebug?: { teleportToDeepLink: (value: string) => boolean } };

/** Event Square's district spawn (src/data/seed/districts.ts). */
const EVENT_SQUARE_SPAWN = { x: 0, z: -48 };

function parsePose(text: string | null): { x: number; z: number } | null {
  const [x, z] = (text ?? "").split(",").map(Number);
  return x !== undefined && z !== undefined && Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

async function readPose(page: Page): Promise<{ x: number; z: number } | null> {
  return parsePose(await page.getByTestId("rig-pose").textContent());
}

const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

test("invite by link: the friend lands in the same district, next to the inviter", async ({ page, context }, testInfo) => {
  test.setTimeout(240_000);

  await page.goto("/city?quality=low");
  await expect(page.getByTestId("city-ready")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("presence-count")).toHaveAttribute("data-count", "1", { timeout: 15_000 });

  // A goes to the pop-up lot on Event Square.
  await page.waitForFunction(() => Boolean((window as DebugWindow).__chifirDebug), null, { timeout: 10_000 });
  await expect
    .poll(() => page.evaluate(
          () => (window as DebugWindow).__chifirDebug?.teleportToDeepLink("event:northline-night-shift") ?? false,
        ), {
      timeout: 20_000,
    })
    .toBe(true);
  await expect(page.getByTestId("location-badge")).toContainText("Event Square", { timeout: 20_000 });
  await expect
    .poll(async () => {
      const pose = await readPose(page);
      return pose ? distance(pose, EVENT_SQUARE_SPAWN) : 0;
    }, { timeout: 15_000, message: "A stands well away from the district spawn" })
    .toBeGreaterThan(20);

  await page.getByTestId("party-invite").click();
  const linkEl = page.getByTestId("party-invite-link");
  await expect(linkEl).toContainText(/\/city\?party=[A-Z0-9]{6,12}/, { timeout: 10_000 });
  const link = (await linkEl.textContent())!.trim();
  expect(link).toMatch(/party=[A-Z0-9]{6,12}&to=district%3Aevent-square/);
  await expect(page.getByTestId("party-chip")).toBeVisible();

  const friend = await context.newPage();
  await friend.goto(link);
  await expect(friend.getByTestId("city-ready")).toBeVisible({ timeout: 90_000 });

  // Same district, two people in the room on both screens, two in the party.
  await expect(friend.getByTestId("location-badge")).toContainText("Event Square", { timeout: 20_000 });
  await expect(page.getByTestId("presence-count")).toHaveAttribute("data-count", "2", { timeout: 15_000 });
  await expect(friend.getByTestId("presence-count")).toHaveAttribute("data-count", "2", { timeout: 15_000 });
  await expect(friend.getByTestId("party-chip")).toContainText("2", { timeout: 15_000 });
  await expect(page.getByTestId("party-chip")).toContainText("2", { timeout: 15_000 });

  // The friend spawned next to the inviter (not at the deep link's district spawn).
  await expect
    .poll(
      async () => {
        const a = await readPose(page);
        const b = await readPose(friend);
        return a && b ? distance(a, b) : Infinity;
      },
      { timeout: 20_000, message: "B is within 6 m of A" },
    )
    .toBeLessThan(6);
  const b = await readPose(friend);
  expect(b && distance(b, EVENT_SQUARE_SPAWN)).toBeGreaterThan(15);

  // Evidence: B stands 2 m behind A facing the same way, so A is in B's view with a name tag.
  await friend.waitForTimeout(1500);
  const shot = testInfo.outputPath("two-avatars.png");
  await friend.screenshot({ path: shot });
  await testInfo.attach("two-avatars", { path: shot, contentType: "image/png" });

  // Leaving the party drops the member count on the inviter's side; closing the tab drops the room.
  await friend.getByTestId("party-chip").click();
  await friend.getByTestId("party-members").getByRole("button", { name: /leave/i }).click();
  await expect(page.getByTestId("party-chip")).toContainText("1", { timeout: 15_000 });
  await friend.close();
  await expect(page.getByTestId("presence-count")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
});
