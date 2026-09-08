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

  await expect(page.getByLabel("Objective 1 of 10")).toBeVisible();
  await expect(page.locator("#intertiesTab")).toBeVisible();

  // The explicit copy plus automatic recovery means an eager Next cannot strand the build gate.
  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByRole("button", { name: "Approve Pacific Northwest intertie" }),
  ).toBeVisible();
  await expect(page.getByText("Pay $36M now · finance $144M")).toBeVisible();
  await page
    .getByRole("button", { name: "Approve Pacific Northwest intertie" })
    .click();
  await expect(page.getByText("Building")).toBeVisible();
  await expect(page.getByLabel("Objective 3 of 10")).toBeVisible();

  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(page.getByText(/Trading ·/)).toBeVisible({ timeout: 20000 });
  // Construction alone is not enough: the objective advances only after this explicit pause.
  await expect(page.getByLabel("Objective 3 of 10")).toBeVisible();
  await page.getByRole("button", { name: "pause" }).click();
  await expect(page.getByLabel("Objective 4 of 10")).toBeVisible();

  await page.getByLabel("Trading rule").click();
  await page.getByRole("option", { name: "Buy for shortages only" }).click();
  await expect(page.getByLabel("Objective 5 of 10")).toBeVisible();
  await page.locator("#plantsTab").click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Pause Natural Gas" }).click();
  await expect(page.getByLabel("Objective 7 of 10")).toBeVisible();

  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(page.getByText(/Trading · Importing/)).toBeVisible({
    timeout: 10000,
  });
  // Wait for a full importing month to settle into history; seeing live flow alone must not
  // satisfy the observation gate.
  await expect(page.locator(".gameStatus")).toContainText("Mar 2020", {
    timeout: 20000,
  });
  await page.getByRole("button", { name: "pause" }).click();
  await expect(page.getByLabel("Objective 8 of 10")).toBeVisible();

  const exchange = page.locator('[data-layer="powerExchange"]');
  await expect(exchange).toBeVisible();
  await expect(exchange).toContainText("Power flowing");
  await expect(exchange).toContainText("Available capacity");
  await expect(exchange).toContainText("Neighbor price");
  if (testInfo.project.name.startsWith("mobile-")) {
    const [box, viewport] = await Promise.all([
      exchange.boundingBox(),
      page.evaluate(() => ({
        height: window.innerHeight,
        width: window.innerWidth,
      })),
    ]);
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(viewport.height - 56);
    expect(
      await page
        .locator(".insights:visible")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    for (const selector of ["#plantsTab", "#intertiesTab"]) {
      const tabBox = await page.locator(selector).boundingBox();
      expect(tabBox?.height).toBeGreaterThanOrEqual(44);
    }
  }

  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByText(/Hot, sunny weather warms the line/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByLabel("Objective 10 of 10")).toBeVisible();

  const facilities = page.locator(".facilities:visible");
  await facilities.getByRole("tab", { name: "Interties" }).click();
  await facilities.getByLabel("Trading rule").click();
  await page.getByRole("option", { name: "No trading" }).click();
  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(page.locator(".gameStatus")).toContainText("Apr 2020", {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "pause" }).click();
  await expect(page.getByLabel("Objective 10 of 10")).toBeVisible();

  await facilities.getByLabel("Trading rule").click();
  await page
    .getByRole("option", { name: "Buy for shortages, sell extra" })
    .click();
  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByRole("heading", { name: "Mission complete!" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByText(/borrowed power at night and shared extra solar by day/i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Next tutorial" })).toHaveCount(
    0,
  );
});
