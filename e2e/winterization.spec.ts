import { expect, test } from "./fixtures";
import { openBuild, openPane } from "./layout";
import { wToSliderTick } from "../src/helpers/BuildSizing";

for (const theme of ["light", "dark"]) {
  test(`Deep Freeze offers permanent construction and retrofit winterization in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=107");
    await page.getByRole("button", { name: "Beginner", exact: true }).click();
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const build = await openBuild(page);
    await build.getByRole("tab", { name: "Generators", exact: true }).click();
    // The aggregate starting fleet defaults to a 900 MW project. Keep every review affordable.
    const capacity = build.getByRole("slider", { name: /^Capacity/ });
    await capacity.press("Home");
    for (let tick = 0; tick < wToSliderTick(100e6); tick++)
      await capacity.press("ArrowRight");
    await expect(page.locator("#construction-capacity")).toContainText(
      /100\s?MW/,
    );
    for (const name of ["Natural Gas Peaker", "Coal", "Nuclear", "Wind"]) {
      await build
        .getByRole("button", {
          name: `Review purchase of ${name}`,
          exact: true,
        })
        .click();
      const dialog = page.getByRole("dialog");
      const option = dialog.getByRole("checkbox", {
        name: /^Cold-weather package/,
      });
      await expect(option).not.toBeChecked();
      await option.check();
      await expect(option).toBeChecked();
      await dialog.getByRole("button", { name: "close", exact: true }).click();
      await expect(dialog).toBeHidden();
    }
    const fleet = page.locator(".facilities:visible");
    await openPane(
      fleet,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const row = fleet.locator('.facilityRow[data-fuel="Natural Gas"]').first();
    await row.locator(".facilityDisclosure").click();
    await row
      .getByRole("button", { name: /^Add cold-weather package/ })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("90% of capacity available for a month");
    await dialog.getByRole("button", { name: /^Pay \$/ }).click();
    await expect(row).toContainText("90% capacity available");
    await expect(
      row.getByRole("img", { name: /installing winterization/ }),
    ).toBeVisible();
    await expect(row.locator(".outputProgressBar")).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`winterization-${theme}.png`),
      animations: "disabled",
    });
  });
}
