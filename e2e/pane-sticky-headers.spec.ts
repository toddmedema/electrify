import path from "path";
import { expect, test, type Locator } from "./fixtures";
import { openPane } from "./layout";

async function scrollPast(target: Locator, distance: number) {
  return target.evaluate((element, above) => {
    let scroller = element.parentElement!;
    while (
      scroller.parentElement &&
      (!/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) ||
        scroller.scrollHeight <= scroller.clientHeight + 1)
    ) {
      scroller = scroller.parentElement;
    }
    const previousScroll = scroller.scrollTop;
    scroller.scrollTop +=
      element.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      above;
    if (scroller.scrollTop <= previousScroll) {
      throw new Error("Sticky-header fixture must scroll past its target");
    }
    return scroller.getBoundingClientRect().top;
  }, distance);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`Insights tool header stays pinned in ${colorScheme} mode`, async ({
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
    const tool = page.getByRole("region", { name: "Insights", exact: true });
    await tool.evaluate(async (panel) => {
      await Promise.all(
        panel.getAnimations().map((animation) => animation.finished),
      );
    });
    const header = tool.locator(".gameToolHeader");
    const top = (await header.boundingBox())!.y;
    // The default charts can fit without scrolling. Exercise real sticky positioning
    // at every viewport, just as the Events fixture below gives its sections room.
    await pane.locator(".insightsTracks").evaluate((tracks) => {
      (tracks as HTMLElement).style.minHeight = "1600px";
    });
    const content = pane.locator(".scrollable");
    await content.evaluate((element) => {
      element.scrollTop = 250;
    });
    expect(
      await content.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
    await expect(async () => {
      expect((await header.boundingBox())!.y).toBeCloseTo(top, 0);
    }).toPass();
    await expect(
      header.getByRole("heading", { name: "Insights", exact: true }),
    ).toBeInViewport();
    const close = header.getByRole("button", {
      name: "Close Insights",
      exact: true,
    });
    await expect(close).toBeInViewport();
    await expect(page.getByText("Starting your mission…")).toBeHidden();
    if (process.env.PR_SCREENSHOTS) {
      await page.screenshot({
        path: path.join(
          process.env.PR_SCREENSHOTS,
          `insights-${testInfo.project.name}-${colorScheme}.png`,
        ),
      });
    }
    await close.click();
    await expect(tool).toBeHidden();
  });

  test(`Events history header stays pinned in ${colorScheme} mode`, async ({
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
    await page
      .getByRole("region", { name: "Events", exact: true })
      .evaluate(async (panel) => {
        await Promise.all(
          panel.getAnimations().map((animation) => animation.finished),
        );
      });
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
    // Give history enough room to scroll regardless of this run's event count.
    const section = pane.locator(".eventHistory");
    await section.evaluate((element) => {
      (element as HTMLElement).style.minHeight = "1000px";
    });
    const top = await scrollPast(section, 150);
    const header = section.locator(".eventLogSectionHeader");
    await expect(async () => {
      expect((await header.boundingBox())!.y).toBeCloseTo(top, 0);
    }).toPass();
    const box = (await header.boundingBox())!;
    expect(
      await header.evaluate(
        (element, point) => {
          return element.contains(document.elementFromPoint(point.x, point.y));
        },
        { x: box.x + 20, y: box.y + box.height / 2 },
      ),
    ).toBe(true);
    await pane.getByRole("button", { name: /Filter event history/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
  });
}
