import path from "path";
import { expect, test, type Locator } from "@playwright/test";
import { openPane } from "./layout";

async function scrollPast(target: Locator, distance: number) {
  return target.evaluate((element, above) => {
    let scroller = element.parentElement!;
    while (
      scroller.parentElement &&
      !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
    ) {
      scroller = scroller.parentElement;
    }
    scroller.scrollTop +=
      element.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      above;
    return scroller.getBoundingClientRect().top;
  }, distance);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`Insights controls stay pinned in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".insights:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    await expect(page.locator("main.base_main")).toHaveCount(1);
    const header = pane.locator(".insightsStickyHeader");
    const showRate = header.getByRole("button", { name: "Show rate slider" });
    if (await showRate.isVisible()) await showRate.click();
    const top = await scrollPast(header, 250);
    await expect(async () => {
      expect((await header.boundingBox())!.y).toBeCloseTo(top, 0);
    }).toPass();
    await expect(header.getByRole("slider")).toBeVisible();
    const programs = header.getByRole("button", { name: "Customer programs" });
    await expect(programs).toBeInViewport();
    await expect(page.getByText("Starting your mission…")).toBeHidden();
    if (process.env.PR_SCREENSHOTS) {
      await page.screenshot({
        path: path.join(
          process.env.PR_SCREENSHOTS,
          `insights-${testInfo.project.name}-${colorScheme}.png`,
        ),
      });
    }
    await programs.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test(`Events section headers hand off in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".eventLog:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Events", exact: true }),
    );
    await expect(page.locator("main.base_main")).toHaveCount(1);
    if (process.env.PR_SCREENSHOTS) {
      await expect(page.getByText("Starting your mission…")).toBeHidden();
      await page.screenshot({
        path: path.join(
          process.env.PR_SCREENSHOTS,
          `events-${testInfo.project.name}-${colorScheme}.png`,
        ),
      });
    }
    // Give each section enough room to scroll regardless of this run's event count.
    await pane
      .locator(".upcomingEvents, .eventHistory")
      .evaluateAll((sections) => {
        sections.forEach((section) => {
          (section as HTMLElement).style.minHeight = "1000px";
        });
      });
    for (const name of ["upcomingEvents", "eventHistory"]) {
      const section = pane.locator(`.${name}`);
      const top = await scrollPast(section, 150);
      const header = section.locator(".eventLogSectionHeader");
      await expect(async () => {
        expect((await header.boundingBox())!.y).toBeCloseTo(top, 0);
      }).toPass();
      const box = (await header.boundingBox())!;
      expect(
        await header.evaluate(
          (element, point) => {
            return element.contains(
              document.elementFromPoint(point.x, point.y),
            );
          },
          { x: box.x + 20, y: box.y + box.height / 2 },
        ),
      ).toBe(true);
    }
    await pane.getByRole("button", { name: /Filter event history/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
  });
}
