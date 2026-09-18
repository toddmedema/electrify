import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

// Exercise pane width rather than assuming a viewport implies a column count.
// Only one project runs this explicit matrix to avoid duplicating it per project.
for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [320, 390, 540, 768, 1024, 1440]) {
    test(`expanded facility alignment at ${width}px in ${colorScheme}`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-chromium");
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(() => window.localStorage.clear());
      await page.goto("/?scenario=108");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const facilities = page.locator(".facilities:visible");
      await openPane(
        facilities,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );

      // Hydro exercises long captions; gas adds upkeep/start costs; storage has charge/cycles.
      for (const name of ["Hydro", "Natural Gas", "Battery"]) {
        const row = facilities.locator(".facilityRow").filter({
          has: page.locator(".facilityName", {
            hasText: new RegExp(`^${name}$`),
          }),
        });
        await row.locator(".facilityDisclosure").click();
        const details = row.locator(".facilityDetails");
        await expect(details).toBeVisible();
        await expect(
          details.getByRole("heading", { name: "Operation" }),
        ).toBeVisible();
        await expect(
          details.getByRole("heading", { name: "Economics" }),
        ).toBeVisible();
        const geometry = await details.evaluate((element) => {
          const innerWidth = element.clientWidth - 32;
          const grids = Array.from(element.querySelectorAll(".facilityStats"));
          return {
            innerWidth,
            columns: grids.map(
              (grid) =>
                getComputedStyle(grid).gridTemplateColumns.split(" ").length,
            ),
            overflow: Array.from(
              element.querySelectorAll<HTMLElement>(".facilityStat"),
            ).some((stat) => stat.scrollWidth > stat.clientWidth + 1),
            aligned: grids.every((grid) => {
              const rows = new Map<number, number[]>();
              for (const stat of Array.from(
                grid.querySelectorAll(".facilityStat:not(.facilityFuelTrend)"),
              )) {
                const top = Math.round(stat.getBoundingClientRect().top);
                const values = rows.get(top) || [];
                values.push(
                  stat.querySelector("dd")!.getBoundingClientRect().top,
                );
                rows.set(top, values);
              }
              return Array.from(rows.values()).every(
                (values) => Math.max(...values) - Math.min(...values) < 1,
              );
            }),
          };
        });
        const expectedColumns =
          geometry.innerWidth >= 540 ? 3 : geometry.innerWidth >= 280 ? 2 : 1;
        expect(geometry.columns).toEqual([expectedColumns, expectedColumns]);
        expect(geometry.overflow).toBe(false);
        expect(geometry.aligned).toBe(true);
        const labels = row.locator(".facilityActionLabel");
        for (const label of await labels.all())
          await expect(label).toBeVisible();
        expect(
          await row.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBe(true);
        await row.locator(".facilityDisclosure").click();
      }
    });
  }
}

test("expanded details reflow in a resized desktop pane and at 200% magnification", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      "desktopPaneWeightsInsights",
      JSON.stringify([1, 100, 1]),
    );
  });
  await page.goto("/?scenario=108");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const facilities = page.locator(".facilities:visible");
  await expect(facilities).toBeVisible();
  const row = facilities
    .locator(".facilityRow")
    .filter({
      has: page.locator(".facilityName", { hasText: /^Natural Gas$/ }),
    });
  await row.locator(".facilityDisclosure").click();
  const grid = row.locator(".facilityStats").first();
  const columns = () =>
    grid.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
  await expect.poll(columns).toBe(1);
  expect(
    await row.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  const handle = page.getByRole("separator").first();
  await handle.focus();
  for (let i = 0; i < 35; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(columns).toBe(3);
  // CSS zoom magnifies text, controls and spacing together while the pane keeps its allotted width.
  await facilities.evaluate((element) => {
    (element as HTMLElement).style.zoom = "2";
  });
  await expect.poll(columns).toBe(2);
  expect(
    await row.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  for (const label of await row.locator(".facilityActionLabel").all())
    await expect(label).toBeVisible();
});
