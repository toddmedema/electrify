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
      const firstPosition = getComputedStyle(pulse).transform;
      animation.currentTime = 800;
      const secondPosition = getComputedStyle(pulse).transform;
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

test("reduced motion keeps only the static home trace", async ({ page }) => {
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
