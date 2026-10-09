import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { editSavedGame } from "./save-fixture";

for (const theme of ["light", "dark"]) {
  test(`cancelled projects retain an accurate history heading in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator("#appbar:visible").first()).toBeVisible();
    await editSavedGame(page, (save) => {
      const id = (save.game.eventLog[0]?.id ?? 0) + 1;
      save.game.eventLog.unshift({
        id,
        kind: "BUILD",
        label: `${save.game.date.month} ${save.game.date.year}`,
        message: "Cancelled construction of Natural Gas CC",
      });
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const pane = page.locator(".eventLog:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Events", exact: true }),
    );
    const cancellation = pane.locator(".eventLogItem").filter({
      hasText: "Cancelled construction of Natural Gas CC",
    });
    await expect(cancellation.locator(".eventChangeTitle")).toHaveText(
      "Project cancelled",
    );
    expect(
      await cancellation.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: info.outputPath(`project-cancelled-${theme}.png`),
    });
  });
}

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
    await expect(page.locator("#appbar:visible").first()).toBeVisible();
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
    const node = pane.getByRole("button", {
      name: /^Inspect Natural Gas CC in grid/,
    });
    await expect(node).toContainText("Paused");
    // Loading a damaged or healthy save never announces a transition that was not observed.
    await expect(node.locator(".fleetGridMilestoneLabel")).toHaveCount(0);
    await page
      .getByRole("button", { name: "normal speed", exact: true })
      .click();
    await expect(node.locator(".fleetGridMilestoneLabel")).toContainText(
      "Outage ended",
    );
    await page.getByRole("button", { name: "pause", exact: true }).click();
    await expect(node).toContainText("0/200MW output");
    await expect(node).toContainText("Paused");
    await expect(pane.getByRole("status")).toHaveText(
      /weather outage ended. Operation is paused/,
    );
    expect(
      await node.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      await node.evaluate(
        (element) => getComputedStyle(element, "::before").animationName,
      ),
    ).toBe("none");
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `grid-recovery-${info.project.name}-${theme}.png`,
        ),
      });
    }
    // Inspecting a node mounts its details without announcing or drawing the same cue twice.
    await node.click();
    await expect(pane.getByRole("status")).toHaveCount(1);
    await expect(pane.locator(".facilityReadyLabel")).toHaveCount(0);
    await pane.getByRole("button", { name: "Dispatch", exact: true }).click();
    const row = pane.locator(`[data-rfd-draggable-id="f${plantId}"]`);
    await expect(row.locator(".facilityReadyLabel")).toHaveText("Outage ended");
    await expect(row.locator(".facilityStatus")).toContainText("paused");
    await expect(row.locator(".facilityReadyLabel")).toHaveCount(0, {
      timeout: 10000,
    });
  });
}

for (const theme of ["light", "dark"]) {
  test(`commissioning is observed by the unselected Grid and shared with Dispatch in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator("#appbar:visible").first()).toBeVisible();
    const plantId = await editSavedGame(page, (save) => {
      const plant = save.game.facilities.find(
        (facility) => facility.fuel === "Natural Gas",
      )!;
      plant.yearsToBuildLeft = 0.00005;
      plant.paused = true;
      plant.currentW = 0;
      delete plant.minuteOperational;
      return plant.id;
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const node = pane.getByRole("button", {
      name: /^Inspect Natural Gas CC in grid/,
    });
    await expect(node).toContainText("built");
    await expect(
      pane.locator(".facilityReadyLabel, .fleetGridMilestoneLabel"),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "normal speed", exact: true })
      .click();
    await expect(node.locator(".fleetGridMilestoneLabel")).toContainText(
      "Commissioned",
    );
    await page.getByRole("button", { name: "pause", exact: true }).click();
    await expect(node).toContainText("0/200MW output");
    await expect(node).toContainText("Paused");
    await expect(node).toHaveAttribute("aria-pressed", "false");
    await expect(pane.getByRole("status")).toHaveText(
      /construction complete. Operation is paused/,
    );
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `grid-commissioned-${info.project.name}-${theme}.png`,
        ),
      });
    }
    await pane.getByRole("button", { name: "Dispatch", exact: true }).click();
    const row = pane.locator(`[data-rfd-draggable-id="f${plantId}"]`);
    await expect(row.locator(".facilityReadyLabel")).toHaveText("Commissioned");
    await expect(row.locator(".facilityStatus")).toContainText("paused");
    await expect(pane.getByRole("status")).toHaveCount(1);
    await pane.getByRole("button", { name: "Grid", exact: true }).click();
    await expect(node.locator(".fleetGridMilestoneLabel")).toContainText(
      "Commissioned",
    );
    await expect(node.locator(".fleetGridMilestoneLabel")).toHaveCount(0, {
      timeout: 10000,
    });
    // Restoring the completed save is not another completion.
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await expect(
      pane.locator(".facilityReadyLabel, .fleetGridMilestoneLabel"),
    ).toHaveCount(0);
    await expect(pane.getByRole("status")).toBeEmpty();
  });
}
