import { expect, test } from "./fixtures";
import { readSavedGame } from "./save-fixture";

// The bundle delays must control repeat visits even when production caching is available.
test.use({ serviceWorkers: "block" });

test("loading hands off to a smooth logo rise and individually staggered controls", async ({
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
      if (this.closest("#menuCard")) {
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
  releaseBundle();
  await expect(page.locator("#appStartup")).toHaveCount(0);
  const menuLogo = page.locator("#menuCard .homeLogo");
  const controls = page.locator("#menuCard button, #menuCard a[href]");
  const duration = await menuLogo.evaluate((logo) =>
    Number(logo.getAnimations()[0].effect!.getTiming().duration),
  );
  const advance = (time: number) =>
    page.locator("#menuCard").evaluate((menu, currentTime) => {
      for (const animation of menu.getAnimations({ subtree: true })) {
        if (
          animation instanceof Animation &&
          !(animation instanceof CSSAnimation)
        )
          animation.currentTime = currentTime;
      }
    }, time);
  const start = (await menuLogo.boundingBox())!;
  expect(start.y).toBeCloseTo(before.y, 0);
  expect(start.width).toBeCloseTo(before.width, 0);
  const delays = await controls.evaluateAll((elements) =>
    elements.map((element) =>
      Number(element.getAnimations()[0].effect!.getTiming().delay),
    ),
  );
  expect(delays.length).toBeGreaterThan(5);
  for (let index = 1; index < delays.length; index++)
    expect(delays[index]).toBeGreaterThan(delays[index - 1]);
  await expect(controls.first()).toHaveCSS("opacity", "0");
  await advance(delays[1]);
  expect(
    Number(
      await controls
        .first()
        .evaluate((element) => getComputedStyle(element).opacity),
    ),
  ).toBeGreaterThan(0);
  await expect(controls.nth(1)).toHaveCSS("opacity", "0");
  let previousY = start.y;
  for (const time of [duration / 3, (duration * 2) / 3, duration]) {
    await advance(time);
    const bounds = (await menuLogo.boundingBox())!;
    expect(bounds.y).toBeLessThan(previousY);
    previousY = bounds.y;
    expect(bounds.x + bounds.width / 2).toBeCloseTo(
      page.viewportSize()!.width / 2,
      0,
    );
    const firstAction = (await controls.first().boundingBox())!;
    expect(firstAction.y).toBeGreaterThan(bounds.y + bounds.height);
  }
  for (const control of await controls.all())
    await expect(control).toHaveCSS("opacity", "1");
  if (process.env.PR_SCREENSHOTS)
    await page.screenshot({
      path: `.tmp/pr-startup-${testInfo.project.name}.png`,
    });
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeFocused();
});

test("warm reloads and new tabs keep the minimum loading time and animate again", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    new MutationObserver((records) => {
      for (const record of records)
        for (const removed of record.removedNodes) {
          if (removed instanceof HTMLElement && removed.id === "appStartup")
            document.documentElement.dataset.startupDuration = String(
              performance.now() - Number(removed.dataset.startedAt),
            );
        }
    }).observe(document, { childList: true, subtree: true });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.matches("#menuCard .homeLogo"))
        document.documentElement.dataset.startupAnimated = "true";
      return animate.apply(this, args);
    };
  });
  for (const returningPage of [page, page, await context.newPage()]) {
    await returningPage.emulateMedia({ reducedMotion: "no-preference" });
    await returningPage.goto("/");
    await expect(returningPage.locator("#appStartup")).toHaveCount(0);
    expect(
      Number(
        await returningPage
          .locator("html")
          .getAttribute("data-startup-duration"),
      ),
    ).toBeGreaterThanOrEqual(500);
    await expect(returningPage.locator("html")).toHaveAttribute(
      "data-startup-animated",
      "true",
    );
    await expect(
      returningPage.getByRole("button", { name: "Play", exact: true }),
    ).toBeEnabled();
  }
});

test("keyboard and pointer actions work during the entrance", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.closest("#menuCard")) {
        animation.pause();
        animation.currentTime = 0;
      }
      return animation;
    };
  });
  await page.goto("/");
  await expect(page.locator("#appStartup")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "Manual", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toHaveCSS("opacity", "1");
  await page.reload();
  await expect(page.locator("#appStartup")).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".facilities:visible")).toBeVisible();
});

test("hovering a home control makes it the active button, and keyboard continues from there", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); // skip the entrance stagger
  await page.goto("/");
  const play = page.getByRole("button", { name: "Play", exact: true });
  const manual = page.getByRole("button", { name: "Manual", exact: true });
  await expect(page.locator("#appStartup")).toHaveCount(0); // the menu is revealed
  await manual.hover();
  await expect(manual).toBeFocused(); // the pointer moved the active button to Manual
  await page.keyboard.press("ArrowUp");
  await expect(play).toBeFocused(); // keyboard continues from the hovered control
});

test("a failed load can be retried", async ({ page }) => {
  await page.route("**/*achievements*.js", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Electrify couldn't finish loading",
  );
  await page.unroute("**/*achievements*.js");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
});

test("reduced motion skips the logo movement and stagger", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      // Remember requests even if an entrance finishes before the assertions run.
      if (this.closest("#menuCard"))
        document.documentElement.dataset.menuAnimationRequested = "true";
      return animate.apply(this, args);
    };
  });
  await page.goto("/");
  // A visible logo can precede the startup handoff and its motion decision.
  await expect(page.locator("#appStartup")).toHaveCount(0);
  const logo = page.locator("#menuCard .homeLogo");
  await expect(logo).toBeVisible();
  expect(
    await logo.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  // Control feedback can still be settling after the startup handoff. The audit below
  // rejects entrance motion even if it finishes before this animation count settles.
  await expect
    .poll(() =>
      page
        .locator("#menuCard")
        .evaluate((element) => element.getAnimations({ subtree: true }).length),
    )
    .toBe(0);
  expect(
    await page.locator("html").getAttribute("data-menu-animation-requested"),
  ).toBeNull();
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
      page.getByRole("button", { name: "Play", exact: true }),
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
        name: hasSave ? "Continue" : "Play",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("#menuCard")).toHaveCSS("overflow-y", "auto");
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
