import { expect, test } from "./fixtures";
import { readSavedGame } from "./save-fixture";

// The bundle delays must control repeat visits even when production caching is available.
test.use({ serviceWorkers: "block" });

test("first-load logo stays centered through its slower slide into the menu", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({
    reducedMotion: "no-preference",
    colorScheme: testInfo.project.name.startsWith("mobile") ? "dark" : "light",
  });
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
  expect(
    await page.evaluate(() =>
      localStorage.getItem("electrify-startup-complete"),
    ),
  ).toBeNull();
  const before = (await loadingLogo.boundingBox())!;
  expect(before.x + before.width / 2).toBeCloseTo(
    page.viewportSize()!.width / 2,
    0,
  );
  releaseBundle();
  await expect(page.locator("#appStartup")).toHaveCount(0);
  const menuLogo = page.locator("#menuCard .homeLogo");
  await expect(menuLogo).toBeVisible();
  expect(
    await menuLogo.evaluate(
      (logo) => logo.getAnimations()[0].effect!.getTiming().duration,
    ),
  ).toBe(900);
  for (const time of [0, 450, 900]) {
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
    if (process.env.PR_SCREENSHOTS && time === 900) {
      await page.screenshot({
        path: `.tmp/pr-startup-${testInfo.project.name}.png`,
      });
    }
  }
  await expect(
    page.getByRole("button", { name: "Start playing", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("electrify-startup-complete"),
    ),
  ).toBe("true");
});

test("later loads skip the entrance on reload and in a new tab", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.matches("#menuCard .homeLogo, #centeredMenu")) {
        const root = document.documentElement;
        root.dataset.startupTransitions = String(
          Number(root.dataset.startupTransitions ?? 0) + 1,
        );
      }
      return animate.apply(this, args);
    };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator("#menuCard")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-startup-transitions",
    "2",
  );

  for (const returningPage of [page, await context.newPage()]) {
    await returningPage.emulateMedia({ reducedMotion: "no-preference" });
    let releaseBundle!: () => void;
    const bundleReady = new Promise<void>(
      (resolve) => (releaseBundle = resolve),
    );
    await returningPage.route("**/*achievements*.js", async (route) => {
      await bundleReady;
      await route.continue();
    });
    // Hold initialization after the app stylesheet arrives so this exercises the real CSS.
    const bundleRequested = returningPage.waitForRequest(
      "**/*achievements*.js",
    );
    await returningPage.goto("/", { waitUntil: "commit" });
    await bundleRequested;
    await expect(returningPage.locator("html")).toHaveAttribute(
      "data-startup-visit",
      "returning",
    );
    const entrance = returningPage.locator("#appStartup");
    await expect(entrance.getByRole("status")).toHaveText("Loading Electrify…");
    expect(
      await entrance.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
    ).toBe(0);
    releaseBundle();
    await expect(entrance).toHaveCount(0);
    await expect(
      returningPage.getByRole("button", { name: "Start playing", exact: true }),
    ).toBeEnabled();
    await expect(returningPage.locator("html")).not.toHaveAttribute(
      "data-startup-transitions",
    );
  }
});

test("blocked visit storage still allows the menu to load", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "electrify-startup-complete")
        throw new DOMException("Storage blocked", "SecurityError");
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "electrify-startup-complete")
        throw new DOMException("Storage blocked", "SecurityError");
      setItem.call(this, key, value);
    };
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start playing", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("#appStartup")).toHaveCount(0);
});

test("a failed load does not consume the first visit", async ({ page }) => {
  await page.route("**/*achievements*.js", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Electrify couldn't finish loading",
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem("electrify-startup-complete"),
    ),
  ).toBeNull();
  await page.unroute("**/*achievements*.js");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start playing", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("electrify-startup-complete"),
    ),
  ).toBe("true");
});

test("reduced motion skips the entrance on the first visit", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const logo = page.locator("#menuCard .homeLogo");
  await expect(logo).toBeVisible();
  expect(
    await logo.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  expect(
    await page
      .locator("#centeredMenu")
      .evaluate((element) => element.getAnimations().length),
  ).toBe(0);
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
