import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

test("responsive controls and panel navigation keep their geometry", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.emulateMedia({
    colorScheme: testInfo.project.name.startsWith("mobile") ? "dark" : "light",
  });
  await page.goto("/?scenario=108");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const facilities = page.locator(".facilities:visible");
  await openPane(
    facilities,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  await facilities.locator(".facilityDisclosure").first().click();
  const actions = facilities.locator(".facilityActions").first();
  await expect(actions).toBeVisible();
  for (const label of await actions.locator(".facilityActionLabel").all()) {
    await expect(label).toBeVisible();
  }
  if (page.viewportSize()!.width <= 600) {
    const buttons = await actions.locator("button").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          y: rect.y,
          height: rect.height,
          width: rect.width,
          name: element.getAttribute("aria-label"),
        };
      }),
    );
    expect(new Set(buttons.map((button) => button.y)).size).toBe(2);
    expect(
      new Set(buttons.map((button) => Math.round(button.width))).size,
    ).toBe(1);
    expect(
      buttons.every(
        (button) => button.name && button.height >= 44 && button.width >= 44,
      ),
    ).toBe(true);
    if (process.env.PR_SCREENSHOTS && page.viewportSize()!.width === 390) {
      await page.screenshot({
        path: testInfo.outputPath("mobile-controls.png"),
      });
    }
  }
  const insights = page.locator(".insights:visible");
  await openPane(
    insights,
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  await expect(
    page.getByText("Reserve: extra demand you could cover within 15 min."),
  ).toHaveCount(0);
  await expect(
    insights.locator("#chartForecastSupplyDemand canvas"),
  ).toBeVisible();
  if (await page.locator(".desktop-panes").count()) {
    const health = page.locator(".gridHealth");
    await expect(health).toHaveCSS("justify-content", "flex-start");
    await expect(health).toHaveCSS("text-align", "left");
  }
  if (await page.locator(".secondary-pane").count()) {
    const nav = page.locator("#navfooter");
    const before = (await nav.boundingBox())!;
    const pane = (await insights.boundingBox())!;
    expect(before.x).toBeCloseTo(pane.x, 0);
    expect(before.width).toBeCloseTo(pane.width, 0);
    expect(before.y).toBeCloseTo(pane.y + pane.height, 0);
    expect(before.height).toBeGreaterThanOrEqual(56);
    await nav.getByRole("button", { name: "Events" }).click();
    await expect(page.locator(".eventLog:visible")).toBeVisible();
    expect((await nav.boundingBox())!.height).toBe(before.height);
    await nav.getByRole("button", { name: "Insights" }).click();
    await expect(insights).toBeVisible();
    expect((await nav.boundingBox())!.height).toBe(before.height);
  }
  if (process.env.PR_SCREENSHOTS && page.viewportSize()!.width >= 1280) {
    await page.screenshot({ path: testInfo.outputPath("panels.png") });
  }
});
