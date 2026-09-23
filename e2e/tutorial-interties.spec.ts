import path from "path";
import { expect, test } from "@playwright/test";

test("Mission 7 teaches limited two-way interties without trapping recovery", async ({
  page,
}, testInfo) => {
  test.skip(
    !new Set(["desktop-chromium", "mobile-390px", "mobile-320px"]).has(
      testInfo.project.name,
    ),
  );
  test.setTimeout(90000);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [0, 1, 2, 4, 3, 5].map((scenarioId) => ({
          scenarioId,
          timesPlayed: 1,
          date: "2026-09-08",
        })),
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
  await page.getByRole("button", { name: "Start Interties" }).click();

  await expect(
    page.getByRole("heading", { name: "Step 1 of 19" }),
  ).toBeVisible();
  await expect(page.locator(".button-buildFacility")).toBeVisible();
  if (testInfo.project.name.startsWith("mobile-")) {
    for (const selector of [".button-buildFacility"]) {
      const tabBox = await page.locator(selector).boundingBox();
      expect(tabBox?.height).toBeGreaterThanOrEqual(44);
    }
  }

  // Opening the tab completes navigation without a redundant Next click.
  await page.locator(".button-buildFacility").click();
  const intertiesTab = page.getByRole("tab", {
    name: "Interties",
    exact: true,
  });
  await expect(intertiesTab).toHaveClass(/tutorialTarget/);
  await expect(page.locator(".tutorialHud")).toContainText("Tap Interties");
  await intertiesTab.click();
  await expect(
    page.getByRole("heading", { name: "Step 3 of 19" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Review purchase of Pacific Northwest intertie",
    }),
  ).toBeVisible();
  await expect(page.getByText("Pay $36M now · finance $144M")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Review purchase of Pacific Northwest intertie",
    })
    .click();
  // The open dialog aria-hides the rest of the app, so role queries cannot see the HUD while
  // it is up; read the counter's spoken text directly instead.
  await expect(page.locator(".tutorialHudVisuallyHidden")).toHaveText(
    "4 of 19",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Take loan" })
    .click();
  await expect(page.getByText("Building", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Step 5 of 19" }),
  ).toBeVisible();
  // Playwright's mouse remains over the new snackbar after the approval layout changes.
  // MUI deliberately pauses auto-hide on hover; move away as a touch user would release.
  await page.mouse.move(0, 0);
  await expect(page.locator(".MuiSnackbar-root")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("intertie-approved.png") });

  await page.getByRole("button", { name: "fast speed" }).click();
  // A finished line reports the power actually moving over it, which is what replaced the
  // static "Connected" label.
  await expect(page.locator(".transmissionLineFlow")).toBeVisible({
    timeout: 20000,
  });
  // Construction alone is not enough: the objective advances only after this explicit pause.
  await expect(
    page.getByRole("heading", { name: "Step 6 of 19" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "pause", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Step 7 of 19" }),
  ).toBeVisible();

  await page.getByLabel("Trading rule").click();
  await page.getByRole("option", { name: "Buy for shortages only" }).click();
  await expect(
    page.getByRole("heading", { name: "Step 8 of 19" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Step 9 of 19" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Inspect Natural Gas" }).click();
  await expect(
    page.getByRole("button", { name: "Pause Natural Gas" }),
  ).toHaveClass(/tutorialTarget/);
  await page.getByRole("button", { name: "Pause Natural Gas" }).click();
  await expect(
    page.getByRole("heading", { name: "Step 11 of 19" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(page.getByText(/Importing /)).toBeVisible({
    timeout: 10000,
  });
  // Wait for a full importing month to settle into history; seeing live flow alone must not
  // satisfy the observation gate.
  await expect(page.locator(".gameStatus")).toContainText("Mar 2020", {
    timeout: 20000,
  });
  await page.getByRole("button", { name: "pause", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Step 13 of 19" }),
  ).toBeVisible();

  const exchange = page.locator('[data-layer="powerExchange"]');
  await expect(exchange).toBeVisible();
  await expect(exchange).toContainText("Power flowing");
  await expect(exchange).toContainText("Available capacity");
  await expect(exchange).toContainText("Neighbor price");
  if (testInfo.project.name.startsWith("mobile-")) {
    const viewport = await page.evaluate(() => ({
      height: window.innerHeight,
      width: window.innerWidth,
    }));
    // Visibility does not wait for the card transition and one-time target reveal.
    await expect
      .poll(async () => (await exchange.boundingBox())?.y ?? Infinity)
      .toBeLessThan(viewport.height - 56);
    const box = await exchange.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(viewport.height - 56);
    expect(
      await page
        .locator(".insights:visible")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  }

  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByText(/Hot, sunny weather can reduce how much the line carries/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  // The first capstone proves two-way trading before the guided stress exercise.
  await expect(
    page.getByRole("heading", { name: "Your turn 15 of 19" }),
  ).toBeVisible();

  const facilities = page.locator(".facilities:visible");
  await facilities.getByLabel("Trading rule").click();
  await page.getByRole("option", { name: "No trading" }).click();
  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(page.locator(".gameStatus")).toContainText("Apr 2020", {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "pause", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your turn 15 of 19" }),
  ).toBeVisible();

  await facilities.getByLabel("Trading rule").click();
  await page
    .getByRole("option", { name: "Buy for shortages, sell extra" })
    .click();
  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByRole("heading", { name: "Step 16 of 19" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".tutorialHud")).toContainText(
    "Your neighbor will have only 150 MW",
  );
  await expect(
    page.getByRole("heading", { name: "Mission complete!" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect shortage safely" }).click();
  await expect(
    page.getByRole("heading", { name: "Step 17 of 19" }),
  ).toBeVisible();
  await facilities
    .getByRole("button", { name: "Inspect Northern intertie" })
    .click();
  await expect(facilities.locator(".transmissionLineDetails")).toBeVisible();
  await expect(facilities.locator(".transmissionLineDetails")).toContainText(
    "neighbor spare supply",
  );
  // Inspection is safe even if the player tries to advance the clock before restoring backup.
  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  if (
    process.env.REVIEW_SCREENSHOT_DIR &&
    testInfo.project.name === "desktop-chromium"
  ) {
    await facilities.getByText(/^Limiting factor:/).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        "intertie-tutorial-stress.png",
      ),
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Step 18 of 19" }),
  ).toBeVisible();
  const gas = facilities.getByRole("button", { name: "Inspect Natural Gas" });
  if ((await gas.getAttribute("aria-expanded")) !== "true") await gas.click();
  await facilities.getByRole("button", { name: "Resume Natural Gas" }).click();
  await expect(
    page.getByRole("heading", { name: "Your turn 19 of 19" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByRole("heading", { name: "Mission complete!" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText(/kept demand supplied through a regional shortage/i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Next tutorial" })).toHaveCount(
    0,
  );
});
