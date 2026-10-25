import { expect, test } from "./fixtures";

test("reduced motion keeps the home decoration still and actions usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const trace = page.locator(".homeEnergyTrace");
  await expect(trace).toBeVisible();
  await expect(trace).toHaveAttribute("aria-hidden", "true");
  expect(
    await trace.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  await expect(page.locator(".homeEnergyPulse")).toHaveCSS("opacity", "0");
  await expect(page.getByRole("button", { name: "Play" })).toBeEnabled();
});
