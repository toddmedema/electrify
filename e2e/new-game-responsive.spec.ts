import { expect, test } from "@playwright/test";

const REVIEW_VIEWPORTS = new Set([
  "desktop-chromium",
  "mobile-390px",
  "mobile-320px",
]);

test("challenge details have a shareable URL and return to the catalog", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [0, 1, 2, 3, 4, 5, 100, 103].map((scenarioId) => ({
          scenarioId,
          date: new Date().toString(),
        })),
      }),
    );
  });

  await page.goto("/?scenario=111");
  await expect(
    page.getByRole("heading", { name: "Wildfire Emergency" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\?scenario=111$/);

  await page.getByRole("button", { name: "back" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a game" }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/scenario=/);

  await page.getByRole("button", { name: "All challenges" }).click();
  await page
    .getByRole("button", { name: "View Wildfire Emergency details" })
    .click();
  await expect(page).toHaveURL(/\?scenario=111$/);

  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Choose a game" }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Wildfire Emergency" }),
  ).toBeVisible();
});

test("game picker prioritizes one lesson and filters the challenge catalog", async ({
  page,
}, testInfo) => {
  test.skip(!REVIEW_VIEWPORTS.has(testInfo.project.name));
  await page.addInitScript(() => {
    window.localStorage.clear();
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

  await expect(
    page.getByRole("heading", { name: "Choose a game" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start Generators" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("challenge-list").getByRole("button"),
  ).toHaveCount(3);
  await expect(page.getByRole("button", { name: "For you" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "View Solar Eclipse details" }),
  ).toHaveCount(0);

  const pageOverflow = await page
    .locator(".missionList")
    .evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    );
  expect(pageOverflow).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Extreme weather" }).click();
  await expect(
    page.getByRole("button", { name: "View Heatwave + Drought details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Wildfire Emergency details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Deep Freeze details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Hurricane Season details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Data Center Boom details" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Deep Freeze themes")).toHaveCount(0);

  await page.getByRole("button", { name: "All challenges" }).click();
  await expect(page.getByLabel("Deep Freeze themes")).toContainText(
    "Extreme weather",
  );

  const sortButton = page.getByRole("button", { name: "Newest first" });
  await expect(sortButton).toBeVisible();
  await sortButton.click();
  await page.getByRole("menuitem", { name: "Shortest first" }).click();
  await expect(
    page.getByRole("button", { name: "Shortest first" }),
  ).toBeVisible();
});
