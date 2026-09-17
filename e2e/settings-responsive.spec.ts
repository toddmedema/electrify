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

// Every control sits at the row's right edge: labels anchor left, controls anchor right. The row's
// control wrapper can be flush while the control inside it is stranded mid-row, so this measures
// the rendered controls themselves (buttons, toggle groups, switches) rather than their wrapper.
test("settings controls are flush with each row's right edge", async ({
  page,
}) => {
  await openSettings(page);

  // Turn sound on so the volume sliders render too
  await page.getByRole("switch", { name: "Sound" }).check();
  await expect(
    page.getByRole("slider", { name: "Music volume" }),
  ).toBeVisible();

  const offsets = await page.evaluate(() => {
    const out: { control: string; offset: number }[] = [];
    document.querySelectorAll<HTMLElement>(".settingsRow").forEach((row) => {
      const contentRight =
        row.getBoundingClientRect().right -
        parseFloat(getComputedStyle(row).paddingRight);
      const controls = row.lastElementChild!.querySelectorAll<HTMLElement>(
        "button, .MuiSwitch-root",
      );
      const controlRight = Math.max(
        ...Array.from(controls).map((el) => el.getBoundingClientRect().right),
      );
      out.push({
        control: `${row.querySelector("p")?.textContent} row`,
        offset: contentRight - controlRight,
      });
    });
    // A slider must span its grid cell, not a fraction of it
    document
      .querySelectorAll<HTMLElement>(".MuiSlider-root")
      .forEach((slider) => {
        const cell = getComputedStyle(slider.parentElement!)
          .gridTemplateColumns.split(" ")
          .map(parseFloat)[1];
        out.push({
          control: `${slider.querySelector("input")?.getAttribute("aria-label")} slider`,
          offset: cell - slider.getBoundingClientRect().width,
        });
      });
    return out;
  });

  // Five rows (Appearance, Sound, Units, Leaderboard, Saved game) plus two volume sliders; an empty
  // result would otherwise pass without checking anything
  expect(offsets).toHaveLength(7);
  for (const { control, offset } of offsets) {
    expect(Math.abs(offset), control).toBeLessThanOrEqual(2);
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
