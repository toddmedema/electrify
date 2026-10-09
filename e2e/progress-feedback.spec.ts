import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { editSavedGame } from "./save-fixture";

for (const theme of ["light", "dark"]) {
  test(`weather recovery remains explicit with reduced motion in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const plantId = await editSavedGame(page, (save) => {
      const plant = save.game.facilities.find(
        (facility) => facility.fuel === "Natural Gas",
      )!;
      plant.paused = true;
      plant.currentW = 0;
      save.game.worldEvents.active.push({
        key: `cold:feedback:f${plant.id}`,
        definitionId: "weather-cold",
        startsMinute: save.game.date.minute,
        endsMinute: save.game.date.minute + 15,
        attributes: { hazard: "EXTREME_COLD", facilityId: plant.id },
        effects: { facilityOutputMultipliersById: { [String(plant.id)]: 0.5 } },
      });
      return plant.id;
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const row = pane.locator(`[data-rfd-draggable-id="f${plantId}"]`);
    await expect(row.locator(".facilityDisclosure")).toHaveAccessibleName(
      /Extreme cold, 50% available/,
    );
    // Loading a damaged or healthy save never announces a transition that was not observed.
    await expect(row.locator(".facilityReadyLabel")).toHaveCount(0);
    await page
      .getByRole("button", { name: "normal speed", exact: true })
      .click();
    await expect(row.locator(".facilityReadyLabel")).toHaveText("Outage ended");
    await page.getByRole("button", { name: "pause", exact: true }).click();
    await expect(row.locator(".facilityStatus")).toContainText("paused");
    await expect(row.getByRole("status")).toHaveText(
      /weather outage ended. Operation is paused/,
    );
    expect(
      await row.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(row.locator(".facilityRowHeader")).toHaveCSS(
      "animation-name",
      "none",
    );
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `recovery-${info.project.name}-${theme}.png`,
        ),
      });
    }
    await expect(row.locator(".facilityReadyLabel")).toHaveCount(0, {
      timeout: 10000,
    });
  });
}
