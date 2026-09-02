import { expect, test } from "@playwright/test";

test("chart-heavy controls remain responsive during pointer gestures", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440px");
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [{ scenarioId: 0, date: new Date().toString() }],
      }),
    );
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await page.getByRole("button", { name: "View Custom Game details" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();

  // A divider drag used to destroy and reconstruct every visible uPlot on every pointer step.
  // Count actual plot nodes added during a gesture so that regression is deterministic and does
  // not depend on CI machine timing.
  await page.evaluate(() => {
    (window as Window & { plotsAdded?: number }).plotsAdded = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const total =
            (node.matches(".uplot") ? 1 : 0) +
            node.querySelectorAll(".uplot").length;
          const target = window as Window & { plotsAdded?: number };
          target.plotsAdded = (target.plotsAdded || 0) + total;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  const splitter = page.getByRole("separator").first();
  const splitterBox = await splitter.boundingBox();
  expect(splitterBox).not.toBeNull();
  await page.mouse.move(
    splitterBox!.x + splitterBox!.width / 2,
    splitterBox!.y + splitterBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(splitterBox!.x + 220, splitterBox!.y, { steps: 40 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(
      () => (window as Window & { plotsAdded?: number }).plotsAdded,
    ),
  ).toBeLessThanOrEqual(8);

  // The expensive 20-year projection should retain its current preview during the drag and
  // commit exactly where the player releases, keeping the pointer path free of projection work.
  await page.getByRole("combobox", { name: "Insight range" }).click();
  await page.getByRole("option", { name: "Next 20 years" }).click();
  const controls = page.getByRole("region", { name: "Planning controls" });
  const slider = controls.getByRole("slider");
  const sliderBox = await slider.boundingBox();
  expect(sliderBox).not.toBeNull();
  const before = await controls.innerText();
  await page.mouse.move(sliderBox!.x + sliderBox!.width * 0.25, sliderBox!.y);
  await page.mouse.down();
  await page.mouse.move(sliderBox!.x + sliderBox!.width * 0.75, sliderBox!.y, {
    steps: 20,
  });
  expect(await controls.innerText()).toBe(before);
  await page.mouse.up();
  await expect(controls).not.toHaveText(before);
});
