import path from "path";
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

test("upcoming scenario events stay usable across insight viewports", async ({
  page,
}, testInfo) => {
  test.skip(
    !new Set(["desktop-chromium", "mobile-390px", "mobile-320px"]).has(
      testInfo.project.name,
    ),
  );
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem("insightsRange", "next5");
  });
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game" }).click();

  const insights = page.locator(".insights:visible");
  if (!(await insights.isVisible())) {
    await page.getByRole("button", { name: "Insights", exact: true }).click();
  }
  await expect(insights).toBeVisible();

  const eventRail = insights.getByRole("region", {
    name: "Upcoming scenario events",
  });
  await expect(eventRail).toContainText("Upcoming");
  await expect(eventRail).not.toContainText("Higher pollution fee begins");
  const eventButton = eventRail.getByRole("button", {
    name: /Higher pollution fee begins/,
  });
  await expect(eventButton).toBeVisible();
  await expect(eventButton).toHaveAttribute("aria-expanded", "false");
  await eventButton.click();
  await expect(eventButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog")).toContainText(
    "Polluting plants now pay",
  );
  await eventButton.click();
  await expect(eventButton).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await eventButton.click();

  const charts = insights.locator(".accessibleChart [role=img]");
  const fullMin = Number(
    await charts.first().getAttribute("data-viewport-min"),
  );
  const fullMax = Number(
    await charts.first().getAttribute("data-viewport-max"),
  );
  await page.getByRole("button", { name: "Zoom to event" }).click();
  await expect
    .poll(async () => {
      const min = Number(
        await charts.first().getAttribute("data-viewport-min"),
      );
      const max = Number(
        await charts.first().getAttribute("data-viewport-max"),
      );
      return max - min;
    })
    .toBeLessThan(fullMax - fullMin);
  const zoomedMin = Number(
    await charts.first().getAttribute("data-viewport-min"),
  );
  const zoomedMax = Number(
    await charts.first().getAttribute("data-viewport-max"),
  );
  expect(zoomedMax - zoomedMin).toBeLessThan(fullMax - fullMin);
  const chartRanges = await charts.evaluateAll((elements) =>
    elements.map((element) => [
      element.getAttribute("data-viewport-min"),
      element.getAttribute("data-viewport-max"),
    ]),
  );
  expect(new Set(chartRanges.map((range) => range.join(":"))).size).toBe(1);

  const viewportToolbar = insights.getByRole("region", {
    name: "Chart time navigation",
  });
  await expect(viewportToolbar).toContainText(/20\d{2}/);
  const horizon = viewportToolbar.getByRole("combobox", {
    name: "Time horizon",
  });
  await expect(insights.locator(".insightsHeader .insightsRange")).toHaveCount(
    0,
  );
  const viewportButtons = viewportToolbar.getByRole("button");
  const viewportControls = [horizon, ...(await viewportButtons.all())];
  const viewportControlBoxes = await Promise.all(
    viewportControls.map((control) => control.boundingBox()),
  );
  expect(viewportControlBoxes.every(Boolean)).toBe(true);
  const viewportControlCenters = viewportControlBoxes.map(
    (box) => box!.y + box!.height / 2,
  );
  expect(
    Math.max(...viewportControlCenters) - Math.min(...viewportControlCenters),
  ).toBeLessThanOrEqual(1);
  const toolbarBox = await viewportToolbar.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(toolbarBox!.height).toBeLessThanOrEqual(53);
  const toolbarOverflow = await viewportToolbar.evaluate((element) =>
    Math.max(0, element.scrollWidth - element.clientWidth),
  );
  expect(toolbarOverflow).toBeLessThanOrEqual(1);
  const viewportButtonBoxes = viewportControlBoxes.slice(1);
  expect(
    viewportButtonBoxes.every((box) =>
      testInfo.project.name.startsWith("mobile-")
        ? box!.height >= 44
        : box!.height >= 40,
    ),
  ).toBe(true);
  if (testInfo.project.name.startsWith("mobile-")) {
    expect(viewportControlBoxes[0]!.width).toBeCloseTo(80, 0);
    viewportButtonBoxes.forEach((box) => expect(box!.width).toBeCloseTo(44, 0));
  } else {
    const longHorizonLabel = horizon.locator(".insightsHorizonLong");
    await expect(longHorizonLabel).toContainText("Next 5 years");
    expect(
      await longHorizonLabel.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  }

  const pageOverflow = await insights.evaluate((element) =>
    Math.max(0, element.scrollWidth - element.clientWidth),
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
  if (testInfo.project.name.startsWith("mobile-")) {
    const eventBox = await eventButton.boundingBox();
    expect(eventBox).not.toBeNull();
    expect(eventBox!.height).toBeGreaterThanOrEqual(44);
    await expect(eventRail.locator(".insightEventList")).toHaveCSS(
      "overflow-x",
      "auto",
    );
    const railBox = await eventRail.boundingBox();
    expect(railBox).not.toBeNull();
    expect(railBox!.height).toBeLessThanOrEqual(52);
  }

  const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
  if (reviewDir) {
    await eventButton.click();
    await viewportToolbar.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(
        reviewDir,
        `upcoming-events-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  }
});

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
    page.locator(".insightsPreset"),
    page.getByRole("button", { name: "Preset actions" }),
    page.getByRole("button", { name: /^Layers \(/ }),
  ];
  if (!testInfo.project.name.startsWith("mobile-")) {
    controls.splice(1, 0, page.getByRole("button", { name: "Save" }));
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
    await expect(levers).toHaveCSS("row-gap", "0px");
    const rateToggle = levers.locator(".insightsRateToggle");
    const rateMetrics = levers.locator(".insightsRateMetrics");
    await expect(rateToggle).not.toBeVisible();
    const [leversBox, metricsBox, rateSlider, trackTitle] = await Promise.all([
      levers.boundingBox(),
      rateMetrics.boundingBox(),
      levers.locator(".budgetSlider").boundingBox(),
      page
        .locator('.insightsTrack[data-layer="supplyDemand"] h6')
        .boundingBox(),
    ]);
    expect(leversBox).not.toBeNull();
    expect(metricsBox).not.toBeNull();
    expect(rateSlider).not.toBeNull();
    expect(trackTitle).not.toBeNull();
    expect(leversBox!.height).toBeLessThanOrEqual(110);
    expect(metricsBox!.height).toBeGreaterThanOrEqual(44);
    expect(metricsBox!.x - leversBox!.x).toBeCloseTo(12, 1);
    expect(
      await levers.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    expect(
      await rateMetrics.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await expect(rateMetrics).toContainText(/RATE/i);
    await expect(rateMetrics).toContainText(/MARKET/i);
    await expect(rateMetrics).toContainText(/CUSTOMERS \/ MO/i);
    await expect(rateMetrics).toContainText(/\+.*\(\+.*%\)/);
    const visibleRateMarks = levers.locator(".insightsRateMarkMobile:visible");
    await expect(visibleRateMarks).toHaveCount(3);
    await expect(visibleRateMarks.nth(1)).toContainText(/market/i);
    const markBoxes = await Promise.all(
      (await visibleRateMarks.all()).map((mark) => mark.boundingBox()),
    );
    expect(markBoxes.every(Boolean)).toBe(true);
    const marksBottom = Math.max(
      ...markBoxes.map((box) => box!.y + box!.height),
    );
    expect(
      leversBox!.y + leversBox!.height - marksBottom,
    ).toBeGreaterThanOrEqual(4);

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

  const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
  if (reviewDir) {
    await page.screenshot({
      path: path.join(
        reviewDir,
        `compact-rate-controls-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  }

  const presetName = page.locator(".insightsPresetName");
  await expect(presetName).toHaveCSS("text-overflow", "ellipsis");
  if (testInfo.project.name === "mobile-320px") {
    await expect(page.getByRole("button", { name: "Save" })).not.toBeVisible();
    const horizon = page.getByRole("combobox", { name: "Time horizon" });
    await expect(horizon.locator(".insightsHorizonCompact")).toHaveText("1y");
    await horizon.click();
    await page.getByRole("option", { name: "Next 5 years" }).click();
    await expect(horizon.locator(".insightsHorizonCompact")).toHaveText("5y");
    await expect(
      page.getByRole("button", { name: "Fit 5-year horizon" }),
    ).toBeDisabled();
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
