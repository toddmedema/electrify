import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`home arc glints briefly between long quiet intervals in ${theme} mode`, async ({
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
      if (!animation) throw new Error("Expected the home arc animation");
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
      const before = bounds();
      const sample = (time: number) => {
        animation.currentTime = time;
        const style = getComputedStyle(pulse);
        return { offset: style.strokeDashoffset, opacity: style.opacity };
      };
      const first = sample(150);
      const second = sample(450);
      const quiet = [601, 1500, 5000, 7000].map(sample);
      const nextSweep = sample(10000 / 1.4 + 150);
      const timing = animation.effect!.getComputedTiming();
      return {
        before,
        after: bounds(),
        first,
        second,
        quiet,
        nextSweep,
        duration: timing.duration,
        recurring: timing.iterations === Infinity,
      };
    });
    expect(result.first.offset).not.toBe(result.second.offset);
    expect(Number(result.first.opacity)).toBeGreaterThan(0);
    expect(Number(result.second.opacity)).toBeGreaterThan(0);
    expect(result.quiet.every((sample) => sample.opacity === "0")).toBe(true);
    expect(Number(result.nextSweep.offset.replace("px", ""))).toBeCloseTo(
      Number(result.first.offset.replace("px", "")),
      2,
    );
    expect(Number(result.nextSweep.opacity)).toBeCloseTo(
      Number(result.first.opacity),
      2,
    );
    expect(result.duration).toBeCloseTo(10000 / 1.4, 1);
    expect(result.recurring).toBe(true);
    expect(result.after).toEqual(result.before);
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
