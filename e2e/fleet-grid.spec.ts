import { expect, test } from "./fixtures";
import { openPane } from "./layout";

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
