import { expect, test } from "./fixtures";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`intertie construction controls and motion in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const build = async () => {
      await pane.getByRole("button", { name: "Build", exact: true }).click();
      await page.getByRole("tab", { name: "Interties", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Review purchase of Pacific Northwest intertie",
        })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Take loan" })
        .click();
    };
    await build();
    const line = pane.locator(".transmissionLine").first();
    await line.locator(".facilityDisclosure").click();
    const cancel = line.getByRole("button", { name: /Cancel construction of/ });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(page.getByRole("dialog")).toContainText(
      "after settling the outstanding loan",
    );
    await page.getByRole("button", { name: "Nevermind", exact: true }).click();
    const speed = (name: string) =>
      page
        .locator("#appbar:visible")
        .getByRole("button", { name, exact: true })
        .first();
    await speed("fast speed").click();
    const fill = line.locator(".constructionProgressFill");
    await expect
      .poll(() => fill.evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(20);
    await speed("pause").click();
    await expect
      .poll(() =>
        fill.evaluate(
          (el) => getComputedStyle(el, "::before").animationPlayState,
        ),
      )
      .toBe("paused");
    await page.mouse.move(0, 0);
    await expect(page.locator(".snackbarContent")).toBeHidden();
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("intertie-construction.png"),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() =>
        fill.evaluate((el) => getComputedStyle(el, "::before").display),
      )
      .toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await cancel.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel construction", exact: true })
      .click();
    await expect(line).toHaveCount(0);
    await build();
    await speed("fast speed").click();
    // The rebuilt line can cross an event that pauses the clock before it finishes.
    await expect(async () => {
      if ((await speed("pause").getAttribute("aria-pressed")) === "true") {
        await speed("fast speed").click();
      }
      await expect(line).not.toContainText("Building", { timeout: 1000 });
    }).toPass({ timeout: 45000 });
    await speed("pause").click();
    await line.locator(".facilityDisclosure").click();
    await line
      .getByRole("button", { name: /^Pause Northern intertie/ })
      .click();
    await expect(line.locator(".facilityDisclosure")).toHaveAccessibleName(
      /paused/,
    );
    await expect(
      line.getByRole("button", { name: /^Resume Northern intertie/ }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.locator(".snackbarContent")).toBeHidden();
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("intertie-paused.png") });
    const metrics = line.locator(".transmissionMetrics");
    await expect(metrics.locator("dt")).toHaveText([
      "Import capacity",
      "Export capacity",
      "Price now",
      "Import available now",
      "Emissions (CO2e)",
      "Typical price",
      "Loan balance",
    ]);
    // Operational metrics retain the shared grid; directional capacities stack on phones.
    const facility = pane.locator(".facilityRow").first();
    await facility.locator(".facilityDisclosure").click();
    const facilityDetails = facility.locator(".facilityDetails");
    for (const width of [320, 459, 460, 608]) {
      const layouts = [];
      for (const details of [
        facilityDetails,
        line.locator(".transmissionLineDetails"),
      ]) {
        layouts.push(
          await details.evaluate((element, panelWidth) => {
            const container = element as HTMLElement;
            const original = container.style.cssText;
            container.style.width = panelWidth + "px";
            container.style.boxSizing = "border-box";
            const grid = container.querySelector(".facilityStats")!;
            const cells = Array.from(grid.children)
              .filter(
                (cell) => !cell.classList.contains("intertieCapacityMetric"),
              )
              .map((cell) => cell.getBoundingClientRect());
            const style = getComputedStyle(grid);
            const result = {
              columns: style.gridTemplateColumns.split(" ").length,
              cellWidth: cells[0].width,
              columnGap: style.columnGap,
              rowGap: style.rowGap,
              noOverflow: Array.from(
                grid.querySelectorAll<HTMLElement>("*"),
              ).every((cell) => cell.scrollWidth <= cell.clientWidth + 1),
            };
            container.style.cssText = original;
            return result;
          }, width),
        );
      }
      expect(layouts[1]).toEqual(layouts[0]);
      expect(layouts[1].columns).toBe(width < 460 ? 2 : width < 608 ? 3 : 4);
      expect(layouts[1].noOverflow).toBe(true);
    }
    await facility.locator(".facilityDisclosure").click();
    if (testInfo.project.name === "desktop-chromium") {
      const handle = page.getByRole("separator").first();
      await handle.focus();
      for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
      await expect
        .poll(() =>
          metrics.evaluate(
            (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
          ),
        )
        .toBe(3);
      await handle.evaluate((el) => (el as HTMLElement).blur());
      await line.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath("intertie-metrics-wide.png"),
      });
    }
    await line
      .getByRole("button", { name: /^Resume Northern intertie/ })
      .click();
    await expect(
      line.getByRole("button", { name: /^Pause Northern intertie/ }),
    ).toBeVisible();
  });
}
