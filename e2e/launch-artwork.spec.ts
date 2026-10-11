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
    await expect
      .poll(() =>
        scene.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(page.locator(".titleArtwork")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    for (const [id, name, sceneName] of [
      [107, "Deep Freeze", "power-system-freeze"],
      [106, "Data Center Boom", "power-system-growth"],
      [101, "Rise of Renewables", "power-system-transition"],
      [111, "Wildfire Emergency", "power-system"],
    ] as const) {
      await page.goto(`/?scenario=${id}`);
      await expect(page.getByRole("heading", { name })).toBeVisible();
      const illustration = page.locator(".scenarioArtworkWorld");
      await expect(illustration).toHaveAttribute(
        "src",
        `/images/${sceneName}.svg`,
      );
      await expect
        .poll(() =>
          illustration.evaluate(
            (image) => (image as HTMLImageElement).naturalWidth,
          ),
        )
        .toBeGreaterThan(0);
      await expect(page.getByAltText(`${name} icon`)).toBeVisible();
      const start = page.getByRole("button", {
        name: "Start game",
        exact: true,
      });
      // A 568px phone scrolls the authored goal/threat and difficulty choices; preserve readable
      // copy and verify the primary action is reachable rather than shrinking the briefing.
      if ((page.viewportSize()?.height || 0) < 800) {
        await start.scrollIntoViewIfNeeded();
      }
      await expect(start).toBeInViewport();
      const overflow = await page
        .locator("#listCard")
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
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

for (const theme of ["light", "dark"]) {
  test(`home actions stay in place while artwork loads in ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    let releaseArtwork!: () => void;
    const artworkReady = new Promise<void>((resolve) => {
      releaseArtwork = resolve;
    });
    await page.route("**/images/power-system.svg", async (route) => {
      await artworkReady;
      await route.continue();
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const start = page.getByRole("button", {
      name: "Start playing",
      exact: true,
    });
    await expect(start).toBeInViewport();
    const artwork = page.locator(".titleArtwork img");
    const unloadedHeight = (await artwork.boundingBox())!.height;
    const unloadedActionY = (await start.boundingBox())!.y;
    releaseArtwork();
    await expect
      .poll(() =>
        artwork.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    expect(unloadedHeight).toBeGreaterThan(0);
    expect((await artwork.boundingBox())!.height).toBeCloseTo(
      unloadedHeight,
      0,
    );
    expect((await start.boundingBox())!.y).toBeCloseTo(unloadedActionY, 0);
  });
}
