import { expect, test } from "@playwright/test";

test("guided objective reaches a retryable capstone and succeeds", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Mission objective" }),
  ).toBeVisible();
  await expect(page.getByText("Your goal: keep the lights on")).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByText("Blue supply must stay above demand"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Your plants make electricity")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Tap 1× to start time")).toBeVisible();

  if (testInfo.project.name === "mobile-390px") {
    await expect(page.getByRole("button", { name: "Insights" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Events" })).toBeVisible();
  }

  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(page.getByText("Watch one full day go by")).toBeVisible();
  await expect(
    page.getByText("Your turn: keep the lights on for a full day"),
  ).toBeVisible();

  // Remove firm capacity so the first attempt demonstrates consequence feedback and retry.
  await page.locator(".facilityRow", { hasText: "Natural Gas" }).click();
  await page.getByRole("button", { name: "Pause Natural Gas" }).click();
  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByRole("heading", { name: "Capstone needs another try" }),
  ).toBeVisible();
  await expect(page.getByText("Demand outran available supply")).toBeVisible();

  await page.getByRole("button", { name: "Retry capstone" }).click();
  await expect(
    page.getByText("Your turn: keep the lights on for a full day"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause Natural Gas" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByText("Capstone complete - positive reserve kept demand covered"),
  ).toBeVisible();
});
