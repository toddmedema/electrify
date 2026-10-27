import { expect, test } from "./fixtures";
import path from "path";
import { openPane, openBuild } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`build a larger intertie tier in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const facilities = page.locator(".facilities:visible");
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await openBuild(page);
    const controlGeometry = () =>
      page.locator(".constructionControls").evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          height: element.getBoundingClientRect().height,
          padding: style.padding,
          width: element.getBoundingClientRect().width,
        };
      });
    const generatorGeometry = await controlGeometry();
    await page.getByRole("tab", { name: "Storage", exact: true }).click();
    expect(await controlGeometry()).toEqual(generatorGeometry);
    await page.getByRole("tab", { name: "Interties", exact: true }).click();
    expect(await controlGeometry()).toEqual(generatorGeometry);
    await expect(page.locator(".constructionCapacity strong")).toHaveText(
      "Tier 1",
    );
    const card = page.getByTestId("transmission-project-california-north");
    const importAccess = card
      .locator(".buildOptionMetric")
      .filter({ hasText: "Import capacity" });
    const exportAccess = card
      .locator(".buildOptionMetric")
      .filter({ hasText: "Export capacity" });
    const importRating = importAccess.locator(":scope > div").nth(1);
    const exportRating = exportAccess.locator(":scope > div").nth(1);
    await expect(importAccess).toBeVisible();
    await expect(exportAccess).toBeVisible();
    const baseExportAccess = await exportRating.innerText();
    await expect(card.locator(".buildOptionMetrics")).not.toContainText(
      "Loan payment",
    );
    await card
      .getByRole("button", { name: "Show Pacific Northwest details" })
      .click();
    const baseAccess = await importRating.innerText();
    await card
      .getByRole("button", { name: "Hide Pacific Northwest details" })
      .click();
    const slider = page.getByRole("slider");
    await expect(slider).toHaveCount(1);
    const desktop = testInfo.project.use.viewport!.width >= 600;
    const sortControl = () =>
      desktop
        ? page.getByRole("combobox", { name: "Sort interties" })
        : page.getByRole("button", { name: /^Sort interties:/ });
    await expect(sortControl()).toBeVisible();
    if (desktop) await expect(sortControl()).toContainText("Build cost");
    else
      await expect(sortControl()).toHaveAccessibleName(
        "Sort interties: Build cost",
      );
    const sliderBox = (await slider.boundingBox())!;
    const sortBox = (await sortControl().boundingBox())!;
    expect(sortBox.x).toBeGreaterThanOrEqual(sliderBox.x + sliderBox.width);
    expect(
      Math.abs(
        sortBox.y + sortBox.height / 2 - sliderBox.y - sliderBox.height / 2,
      ),
    ).toBeLessThan(2);
    for (const option of ["Build time", "Lowest emissions", "Build cost"]) {
      await sortControl().click();
      const options = page.getByRole(desktop ? "option" : "menuitem");
      await expect(options).toHaveText([
        "Build cost",
        "Build time",
        "Lowest emissions",
      ]);
      for (const choice of await options.all()) {
        await expect(choice).toHaveCSS(
          "color",
          theme === "light" ? "rgb(23, 35, 52)" : "rgb(230, 237, 245)",
        );
      }
      await page
        .getByRole(desktop ? "option" : "menuitem", {
          name: option,
          exact: true,
        })
        .click();
      if (desktop) await expect(sortControl()).toContainText(option);
      else
        await expect(sortControl()).toHaveAccessibleName(
          `Sort interties: ${option}`,
        );
    }
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      ((theme === "light" && desktop) || (theme === "dark" && !desktop))
    ) {
      if (desktop) await sortControl().click();
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `intertie-sort-${theme}-${testInfo.project.name}.png`,
        ),
        animations: "disabled",
      });
      if (desktop) await page.keyboard.press("Escape");
    }
    await slider.focus();
    await slider.press("End");
    await expect(slider).toHaveAttribute("aria-valuenow", "4");
    await expect(card).not.toContainText("Line capacity");
    await card
      .getByRole("button", { name: "Show Pacific Northwest details" })
      .click();
    await expect(importRating).not.toHaveText(baseAccess);
    await expect(exportRating).toHaveText(baseExportAccess);
    const selectedAccess = await importRating.innerText();
    const properties = card.getByRole("table", { name: "intertie properties" });
    await expect(properties).toBeVisible();
    await expect(
      properties.getByRole("row", { name: /Construction emissions/ }),
    ).toBeVisible();
    for (const row of await properties.getByRole("row").all()) {
      await expect(row.locator(":scope > *")).toHaveCount(3);
      await expect(
        row.locator(":scope > *").last().getByRole("button"),
      ).toBeVisible();
    }
    // Keep only the neighbor’s supply-risk summary.
    await expect(card.locator(".buildOptionDescription")).toHaveCount(1);
    expect(
      await card.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await card
      .getByRole("button", {
        name: "Review purchase of Pacific Northwest intertie",
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Tier 4");
    await expect(dialog).not.toContainText("Line capacity");
    await expect(
      dialog
        .locator(".decisionImpactFact")
        .filter({ hasText: "Import capacity" }),
    ).toContainText(selectedAccess);
    await expect(
      dialog
        .locator(".decisionImpactFact")
        .filter({ hasText: "Export capacity" }),
    ).toContainText("5MW");
    await dialog.getByRole("button", { name: "Pay cash", exact: true }).click();
    await expect(
      page
        .locator(".facilities:visible")
        .getByRole("button", { name: /Inspect Northern intertie/ }),
    ).toBeVisible();
  });
}
