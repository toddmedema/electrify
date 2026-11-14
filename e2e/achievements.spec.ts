import path from "node:path";
import catalog from "../src/achievements/AchievementCatalog.json";
import { expect, Page, test, TestInfo } from "./fixtures";

const STORAGE_KEY = "electrify-achievements-v1";
async function screenshot(page: Page, info: TestInfo, name: string) {
  if (!process.env.REVIEW_SCREENSHOT_DIR) return;
  if (name.startsWith("gallery"))
    await page.locator(".screenHeaderTitle").click();
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(
      process.env.REVIEW_SCREENSHOT_DIR,
      `${info.project.name}-${name}.png`,
    ),
    animations: "disabled",
  });
}
async function openGallery(page: Page) {
  await page.getByRole("button", { name: "Achievements", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Achievements", exact: true }),
  ).toBeVisible();
}
async function assertLayout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const viewport = page.viewportSize()!;
  for (const control of await page
    .locator(".achievementCard button:visible")
    .all()) {
    const bounds = (await control.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(40);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  }
}

test("gallery lists all requirements, filters earned awards, restores keyboard focus and survives reload", async ({
  page,
}, info) => {
  await page.addInitScript((key) => {
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        guest: {
          version: 1,
          earned: ["FIRST_SPARK", "OUT_OF_JUICE"],
          tutorials: [0],
          wins: [],
        },
        accounts: {},
      }),
    );
  }, STORAGE_KEY);
  await page.goto("/");
  await openGallery(page);
  await expect(
    page.getByRole("button", { name: "Back", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByText(`2 of ${catalog.length} unlocked`, { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".achievementRow")).toHaveCount(catalog.length);
  await expect(
    page.getByRole("heading", { name: "Across the Valley", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Successfully finish Across the Valley on any difficulty.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(".achievementRow")
      .first()
      .getByRole("img", { name: "Unlocked", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".achievementRow").nth(1)).toContainText(
    "Out of Juice",
  );
  await expect(
    page
      .locator(".achievementRow")
      .nth(1)
      .getByRole("img", { name: "Unlocked", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".achievementRow")
      .nth(2)
      .getByRole("img", { name: "Locked", exact: true }),
  ).toBeVisible();
  for (const row of await page.locator(".achievementRow").all()) {
    const art = (await row.locator(".achievementArt").boundingBox())!;
    const badge = (await row.getByRole("img").boundingBox())!;
    expect(
      Math.abs(badge.x + badge.width - art.x - art.width),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(badge.y + badge.height - art.y - art.height),
    ).toBeLessThanOrEqual(1);
    await expect(row.getByRole("img")).toHaveText("");
  }
  await expect(
    page.getByText("Saved on this device.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Earn achievements in official scenarios/),
  ).toHaveCount(0);
  await expect(page.locator(".achievementToastPanel")).toBeHidden();
  await assertLayout(page);
  await screenshot(page, info, "gallery-light");
  const all = page.getByRole("tab", {
    name: `All (${catalog.length})`,
    exact: true,
  });
  await all.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Unlocked (2)", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".achievementRow")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "Out of Juice", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeFocused();
  await page.reload();
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await openGallery(page);
  await assertLayout(page);
  await screenshot(page, info, "gallery-dark");
  await expect(page.locator(".achievementToastPanel")).toBeHidden();
  await page
    .getByRole("tab", { name: `Locked (${catalog.length - 2})`, exact: true })
    .click();
  await expect(page.locator(".achievementRow")).toHaveCount(catalog.length - 2);
  await expect(page.locator(".achievementRow.isUnlocked")).toHaveCount(0);
});

test("a real mission stacks simultaneous awards and persists them without repeat popups", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.addInitScript((key) => {
    localStorage.setItem("audioEnabled", "false");
    // Completing Mission 1 now also completes the full tutorial collection.
    if (!localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          guest: {
            version: 1,
            earned: [],
            tutorials: [1, 2, 4, 3, 5, 112],
            wins: [],
          },
          accounts: {},
        }),
      );
  }, STORAGE_KEY);
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Inspect Coal", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "normal speed", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Mission complete!/ }),
  ).toBeVisible({ timeout: 60000 });
  const popups = page.locator(".achievementToastPanel");
  await expect(popups).toHaveCount(2);
  const popup = popups.filter({ hasText: "First Spark" });
  const graduate = popups.filter({ hasText: "Grid Graduate" });
  await expect(popup).toBeVisible();
  await expect(graduate).toBeVisible();
  const firstBounds = (await popup.boundingBox())!;
  const secondBounds = (await graduate.boundingBox())!;
  expect(firstBounds.y).toBeGreaterThanOrEqual(0);
  expect(firstBounds.y + firstBounds.height).toBeLessThanOrEqual(
    secondBounds.y,
  );
  expect(secondBounds.y + secondBounds.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  await expect(graduate).toContainText("Complete all seven tutorial missions.");
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await expect(popup).toContainText("First Spark");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    popup.getByRole("button", { name: "View achievements", exact: true }),
  ).toHaveCount(0);
  // Hit testing proves the popup is above the modal backdrop, not merely laid out underneath it.
  await expect
    .poll(() =>
      popup.evaluate((el) => {
        const bounds = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(bounds.right - 24, bounds.top + 24),
        );
      }),
    )
    .toBe(true);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Achievement unlocked: First Spark" }),
  ).toBeVisible();
  const bounds = (await popup.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  // The popup sits 16 px above the phone tab bar when that's on screen, else 16 px from the
  // bottom. The tutorial hides the tab bar here, so it must not float above an empty gap.
  const nav = page.locator("#navfooter:visible");
  const gap = async () => {
    const navTop = (await nav.count())
      ? (await nav.boundingBox())!.y
      : viewport.height;
    const popupBounds = (await graduate.boundingBox())!;
    return navTop - (popupBounds.y + popupBounds.height);
  };
  // The next mission changes the chrome after the dialog closes. Wait for its measured
  // clearance and the popup's entrance transition, rather than sampling an intermediate frame.
  await expect.poll(gap).toBeGreaterThanOrEqual(8);
  await expect.poll(gap).toBeLessThanOrEqual(24);
  await expect(popup).toHaveRole("button");
  await expect(popup.locator("button")).toHaveCount(0);
  await expect
    .poll(async () => (await popup.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(44);
  await screenshot(page, info, "stacked-popups");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await screenshot(page, info, "stacked-popups-dark");
  // A short viewport must keep every card reachable, including by vertical touch scrolling.
  const viewportBeforeResize = page.viewportSize()!;
  await page.setViewportSize({
    width: viewportBeforeResize.width,
    height: 180,
  });
  // The clock also owns the toast's periodic clearance/scrollability measurement.
  await page.clock.runFor(250);
  const stack = page.locator(".achievementToastStack");
  await expect(stack).toHaveClass(/isScrollable/);
  await expect(popup).toHaveCSS("touch-action", "pan-y");
  const stackBounds = (await stack.boundingBox())!;
  expect(stackBounds.y).toBeGreaterThanOrEqual(0);
  expect(stackBounds.y + stackBounds.height).toBeLessThanOrEqual(180);
  await graduate.getByText("Grid Graduate", { exact: true }).click();
  await expect(popups).toHaveCount(1);
  await expect(popup).toBeVisible();
  await page.setViewportSize(viewportBeforeResize);
  await page
    .getByRole("button", { name: "Next tutorial", exact: true })
    .click();
  await page.clock.runFor(1000);
  await expect(page.getByRole("dialog")).toBeHidden();
  await popup.getByText("First Spark", { exact: true }).click();
  await expect(popups).toHaveCount(0);
  await page.clock.resume();
  await expect(
    page.getByRole("heading", { name: "Achievements", exact: true }),
  ).toBeHidden();
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await page.reload();
  await openGallery(page);
  await expect(
    page.getByText(`2 of ${catalog.length} unlocked`, { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".achievementToastPanel")).toBeHidden();
});

test("empty earned view explains the next achievement and offline sign-in is disabled", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await openGallery(page);
  await page.getByRole("tab", { name: "Unlocked (0)", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "No achievements unlocked yet",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Complete Mission 1: Electricity to earn First Spark.", {
      exact: true,
    }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByRole("button", { name: "Sign in with Google", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Show all achievements", exact: true })
    .click();
  await expect(page.locator(".achievementRow")).toHaveCount(catalog.length);
  await assertLayout(page);
});
