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
    const summary = pane.getByRole("region", { name: "Live power flow" });
    const sources = summary.getByRole("button", { name: /^Inspect .* group,/ });
    await expect(sources).toHaveCount(6);
    await expect(pane.locator(".facilityRow")).toHaveCount(30);
    await expect(
      pane.getByRole("button", { name: "Grid", exact: true }),
    ).toHaveCount(0);
    await expect(
      pane.getByRole("button", { name: "Dispatch", exact: true }),
    ).toHaveCount(0);
    await expect(pane.locator("#chartSupplyDemand")).toHaveCount(0);
    const exceptions = summary.getByLabel("Facility exceptions");
    await expect(exceptions).toContainText("1 building");
    await expect(exceptions).toContainText("1 paused");
    await expect(exceptions).toContainText("1 low reservoir");
    const battery = summary.getByRole("button", {
      name: /^Inspect Battery group/,
    });
    await expect(battery).toContainText("5MW out");
    await expect(battery).toContainText("10MW in");
    await expect(battery).toHaveAccessibleName(
      /discharging 5MW, charging 10MW/,
    );
    expect((await summary.boundingBox())!.height).toBeLessThanOrEqual(236);
    for (const source of await sources.all()) {
      expect((await source.boundingBox())!.height).toBeGreaterThanOrEqual(
        info.project.use.hasTouch ? 44 : 40,
      );
      expect(
        await source.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    expect(
      await pane.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(pane.locator(".facilityRow").first()).toBeInViewport();
    const order = await pane
      .locator(".facilityRow")
      .evaluateAll((elements) =>
        elements.map((element) =>
          element.getAttribute("data-rfd-draggable-id"),
        ),
      );
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: info.outputPath("power-flow-" + theme + ".png"),
      animations: "disabled",
    });
    await battery.click();
    const selected = pane.locator(".facilityRow.selected");
    await expect(selected).toBeInViewport();
    await expect(
      selected.getByRole("button", { name: "Pause Battery" }),
    ).toBeVisible();
    await expect(selected.locator(".facilityDisclosure")).toBeFocused();
    await expect(battery).toHaveAttribute("aria-pressed", "true");
    await expect(pane.locator(".facilityRow")).toHaveCount(30);
    expect(
      await pane
        .locator(".facilityRow")
        .evaluateAll((elements) =>
          elements.map((element) =>
            element.getAttribute("data-rfd-draggable-id"),
          ),
        ),
    ).toEqual(order);
    await selected.locator(".facilityDisclosure").click();
    await expect(pane.locator(".facilityRow.selected")).toHaveCount(0);
    await expect(battery).toContainText("×" + batteryCount);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(
    "power flow and forecast share the dispatch list in " + theme,
    async ({ page }) => {
      await page.addInitScript((mode) => {
        localStorage.clear();
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
      }, theme);
      await page.goto("/?scenario=107");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const pane = page.locator(".facilities:visible");
      await openPane(
        pane,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
      const summary = pane.getByRole("region", { name: "Live power flow" });
      await expect(summary.getByLabel("Current power balance")).toContainText(
        "Demand now",
      );
      await expect(pane.locator(".facilityRow")).toHaveCount(4);
      const source = summary
        .getByRole("button", { name: /^Inspect .* group,/ })
        .first();
      await source.click();
      await expect(pane.locator(".facilityRow.selected")).toBeVisible();
      await expect(source).toHaveAttribute("aria-pressed", "true");
      const forecast = summary.getByRole("button", {
        name: "Forecast",
        exact: true,
      });
      await forecast.click();
      await expect(forecast).toHaveAttribute("aria-expanded", "true");
      await expect(pane.locator(".facilitySupplyChart")).toBeVisible();
      await forecast.click();
      await expect(forecast).toHaveAttribute("aria-expanded", "false");
      await expect(pane.locator(".facilitySupplyChart")).toHaveCount(0);
      await expect(pane.locator(".facilityRow")).toHaveCount(4);
    },
  );

  test(
    "exceptions navigate directly to individual facility detail in " + theme,
    async ({ page }, info) => {
      await page.addInitScript((mode) => {
        localStorage.clear();
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
      }, theme);
      await page.goto("/?scenario=108");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await expect
        .poll(async () => (await readSaveRecords(page)).length)
        .toBe(1);
      await editSavedGame(page, (save) => {
        save.game.speed = "PAUSED";
        const hydro = save.game.facilities.find(
          (facility) => facility.fuel === "Hydro",
        )!;
        hydro.reservoirWh = hydro.reservoirCapacityWh! * 0.1949;
        const nuclear = save.game.facilities.find(
          (facility) => facility.fuel === "Uranium",
        )!;
        nuclear.yearsToBuildLeft = nuclear.yearsToBuild / 2;
        const gas = save.game.facilities.find(
          (facility) => facility.fuel === "Natural Gas",
        )!;
        save.game.worldEvents.active.push({
          key: "summary-cold",
          definitionId: "weather-cold",
          startsMinute: save.game.date.minute,
          endsMinute: save.game.date.minute + 43800,
          attributes: { hazard: "EXTREME_COLD" },
          effects: {
            facilityOutputMultipliersById: { [String(gas.id)]: 0.55 },
          },
        });
      });
      await page.reload();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      const pane = page.locator(".facilities:visible");
      await openPane(
        pane,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
      const summary = pane.getByRole("region", { name: "Live power flow" });
      await expect(summary).toContainText("1 low reservoir");
      await expect(summary).toContainText("1 building");
      await expect(summary).toContainText("1 extreme cold");
      await summary
        .getByRole("button", {
          name: "Inspect 1 low reservoir facility",
          exact: true,
        })
        .click();
      const selected = pane.locator(".facilityRow.selected");
      await expect(selected).toHaveAttribute("data-fuel", "Hydro");
      await expect(selected).toContainText(/19%/);
      await expect(selected).toBeInViewport();
      await summary
        .getByRole("button", {
          name: "Inspect 1 extreme cold facility",
          exact: true,
        })
        .click();
      await expect(selected).toHaveAttribute("data-fuel", "Natural Gas");
      await expect(selected).toContainText("Extreme cold");
      await expect(selected).toContainText("55%");
      await expect(pane.locator(".facilityRow")).toHaveCount(6);
      await page.screenshot({
        path: info.outputPath("facility-exception-" + theme + ".png"),
        animations: "disabled",
      });
    },
  );
}
test("storage charge remains in the existing facility details", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/?scenario=110");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const pane = page.locator(".facilities:visible");
  await openPane(
    pane,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  const battery = pane.getByRole("button", { name: /^Inspect Battery group/ });
  await expect(battery).toHaveAccessibleName(/discharging .* charging/);
  await battery.click();
  await expect(pane.locator(".facilityRow.selected")).toContainText("Battery");
  await expect(
    pane
      .locator(".facilityRow.selected")
      .getByRole("button", { name: "Pause Battery" }),
  ).toBeVisible();
});
