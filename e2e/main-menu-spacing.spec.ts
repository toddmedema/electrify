import { expect, test, Locator } from "./fixtures";
import { readSavedGame } from "./save-fixture";

async function expectGap(above: Locator, below: Locator, gap: number) {
  const first = await above.boundingBox();
  const second = await below.boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.y - first!.y - first!.height).toBeCloseTo(gap, 0);
}

for (const theme of ["light", "dark"]) {
  test(`home action spacing follows the same rhythm in ${theme} mode`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto("/");
    const primary = page.getByRole("region", { name: "Primary actions" });
    const resources = page.getByRole("navigation", { name: "Game resources" });
    const discovery = page.locator(".discoveryActions");
    await expect(primary).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toHaveCount(0);
    await expect(page.getByText(/free.*no sign.?in required/i)).toHaveCount(0);
    await expect(
      primary.getByRole("button", { name: "Saved games", exact: true }),
    ).toHaveCount(0);
    // The logo carries the one tagline; nothing repeats it above the actions
    await expect(page.locator(".gameSubtitle")).toHaveCount(0);
    await expectGap(primary, resources, 8);
    await expectGap(resources, discovery, 8);
    const actions = page.locator("#centeredMenu button");
    for (let index = 1; index < (await actions.count()); index += 1) {
      await expectGap(actions.nth(index - 1), actions.nth(index), 8);
    }

    // Exercise the optional install action alongside the sound prompt.
    await page.evaluate(() => {
      window.dispatchEvent(
        new Event("beforeinstallprompt", { cancelable: true }),
      );
    });
    await expect(
      page.getByRole("button", { name: "Install app" }),
    ).toBeVisible();
    for (let index = 1; index < (await actions.count()); index += 1) {
      await expectGap(actions.nth(index - 1), actions.nth(index), 8);
    }
    const button = await primary.locator("[data-main-action]").boundingBox();
    expect(button!.width).toBeLessThanOrEqual(260);
    expect(button!.x).toBeGreaterThanOrEqual(24);

    // With sound enabled, the install action retains the same gap from Settings.
    await page.getByRole("button", { name: "Turn on sound" }).click();
    await expectGap(resources, discovery, 8);
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(discovery).toBeHidden();
    await expect(page.locator(".utilityActions")).toBeHidden();
    const overflow = await page
      .locator("#menuCard")
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("a saved game remains separated from the logo and footer on short screens", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320px");
  await page.goto("/?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => Boolean(await readSavedGame(page))).toBe(true);
  await page.setViewportSize({ width: 360, height: 320 });
  await page.goto("/");
  const primary = page.getByRole("region", { name: "Primary actions" });
  await expect(
    primary.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
  await expectGap(
    primary.getByRole("button", { name: "Continue", exact: true }),
    primary.locator("[data-continue-context]"),
    8,
  );
  await expectGap(
    primary.locator("[data-continue-context]"),
    primary.getByRole("button", { name: "Start a new game", exact: true }),
    8,
  );
  await expectGap(
    primary.getByRole("button", { name: "Start a new game", exact: true }),
    primary.getByRole("button", { name: "Saved games", exact: true }),
    8,
  );
  const logo = await page.locator("#logo").boundingBox();
  const menu = await page.locator("#centeredMenu").boundingBox();
  const footer = await page.locator(".mainMenuFooter").boundingBox();
  expect(menu!.y).toBeGreaterThanOrEqual(logo!.y + logo!.height);
  expect(footer!.y).toBeGreaterThanOrEqual(menu!.y + menu!.height);
  const discord = page.getByRole("link", {
    name: "Join the Electrify Discord",
  });
  await discord.scrollIntoViewIfNeeded();
  await expect(discord).toBeInViewport();
});
