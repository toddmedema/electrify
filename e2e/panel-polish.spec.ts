import { expect, test } from "./fixtures";
import { openPane } from "./layout";

test("facility actions stay reachable while navigating game panels", async ({
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
  await expect(actions.getByRole("button", { name: /^Pause / })).toBeVisible();
  for (const label of await actions.locator(".facilityActionLabel").all()) {
    await expect(label).toBeVisible();
  }
  const minimum = testInfo.project.use.hasTouch ? 44 : 40;
  const buttons = await actions.locator("button").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        width: rect.width,
        name: element.getAttribute("aria-label"),
      };
    }),
  );
  expect(buttons.length).toBeGreaterThan(0);
  expect(
    buttons.every(
      (button) =>
        button.name && button.height >= minimum && button.width >= minimum,
    ),
  ).toBe(true);
  const insights = page.locator(".insights:visible");
  await openPane(
    insights,
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  await expect(
    insights.locator("#chartForecastSupplyDemand canvas"),
  ).toBeVisible();
  await openPane(
    page.locator(".eventLog:visible"),
    page.getByRole("button", { name: "Events", exact: true }),
  );
  await expect(
    page.getByRole("button", { name: "Filter event history, All events" }),
  ).toBeVisible();
  await openPane(
    insights,
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  await expect(
    insights.locator("#chartForecastSupplyDemand canvas"),
  ).toBeVisible();
});
