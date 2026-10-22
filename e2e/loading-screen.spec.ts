import { expect, test } from "./fixtures";
import { openPane } from "./layout";

test.use({ serviceWorkers: "block" });

for (const theme of ["light", "dark"]) {
  test(`plant loading animation fits and completes in ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(
      (mode) => localStorage.setItem("theme", mode),
      theme,
    );
    let releaseData!: () => void;
    let downloads = 0;
    const dataReady = new Promise<void>((resolve) => (releaseData = resolve));
    await page.route("**/data/weather/**", async (route) => {
      downloads++;
      await dataReady;
      await route.continue();
    });
    await page.goto("/?scenario=103");
    await page.getByRole("button", { name: "Start game", exact: true }).click();

    const animation = page.locator(".loadingPlants");
    const status = page.locator(".loadingScreen").getByRole("status");
    try {
      await expect(animation).toBeVisible();
      await expect.poll(() => downloads).toBeGreaterThan(0);
      await expect(status).toHaveText(/\S/);
      await expect(page.getByRole("progressbar")).toHaveCount(0);
      await expect(animation.locator("image")).toHaveCount(15);
      const sources = await animation
        .locator("image")
        .evaluateAll((icons) =>
          icons.map((icon) => icon.getAttribute("href")!),
        );
      expect(new Set(sources).size).toBe(15);
      // Decode the real assets: a successful bundle doesn't prove SVGs were fetched.
      await page.evaluate(async (sources) => {
        await Promise.all(
          sources.map(async (src) => {
            const image = new Image();
            image.src = src;
            await image.decode();
          }),
        );
      }, sources);
      const box = (await animation.boundingBox())!;
      expect(box.width).toBeCloseTo(
        Math.min(page.viewportSize()!.width * 0.9, 600),
        0,
      );
      expect(box.x + box.width / 2).toBeCloseTo(
        page.viewportSize()!.width / 2,
        0,
      );

      // Seek the actual SVG timeline: one lap must visit both lobes and return
      // without tilting, clipping icons, or needing a JS animation loop.
      const positions = await animation.evaluate((element) => {
        const svg = element as SVGSVGElement;
        svg.pauseAnimations();
        return [0, 3, 6, 9, 12, 15, 18, 21, 24].map((time) => {
          svg.setCurrentTime(time);
          const icons = Array.from(svg.querySelectorAll("image"));
          return icons.map((icon) => {
            const bounds = icon.getBoundingClientRect();
            const matrix = icon.getCTM()!;
            return {
              x: bounds.x,
              y: bounds.y,
              right: bounds.right,
              bottom: bounds.bottom,
              tilt: Math.abs(matrix.b) + Math.abs(matrix.c),
            };
          });
        });
      });
      for (const frame of positions) {
        for (const icon of frame) {
          expect(icon.x).toBeGreaterThanOrEqual(box.x - 1);
          expect(icon.y).toBeGreaterThanOrEqual(box.y - 1);
          expect(icon.right).toBeLessThanOrEqual(box.x + box.width + 1);
          expect(icon.bottom).toBeLessThanOrEqual(box.y + box.height + 1);
          expect(icon.tilt).toBe(0);
        }
      }
      expect(positions[2][0].x).toBeGreaterThan(
        positions[0][0].x + box.width / 3,
      );
      expect(positions[6][0].x).toBeLessThan(positions[0][0].x - box.width / 3);
      expect(positions[1][0].y).toBeLessThan(
        positions[3][0].y - box.height / 3,
      );
      expect(positions[5][0].y).toBeLessThan(
        positions[7][0].y - box.height / 3,
      );
      expect(positions[4][0].x).toBeCloseTo(positions[0][0].x, 0);
      expect(positions[4][0].y).toBeCloseTo(positions[0][0].y, 0);
      expect(positions[8][0].x).toBeCloseTo(positions[0][0].x, 0);
      expect(positions[8][0].y).toBeCloseTo(positions[0][0].y, 0);
      await expect(page.locator(".loadingScreen #logo")).toHaveCSS(
        "opacity",
        "1",
      );
      await page.screenshot({ path: info.outputPath(`loading-${theme}.png`) });

      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(animation.locator("animateMotion")).toHaveCount(0);
      await expect(animation.locator("image")).toHaveCount(15);
      const still = await animation.locator("image").first().boundingBox();
      await animation.evaluate((element) =>
        (element as SVGSVGElement).setCurrentTime(48),
      );
      expect(await animation.locator("image").first().boundingBox()).toEqual(
        still,
      );
      await expect(status).toBeVisible();
    } finally {
      releaseData();
    }
    await openPane(
      page.locator(".facilities"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await expect(animation).toHaveCount(0);
  });
}
