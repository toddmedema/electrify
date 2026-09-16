import { expect, test } from "@playwright/test";

async function openSettings(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test("settings use a centered readable measure on desktop", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440px");
  await openSettings(page);

  const preferences = page.getByRole("region", { name: "Preferences" });
  await expect
    .poll(async () => {
      const bounds = await preferences.boundingBox();
      if (!bounds) return Number.POSITIVE_INFINITY;
      return Math.abs(bounds.x + bounds.width / 2 - 1440 / 2);
    })
    .toBeLessThanOrEqual(1);

  const bounds = await preferences.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeLessThanOrEqual(760);
});

// Every control sits at the row's right edge: labels anchor left, controls anchor right. A
// regression that strands a control mid-row (the old 50%-wide slider, the left-aligned toggle
// groups) shows up as a gap between the control's right edge and the row's content edge.
test("settings controls are flush with each row's right edge on desktop", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440px");
  await openSettings(page);

  // Enable sound so the volume sliders render too
  const sound = page.getByRole("switch", { name: "Sound" });
  if (
    (await sound.evaluate((el) => {
      const input = el.matches("input") ? el : el.querySelector("input");
      return input ? input.checked : null;
    })) !== true
  ) {
    await sound.click();
  }
  await expect(
    page.getByRole("slider", { name: "Music volume" }),
  ).toBeVisible();

  const gaps = await page.evaluate(() => {
    const out: number[] = [];
    document.querySelectorAll(".settingsRow").forEach((row) => {
      const rowRect = (row as HTMLElement).getBoundingClientRect();
      // The row's own 16px padding (px: 2) is the content edge
      const rowContentRight = rowRect.right - 16;
      const children = (row as HTMLElement).children;
      const controlRect =
        children[children.length - 1].getBoundingClientRect();
      out.push(rowContentRight - controlRect.right);
    });
    // The volume sliders must span their grid cell, not half of it
    document.querySelectorAll(".MuiSlider-root").forEach((slider) => {
      const grid = (slider as HTMLElement).parentElement as HTMLElement;
      const columns = getComputedStyle(grid).gridTemplateColumns
        .split(" ")
        .map(parseFloat);
      out.push(
        Math.abs(slider.getBoundingClientRect().width - columns[1]),
      );
    });
    return out;
  });

  for (const gap of gaps) {
    expect(gap).toBeLessThanOrEqual(2);
  }
});

test("settings remain direct and overflow-free on a common phone", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390px");
  await openSettings(page);

  await expect(page.getByRole("group", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Units" })).toBeVisible();
  await page.getByRole("switch", { name: "Sound" }).click();
  await expect(
    page.getByRole("slider", { name: "Music volume" }),
  ).toBeVisible();

  const overflow = await page
    .locator(".scrollable")
    .evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    );
  expect(overflow).toBeLessThanOrEqual(1);
});
