import { expect, test } from "./fixtures";
import { readSavedGame } from "./save-fixture";

test("loading logo stays centered through its slide into the menu", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches("#menuCard .homeLogo")) {
        animation.pause();
        animation.currentTime = 0;
      }
      return animation;
    };
  });
  let releaseBundle!: () => void;
  const bundleReady = new Promise<void>((resolve) => (releaseBundle = resolve));
  await page.route("**/static/js/*.js", async (route) => {
    await bundleReady;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "commit" });
  const loadingLogo = page.locator("#appStartup .homeLogo");
  await expect(loadingLogo.getByAltText("Electrify")).toBeVisible();
  const before = (await loadingLogo.boundingBox())!;
  expect(before.x + before.width / 2).toBeCloseTo(
    page.viewportSize()!.width / 2,
    0,
  );
  releaseBundle();
  await expect(page.locator("#appStartup")).toHaveCount(0);
  const menuLogo = page.locator("#menuCard .homeLogo");
  await expect(menuLogo).toBeVisible();
  for (const time of [0, 100, 200]) {
    await menuLogo.evaluate((logo, currentTime) => {
      for (const animation of logo.getAnimations())
        animation.currentTime = currentTime;
    }, time);
    const bounds = (await menuLogo.boundingBox())!;
    expect(bounds.width).toBeCloseTo(before.width, 0);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(
      page.viewportSize()!.width / 2,
      0,
    );
  }
  await expect(
    page.getByRole("button", { name: "Start playing", exact: true }),
  ).toBeEnabled();
});

for (const theme of ["light", "dark"]) {
  test(`home install and sound prompts update independently in ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto("/");
    const sound = page.getByRole("button", { name: "Turn on sound" });
    const install = page.getByRole("button", { name: "Install app" });
    await expect(sound).toBeVisible();
    await expect(install).toBeHidden();
    await page.evaluate(() => {
      window.dispatchEvent(
        new Event("beforeinstallprompt", { cancelable: true }),
      );
    });
    await expect(install).toBeVisible();
    await sound.click();
    await expect(sound).toBeHidden();
    await expect(install).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(install).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Start playing", exact: true }),
    ).toBeEnabled();
  });
}

test("home actions and resources remain reachable at low height with and without a save", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-360px");
  await page.setViewportSize({ width: 360, height: 320 });
  for (const hasSave of [false, true]) {
    if (hasSave) {
      await page.goto("/?scenario=103");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await expect
        .poll(async () => Boolean(await readSavedGame(page)))
        .toBe(true);
    }
    await page.goto("/");
    const primary = page.getByRole("region", { name: "Primary actions" });
    await expect(
      primary.getByRole("button", {
        name: hasSave ? "Continue" : "Start playing",
        exact: true,
      }),
    ).toBeVisible();
    const logo = (await page.locator("#logo").boundingBox())!;
    const menu = (await page.locator("#centeredMenu").boundingBox())!;
    const footer = (await page.locator(".mainMenuFooter").boundingBox())!;
    expect(menu.y).toBeGreaterThanOrEqual(logo.y + logo.height);
    expect(footer.y).toBeGreaterThanOrEqual(menu.y + menu.height);
    for (const button of await primary.getByRole("button").all()) {
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }
    const discord = page.getByRole("link", {
      name: "Join the Electrify Discord",
    });
    await discord.scrollIntoViewIfNeeded();
    await expect(discord).toBeInViewport();
    expect(
      await page
        .locator("#menuCard")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
});
