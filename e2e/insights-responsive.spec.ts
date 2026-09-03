import { expect, test, type Page } from "@playwright/test";

const REVIEW_VIEWPORTS = new Set([
  "mobile-320px",
  "mobile-390px",
  "tablet-768px",
  "desktop-chromium",
]);

const dismissTutorial = async (page: Page) => {
  const exit = page.getByRole("button", { name: "Exit", exact: true });
  await expect(exit).toBeVisible();
  await exit.click();
  await expect(exit).not.toBeVisible();
};

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
  await dismissTutorial(page);

  const insights = page.locator(".insights");
  if (!(await insights.isVisible())) {
    await page.getByRole("button", { name: "Insights", exact: true }).click();
  }
  await expect(insights).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const controls = [
    page.locator(".insightsRange"),
    page.locator(".insightsPreset"),
    page.getByRole("button", { name: "Preset actions" }),
    page.getByRole("button", { name: /^Layers \(/ }),
  ];
  if (!testInfo.project.name.startsWith("mobile-")) {
    controls.splice(2, 0, page.getByRole("button", { name: "Save" }));
  }
  const boxes = await Promise.all(
    controls.map((control) => control.boundingBox()),
  );
  expect(boxes.every(Boolean)).toBe(true);
  expect(boxes.every((box) => box!.height >= 36)).toBe(true);
  expect(new Set(boxes.map((box) => box!.y)).size).toBe(1);

  const headerOverflow = await page
    .locator(".insightsHeader")
    .evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    );
  expect(headerOverflow).toBeLessThanOrEqual(1);

  if (testInfo.project.name.startsWith("mobile-")) {
    const header = await page.locator(".insightsHeader").boundingBox();
    expect(header).not.toBeNull();
    expect(header!.height).toBeGreaterThanOrEqual(52);
    expect(header!.height).toBeLessThanOrEqual(54);

    const levers = page.locator(".insightsLevers");
    await expect(levers).toHaveCSS("display", "grid");
    await expect(levers).toHaveCSS("row-gap", "4px");
    const [rateButton, rateSummary, rateSlider, trackTitle] = await Promise.all(
      [
        levers.getByRole("button", { name: "Rate controls" }).boundingBox(),
        levers.locator(":scope > .MuiTypography-root").boundingBox(),
        levers.locator(".budgetSlider").boundingBox(),
        page
          .locator('.insightsTrack[data-layer="supplyDemand"] h6')
          .boundingBox(),
      ],
    );
    expect(rateButton).not.toBeNull();
    expect(rateSummary).not.toBeNull();
    expect(rateSlider).not.toBeNull();
    expect(trackTitle).not.toBeNull();
    expect(rateSummary!.y - (rateButton!.y + rateButton!.height)).toBeCloseTo(
      4,
      1,
    );
    expect(rateSlider!.y - (rateSummary!.y + rateSummary!.height)).toBeCloseTo(
      4,
      1,
    );
    expect(rateSummary!.x).toBeCloseTo(trackTitle!.x, 1);
    expect(rateSlider!.x).toBeCloseTo(trackTitle!.x, 1);
    expect(rateSlider!.x + rateSlider!.width).toBeLessThanOrEqual(
      (page.viewportSize()?.width || 0) - trackTitle!.x + 0.5,
    );

    if (testInfo.project.name === "mobile-320px") {
      const trackHeader = page.locator(
        '.insightsTrack[data-layer="supplyDemand"] .insightsTrackHeader',
      );
      const [trackHeaderBox, trackActions] = await Promise.all([
        trackHeader.boundingBox(),
        trackHeader.locator(".insightsTrackActions").boundingBox(),
      ]);
      expect(trackHeaderBox).not.toBeNull();
      expect(trackActions).not.toBeNull();
      expect(trackHeaderBox!.height).toBeLessThanOrEqual(45);
      expect(trackTitle!.x + trackTitle!.width).toBeLessThanOrEqual(
        trackActions!.x + 0.5,
      );
    }
  }

  const presetName = page.locator(".insightsPresetName");
  await expect(presetName).toHaveCSS("text-overflow", "ellipsis");
  if (testInfo.project.name === "mobile-320px") {
    await expect(page.getByRole("button", { name: "Save" })).not.toBeVisible();
    await expect(page.locator(".insightsRange")).toContainText(
      "Next 12 months",
    );
    await page.getByRole("button", { name: "Preset actions" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Save preset changes" }),
    ).toBeVisible();
    expect(
      await presetName.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
  }
});

test("compact facility build buttons stay above the chart", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile-"));
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await dismissTutorial(page);

  const facilities = page.locator(".facilities");
  if (!(await facilities.isVisible())) {
    await page.getByRole("button", { name: "Facilities", exact: true }).click();
  }
  const buildButtons = [
    facilities.getByRole("button", { name: "Generator" }),
    facilities.getByRole("button", { name: "Storage" }),
  ];
  const chart = facilities.locator("#chartSupplyDemand");
  await expect(chart).toBeVisible();
  const chartBox = await chart.boundingBox();
  const buttonBoxes = await Promise.all(
    buildButtons.map((button) => button.boundingBox()),
  );
  expect(chartBox).not.toBeNull();
  expect(buttonBoxes.every(Boolean)).toBe(true);
  buttonBoxes.forEach((box) => {
    expect(box!.height).toBeLessThanOrEqual(32);
    expect(box!.y + box!.height).toBeLessThanOrEqual(chartBox!.y + 0.5);
  });
  expect(
    (await facilities.locator(".paneHeader").boundingBox())!.height,
  ).toBeLessThanOrEqual(41); // 40px content plus the divider
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
