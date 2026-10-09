import { expect, test } from "./fixtures";

for (const theme of ["light", "dark"]) {
  test(`launch artwork keeps play and briefing choices visible in ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Start playing", exact: true }),
    ).toBeInViewport();
    const scene = page.locator(".titleArtwork img");
    await expect(scene).toBeVisible();
    expect(
      await scene.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    await expect(page.locator(".titleArtwork")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    await page.goto("/?scenario=107");
    await expect(
      page.getByRole("heading", { name: "Deep Freeze" }),
    ).toBeVisible();
    const start = page.getByRole("button", { name: "Start game", exact: true });
    // A 568px phone scrolls the authored goal/threat and difficulty choices; preserve readable
    // copy and verify the primary action is reachable rather than shrinking the briefing.
    if ((page.viewportSize()?.height || 0) < 800) {
      await start.scrollIntoViewIfNeeded();
    }
    await expect(start).toBeInViewport();
    await expect(page.getByAltText("Deep Freeze icon")).toBeVisible();
    const overflow = await page
      .locator("#listCard")
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("short windows reserve space for the home actions", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto("/");
  await expect(page.locator(".titleArtwork")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Start playing", exact: true }),
  ).toBeInViewport();
});
