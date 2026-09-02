import { expect, test } from "@playwright/test";

const REVIEW_VIEWPORTS = new Set([
  "mobile-320px",
  "tablet-768px",
  "desktop-chromium",
]);

test("insights header controls stay aligned in one compact row", async ({
  page,
}, testInfo) => {
  test.skip(!REVIEW_VIEWPORTS.has(testInfo.project.name));
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "insightsPresetLibrary",
      JSON.stringify({
        defaults: {},
        custom: [
          {
            id: "responsive",
            name: "Very long preset name for narrow screens",
            layers: [
              "supplyDemand",
              "cash",
              "profit",
              "customers",
              "emissions",
            ],
          },
        ],
      }),
    );
    window.localStorage.setItem("insightsActivePreset", "saved:responsive");
    window.localStorage.setItem(
      "insightsLayers",
      JSON.stringify([
        "supplyDemand",
        "cash",
        "profit",
        "customers",
        "emissions",
      ]),
    );
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();

  const insights = page.locator(".insights");
  if (!(await insights.isVisible())) {
    await page.getByRole("button", { name: "Insights", exact: true }).click();
  }
  await expect(insights).toBeVisible();

  const controls = [
    page.locator(".insightsRange"),
    page.locator(".insightsPreset"),
    page.getByRole("button", { name: "Save" }),
    page.getByRole("button", { name: "Preset actions" }),
    page.getByRole("button", { name: /^Layers \(/ }),
  ];
  const boxes = await Promise.all(
    controls.map((control) => control.boundingBox()),
  );
  expect(boxes.every(Boolean)).toBe(true);
  expect(boxes.map((box) => box!.height)).toEqual([36, 36, 36, 36, 36]);
  expect(new Set(boxes.map((box) => box!.y)).size).toBe(1);

  const headerOverflow = await page
    .locator(".insightsHeader")
    .evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    );
  expect(headerOverflow).toBeLessThanOrEqual(1);

  const presetName = page.locator(".insightsPresetName");
  await expect(presetName).toHaveCSS("text-overflow", "ellipsis");
  if (testInfo.project.name === "mobile-320px") {
    expect(
      await presetName.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
  }
});

test("main-menu account actions follow the sound action", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320px");
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");

  const sound = page.getByRole("button", { name: "Turn on sound" });
  const account = page.getByRole("region", { name: "Account actions" });
  const [soundBox, accountBox] = await Promise.all([
    sound.boundingBox(),
    account.boundingBox(),
  ]);
  expect(soundBox).not.toBeNull();
  expect(accountBox).not.toBeNull();
  expect(accountBox!.y).toBeGreaterThanOrEqual(soundBox!.y + soundBox!.height);
});
