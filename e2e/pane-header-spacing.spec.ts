import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

for (const colorScheme of ["light", "dark"] as const) {
  test(`pane headers meet the status bar in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/?scenario=103");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    for (const name of ["Facilities", "Insights"] as const) {
      const pane = page.locator(`.${name.toLowerCase()}:visible`);
      await openPane(pane, page.getByRole("button", { name, exact: true }));
      await expect(async () => {
        const bar = (await page.locator("#appbar:visible").boundingBox())!;
        const status = (await page
          .locator(".gameStatusBar:visible")
          .boundingBox())!;
        // A compact Insights pane drops its title row and opens on the rate controls instead
        const header = (await pane
          .locator(".paneHeader:visible, .insightsLevers")
          .first()
          .boundingBox())!;
        expect(header.y).toBeCloseTo(status.y + status.height, 0);
        expect(header.y).toBeCloseTo(bar.y + bar.height, 0);
        if (
          await pane.evaluate((element) => element.classList.contains("pane"))
        ) {
          expect((await pane.boundingBox())!.y).toBeCloseTo(header.y, 0);
        }
        const progressBar = page.getByRole("progressbar", {
          name: "Year progress",
        });
        // The bar's box hangs past the edge by its tutorial-ring padding; the line itself is the
        // fill, which must sit on the header's top edge.
        const line = (await progressBar
          .locator(".yearProgressFill")
          .boundingBox())!;
        expect(line.y + line.height).toBeCloseTo(header.y, 0);
        expect((await progressBar.boundingBox())!.width).toBeCloseTo(
          bar.width,
          0,
        );
      }).toPass();
      if (name === "Facilities") {
        const build = (await pane
          .locator(".button-buildFacility")
          .boundingBox())!;
        const coarse = await page.evaluate(
          () => matchMedia("(pointer: coarse)").matches,
        );
        expect(build.height).toBeGreaterThanOrEqual(coarse ? 44 : 40);
      }
      if (process.env.PR_SCREENSHOTS) {
        await expect(page.getByText("Starting your mission…")).toBeHidden();
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: testInfo.outputPath(`${name}-${colorScheme}.png`),
        });
      }
    }
  });
}
