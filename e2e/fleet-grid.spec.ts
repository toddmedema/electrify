import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { editSavedGame, readSaveRecords } from "./save-fixture";
import { isStorage } from "../src/Types";

for (const theme of ["light", "dark"] as const) {
  test(`the live grid connects facility inspection and dispatch in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=107");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await openPane(
      page.locator(".facilities"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const grid = page.getByRole("region", { name: "Live power grid" });
    await expect(grid).toBeVisible();
    await expect(grid).toContainText("Customers");
    await expect(grid).toContainText("grid supply");
    await expect(page.locator(".facilityRow")).toHaveCount(0);
    const nodes = grid.locator(".fleetGridNode");
    await expect(nodes).toHaveCount(4);
    for (const node of await nodes.all()) {
      await expect(node.getByRole("meter")).toHaveAttribute(
        "aria-valuemax",
        "100",
      );
      expect((await node.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await node
          .locator("img")
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      ).toBeGreaterThan(0);
      expect(
        await node.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    expect(
      await grid.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`fleet-${theme}.png`),
      animations: "disabled",
    });
    await nodes.first().click();
    await expect(nodes.first()).toHaveAttribute("aria-pressed", "true");
    const selected = page.locator(".facilityRow.selected");
    await expect(selected).toBeVisible();
    await expect(
      selected.getByRole("button", { name: /^Pause / }),
    ).toBeVisible();
    await expect(selected.locator(".facilityDragHandle")).toHaveCount(0);
    await page.getByRole("button", { name: "Dispatch", exact: true }).click();
    await expect(grid).toHaveCount(0);
    await expect(page.locator(".facilitySupplyChart")).toBeVisible();
    await expect(page.locator(".facilityRow")).toHaveCount(4);
    await expect(page.locator(".facilityDragHandle")).toHaveCount(4);
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await expect(grid).toBeVisible();
    await expect(nodes.first()).toHaveAttribute("aria-pressed", "true");
  });
}

test("storage charge and direction remain visible in the live grid", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/?scenario=110");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await openPane(
    page.locator(".facilities"),
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  const battery = page.getByRole("button", {
    name: /^Inspect Battery in grid/,
  });
  await expect(battery).toContainText(/\d+% charged/);
  await expect(battery).toContainText(/stored/);
  await expect(battery).toContainText(/Standby|Charging|Supplying/);
});

for (const theme of ["light", "dark"] as const) {
  test(`reservoir and constrained facility states stay readable in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    const navigation = page.getByRole("button", {
      name: "Facilities",
      exact: true,
    });
    await openPane(pane, navigation);
    const hydro = page.getByRole("button", { name: /^Inspect Hydro in grid/ });
    await expect(hydro).toContainText(/Reservoir \d+%/);
    await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
    await editSavedGame(page, (save) => {
      // Keep the fixture compact enough to inspect every relevant state in one phone pane.
      save.game.facilities = save.game.facilities.filter(
        (facility) => facility.fuel !== "Sun" && facility.fuel !== "Wind",
      );
      const hydro = save.game.facilities.find(
        (facility) => facility.fuel === "Hydro",
      )!;
      hydro.reservoirWh = hydro.reservoirCapacityWh! * 0.1949;
      const battery = save.game.facilities.find(isStorage)!;
      battery.currentWh = battery.peakWh * 0.25;
      const nuclear = save.game.facilities.find(
        (facility) => facility.fuel === "Uranium",
      )!;
      nuclear.yearsToBuildLeft = nuclear.yearsToBuild / 2;
      const gas = save.game.facilities.find(
        (facility) => facility.fuel === "Natural Gas",
      )!;
      save.game.worldEvents.active.push({
        key: `cold:${save.game.location.id}:0`,
        definitionId: "weather-cold",
        startsMinute: save.game.date.minute,
        endsMinute: save.game.date.minute + 43800,
        attributes: { hazard: "EXTREME_COLD" },
        effects: { facilityOutputMultipliersById: { [String(gas.id)]: 0.55 } },
      });
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(pane, navigation);
    await expect(hydro).toContainText("Reservoir 19% · Low");
    await expect(hydro).toHaveAccessibleName(/reservoir 19% low/);
    await expect(
      page.getByRole("button", { name: /^Inspect Battery in grid/ }),
    ).toContainText("25% charged");
    await expect(
      page.getByRole("button", { name: /^Inspect Nuclear in grid/ }),
    ).toContainText("50% built");
    await expect(
      page.getByRole("button", { name: /^Inspect Natural Gas CC in grid/ }),
    ).toContainText("Extreme cold · 55% available");
    const grid = pane.getByRole("region", { name: "Live power grid" });
    for (const node of await grid.locator(".fleetGridNode").all()) {
      expect(
        await node.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    expect(
      await grid.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: info.outputPath(`fleet-constrained-${theme}.png`),
      animations: "disabled",
    });
  });
}
