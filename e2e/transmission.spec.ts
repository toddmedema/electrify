import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

test("California players can build and understand an intertie", async ({
  page,
}, testInfo) => {
  test.skip(
    !new Set(["desktop-chromium", "mobile-390px", "mobile-320px"]).has(
      testInfo.project.name,
    ),
  );
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game" }).click();

  await expect(page.getByRole("group", { name: "game speed" })).toBeVisible();
  const facilities = page.locator(".facilities:visible");
  await openPane(
    facilities,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  await facilities.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("tab", { name: "Interties", exact: true }).click();
  const projects = page.getByRole("tabpanel", { name: "Interties" });
  await expect(
    projects.getByRole("heading", { name: "Share power with nearby grids" }),
  ).toHaveCount(0);
  await expect(
    projects.getByRole("heading", { name: "Connection projects" }),
  ).toHaveCount(0);
  await expect(
    projects.getByRole("heading", { name: "Pacific Northwest", exact: true }),
  ).toBeVisible();
  await expect(projects.getByLabel("Trading rule")).toHaveCount(0);
  await expect(projects.getByText("Total cost").first()).toBeVisible();
  const northernProject = projects.getByTestId(
    "transmission-project-california-north",
  );
  await northernProject
    .getByRole("button", { name: "Show Pacific Northwest details" })
    .click();
  await expect(
    northernProject.getByText("Down payment", { exact: true }),
  ).toBeVisible();
  await expect(
    northernProject.getByText("$10.8M", { exact: true }),
  ).toBeVisible();
  await expect(
    northernProject.getByText("$43.2M", { exact: true }),
  ).toBeVisible();
  if (testInfo.project.name === "mobile-320px") {
    const firstBuild = projects
      .getByRole("button", {
        name: "Review purchase of Pacific Northwest intertie",
      })
      .first();
    const box = await firstBuild.boundingBox();
    expect(box).not.toBeNull();
    await firstBuild.scrollIntoViewIfNeeded();
    await expect(firstBuild).toBeInViewport();
  }

  await projects
    .getByRole("button", {
      name: "Review purchase of Pacific Northwest intertie",
    })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Take loan" })
    .click();
  await expect(
    page.getByText("Intertie approved — power can flow in 1 year."),
  ).toBeVisible();
  await expect(
    facilities.locator("#your-interties-title", { hasText: "Interties" }),
  ).toBeVisible();
  await expect(facilities.getByText("Building")).toBeVisible();
  await expect(facilities.locator(".tradingControls")).toHaveCount(1);
  const line = facilities.locator(".transmissionLine").first();
  const [rowBox, chevronBox] = await Promise.all([
    line.locator(".facilityDisclosure").boundingBox(),
    line.locator(".facilityChevron").boundingBox(),
  ]);
  expect(
    Math.abs(
      rowBox!.y + rowBox!.height / 2 - (chevronBox!.y + chevronBox!.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
  await expect(facilities.getByLabel("Trading rule")).toContainText(
    "Buy for shortages, sell extra",
  );
  await expect(
    facilities.getByText("Northern intertie", { exact: true }),
  ).toHaveCount(1);
  expect(
    await facilities.evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    ),
  ).toBeLessThanOrEqual(1);
});

test("island grids do not offer interties or power exchange", async ({
  page,
}, testInfo) => {
  test.skip(
    !new Set(["desktop-chromium", "mobile-390px", "mobile-320px"]).has(
      testInfo.project.name,
    ),
  );
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/?scenario=105");
  await page.getByRole("button", { name: "Start game" }).click();

  await expect(page.getByRole("group", { name: "game speed" })).toBeVisible();
  const facilities = page.locator(".facilities:visible");
  await openPane(
    facilities,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  await expect(facilities.getByRole("tab", { name: "Interties" })).toHaveCount(
    0,
  );

  const insights = page.locator(".insights:visible");
  await openPane(
    insights,
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  await insights.getByRole("button", { name: /Layers \(/ }).click();
  await expect(
    insights.getByRole("checkbox", { name: "Power exchange" }),
  ).toHaveCount(0);
  await expect(
    insights.getByRole("heading", { name: "Power exchange" }),
  ).toHaveCount(0);
});

test("unified facility rows support keyboard inspection and dispatch reordering", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const facilities = page.locator(".facilities:visible");
  const rows = facilities.locator(".facilityRow");
  await expect(rows).toHaveCount(2);
  const originalFirstId = await rows
    .first()
    .getAttribute("data-rfd-draggable-id");
  await expect(rows.first().locator(".facilityDisclosure")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await facilities.getByRole("button", { name: "Build", exact: true }).focus();
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Tab");
    if (
      await rows
        .first()
        .locator(".facilityDisclosure")
        .evaluate((row) => row === document.activeElement)
    )
      break;
  }
  await expect(rows.first().locator(".facilityDisclosure")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rows.first().locator(".facilityDisclosure")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(rows.first().locator(".facilityDisclosure")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.keyboard.press("Enter");
  await rows.first().locator(".facilityDragHandle").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(rows.last()).toHaveAttribute(
    "data-rfd-draggable-id",
    originalFirstId!,
  );
  await expect(rows.last().locator(".facilityDragHandle")).toBeFocused();
  // Reordering generators does not create an owned intertie section.
  await expect(facilities.locator(".transmissionFleet")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`intertie review stays at the top right in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.getByRole("group", { name: "game speed" })).toBeVisible();
    const facilities = page.locator(".facilities:visible");
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await facilities
      .getByRole("button", { name: "Build", exact: true })
      .click();
    await page.getByRole("tab", { name: "Interties", exact: true }).click();
    // Corridor cards are build cards now, so the heading and Review button come from
    // MUI's CardHeader exactly as they do on the generator and storage cards.
    for (const card of await page.locator(".transmissionProject").all()) {
      const heading = card.locator(".MuiCardHeader-root");
      const review = heading.getByRole("button", {
        name: /Review purchase of/,
      });
      await expect(review.locator("svg")).toBeVisible();
      // h6, matching the dialog's own "Build..." title: a card list is what heading
      // navigation is for, and h3 under an h6 was a backwards jump.
      const title = heading.getByRole("heading", { level: 6 });
      const titleBox = (await title.boundingBox())!;
      const buttonBox = (await review.boundingBox())!;
      const headerBox = (await heading.boundingBox())!;
      const contextBox = (await card
        .locator(".buildOptionContext")
        .first()
        .boundingBox())!;
      expect(buttonBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
      expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(contextBox.y);
      expect(buttonBox.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
      expect(
        await card.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await expect(card.locator(".buildOptionContext").first()).toContainText(
        /corridor/,
      );
      // The metric grid carries the decision; the archetype and outlook wait behind details
      await expect(
        card.getByText("Connection bandwidth", { exact: true }),
      ).toBeVisible();
      await expect(card.getByText("Emissions", { exact: true })).toBeVisible();
      await expect(
        card.getByRole("img", { name: /^Typical year of import room/ }),
      ).toHaveCount(0);
      await card.getByRole("button", { name: /^Show .* details$/ }).click();
      await expect(
        card.getByRole("img", { name: /^Typical year of import room/ }),
      ).toBeVisible();
    }
  });
}
