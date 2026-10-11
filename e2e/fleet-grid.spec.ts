import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { editSavedGame, readSaveRecords } from "./save-fixture";
import { isStorage } from "../src/Types";
import cloneDeep from "lodash.clonedeep";

for (const theme of ["light", "dark"] as const) {
  test(`30 facilities stay grouped, inspectable and compact in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
    const batteryCount = await editSavedGame(page, (save) => {
      const original = save.game.facilities;
      save.game.speed = "PAUSED";
      // Hydro sites are exclusive. Keep the real site and repeat unrestricted technologies.
      const repeatable = original.filter(
        (facility) => facility.fuel !== "Hydro",
      );
      save.game.facilities.push(
        ...Array.from({ length: 30 - original.length }, (_, index) => ({
          ...cloneDeep(repeatable[index % repeatable.length]),
          id: 500 + index,
        })),
      );
      const solar = save.game.facilities.find(
        (facility) => facility.name === "Solar",
      )!;
      solar.yearsToBuildLeft = solar.yearsToBuild / 2;
      const gas = save.game.facilities.find(
        (facility) => facility.name === "Natural Gas CC",
      )!;
      gas.paused = true;
      gas.currentW = 0;
      const hydro = save.game.facilities.find(
        (facility) => facility.fuel === "Hydro",
      )!;
      hydro.reservoirWh = hydro.reservoirCapacityWh! * 0.1;
      const batteries = save.game.facilities.filter(isStorage);
      batteries.forEach((battery, index) => {
        battery.currentWh = battery.peakWh * 0.25;
        battery.currentW = index === 0 ? 5000000 : index === 1 ? -10000000 : 0;
      });
      // Keep the frozen tick consistent with the expanded inventory shown in screenshots.
      const now = save.game.timeline.find(
        (tick) => tick.minute === save.game.date.minute,
      )!;
      now.supplyW = save.game.facilities.reduce(
        (sum, facility) =>
          sum + (facility.yearsToBuildLeft > 0 ? 0 : facility.currentW),
        0,
      );
      now.reserveW = now.supplyW - now.demandW;
      return batteries.length;
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const grid = pane.getByRole("region", { name: "Live power grid" });
    await expect(grid.locator(".fleetGridNode")).toHaveCount(6);
    await expect(
      grid.getByRole("button", { name: /^Inspect Solar group/ }),
    ).toContainText("1 building");
    await expect(
      grid.getByRole("button", { name: /^Inspect Natural Gas CC group/ }),
    ).toContainText("1 paused");
    await expect(
      grid.getByRole("button", { name: /^Inspect Hydro group/ }),
    ).toContainText("1 low reservoir");
    const battery = grid.getByRole("button", {
      name: /^Inspect Battery group/,
    });
    await expect(battery).toContainText("Charging 10MW");
    await expect(battery).toContainText("Discharging 5MW");
    for (const node of await grid.locator(".fleetGridNode").all()) {
      expect((await node.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await node.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    expect(
      await pane.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: info.outputPath(`grouped-fleet-${theme}.png`),
      animations: "disabled",
    });
    await battery.click();
    const members = grid.getByRole("button", { name: /^Inspect Battery #/ });
    await expect(members).toHaveCount(batteryCount);
    const selectedId = (await members
      .first()
      .getAttribute("aria-label"))!.match(/#(\d+)/)![1];
    await members.first().click();
    const selected = pane.locator(".facilityRow.selected");
    await expect(selected).toBeVisible();
    await expect(
      selected.getByRole("button", { name: "Pause Battery" }),
    ).toBeVisible();
    await expect(members.first()).toHaveAttribute("aria-pressed", "true");
    await expect(grid.locator(".fleetGridBalance")).toBeInViewport();
    await expect(selected).toHaveAttribute(
      "data-rfd-draggable-id",
      `f${selectedId}`,
    );
    await grid.getByRole("button", { name: "Close facility group" }).click();
    await expect(pane.locator(".facilityRow")).toHaveCount(0);
    await expect(members).toHaveCount(0);
    await page.getByRole("button", { name: "Dispatch", exact: true }).click();
    await expect(pane.locator(".facilityRow")).toHaveCount(30);
  });

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
      await expect
        .poll(() =>
          node
            .locator("img")
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBeGreaterThan(0);
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
    await expect(nodes.first()).toHaveAttribute("aria-expanded", "true");
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
    await expect(nodes.first()).toHaveAttribute("aria-expanded", "true");
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
    name: /^Inspect Battery group/,
  });
  await expect(battery).toContainText(/\d+% charged/);
  await expect(battery).toContainText(/stored/);
  await expect(battery).toContainText(/Standby|Charging|Discharging/);
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
    const hydro = page.getByRole("button", { name: /^Inspect Hydro group/ });
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
    await expect(hydro).toContainText("Reservoir 19%");
    await expect(hydro).toHaveAccessibleName(/Reservoir 19%.*1 low reservoir/);
    await expect(
      page.getByRole("button", { name: /^Inspect Battery group/ }),
    ).toContainText("25% charged");
    await expect(
      page.getByRole("button", { name: /^Inspect Nuclear group/ }),
    ).toContainText("1 building");
    await expect(
      page.getByRole("button", { name: /^Inspect Natural Gas CC group/ }),
    ).toContainText("1 extreme cold");
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
