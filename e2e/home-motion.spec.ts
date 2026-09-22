import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`home motion settles without moving the logo or actions in ${theme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const trace = page.locator(".homeEnergyTrace");
    await expect(trace).toBeVisible();
    await expect(trace).toHaveAttribute("aria-hidden", "true");

    const result = await trace.evaluate(async (element) => {
      const pulse = element.firstElementChild!;
      const animation = pulse.getAnimations()[0];
      if (!animation) throw new Error("Expected the home entrance animation");
      animation.pause();
      await Promise.all([
        document.fonts.ready,
        document.querySelector<HTMLImageElement>("#logo img")!.decode(),
      ]);
      const bounds = () =>
        ["#logo img", ".mainActions"].map((selector) => {
          const rect = document
            .querySelector(selector)!
            .getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        });
      animation.currentTime = 320;
      const before = bounds();
      const firstPosition = getComputedStyle(pulse).strokeDashoffset;
      animation.currentTime = 800;
      const secondPosition = getComputedStyle(pulse).strokeDashoffset;
      const endTime = animation.effect!.getComputedTiming().endTime;
      animation.play();
      await animation.finished;
      return {
        before,
        after: bounds(),
        firstPosition,
        secondPosition,
        endTime,
        opacity: getComputedStyle(pulse).opacity,
        running: pulse
          .getAnimations()
          .some((item) => item.playState === "running"),
      };
    });
    expect(result.firstPosition).not.toBe(result.secondPosition);
    expect(result.endTime).toBeLessThanOrEqual(3200);
    expect(result.after).toEqual(result.before);
    expect(result.opacity).toBe("0");
    expect(result.running).toBe(false);
    await expect(
      page.getByRole("button", { name: "Start playing" }),
    ).toBeEnabled();
  });
}

test("reduced motion keeps the original static logo", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const trace = page.locator(".homeEnergyTrace");
  await expect(trace).toBeVisible();
  expect(
    await trace.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  await expect(page.locator(".homeEnergyPulse")).toHaveCSS("opacity", "0");
  await expect(
    page.getByRole("button", { name: "Start playing" }),
  ).toBeEnabled();
});

for (const shortLandscape of [false, true]) {
  test(`the arc overlay stays aligned with the logo${shortLandscape ? " in short landscape" : ""}`, async ({
    page,
  }) => {
    if (shortLandscape) await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");
    await expect(page.locator("#logo img")).toBeVisible();
    const alignment = await page
      .locator(".homeEnergyTrace")
      .evaluate(async (element) => {
        const image = document.querySelector<HTMLImageElement>("#logo img")!;
        await image.decode();
        const rect = image.getBoundingClientRect();
        const scale = Math.min(rect.width / 300, rect.height / 70);
        const expectedStart = {
          x: rect.x + (rect.width - 300 * scale) / 2 + 57.7873 * scale,
          y: rect.y + (rect.height - 70 * scale) / 2 + 5.39465 * scale,
        };
        const path = element.querySelector("path")!;
        const actualStart = new DOMPoint(57.7873, 5.39465).matrixTransform(
          path.getScreenCTM()!,
        );
        return {
          expectedStart,
          actualStart: { x: actualStart.x, y: actualStart.y },
        };
      });
    expect(alignment.actualStart.x).toBeCloseTo(alignment.expectedStart.x, 1);
    expect(alignment.actualStart.y).toBeCloseTo(alignment.expectedStart.y, 1);
  });
}
