import { expect, test, Locator, Page } from "./fixtures";
import { expectReadableText, foregroundContrast } from "./contrast";
import { TUTORIALS } from "../src/data/Scenarios";
import { readSavedGame } from "./save-fixture";

async function actionAfterPlay(page: Page) {
  const friends = page.getByRole("button", {
    name: "Play with friends",
    exact: true,
  });
  return (await friends.isVisible())
    ? friends
    : page.getByRole("button", { name: "Settings", exact: true });
}

async function expectFooterTooltip(page: Page, action: Locator) {
  const footerAction = await action.evaluate(
    (element) => !!element.closest(".mainMenuFooter"),
  );
  const tooltip = page.getByRole("tooltip");
  if (footerAction) {
    await expect(tooltip).toHaveText(
      (await action.getAttribute("aria-label"))!,
    );
  } else {
    await expect(tooltip).toHaveCount(0);
  }
}

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
  await expect(
    loadingLogo.getByRole("img", { name: "Electrify" }),
  ).toBeVisible();
  const before = (await loadingLogo.boundingBox())!;
  releaseBundle();
  await expect(page.locator("#appStartup")).toHaveCount(0);
  const menuLogo = page.locator("#menuCard .homeLogo");
  const controls = page.locator("#centeredMenu button");
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
  expect(delays.length).toBeGreaterThanOrEqual(3);
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
  const restingAction = (await controls.first().boundingBox())!;
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
    expect(firstAction.y).toBe(restingAction.y);
    if (time >= delays[0])
      expect(firstAction.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
  }
  await advance(delays.at(-1)! + 250);
  for (const control of await controls.all())
    await expect(control).toHaveCSS("opacity", "1");
  await expect(controls.first()).toHaveCSS("width", "208px");
  if (process.env.PR_SCREENSHOTS)
    await page.locator("#menuCard").screenshot({
      path: `.tmp/pr-startup-${testInfo.project.name}.png`,
    });
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeFocused();
});

test("finishing every tutorial removes the shortcut while leaving the lessons replayable", async ({
  page,
}) => {
  await page.addInitScript(
    (ids) => {
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: ids.map((scenarioId) => ({
            scenarioId,
            timesPlayed: 1,
            date: "2026-11-18",
          })),
        }),
      );
    },
    TUTORIALS.map((tutorial) => tutorial.id),
  );
  await page.goto("/");
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tutorials", exact: true }),
  ).toHaveCount(0);
  await play.click();
  await expect(
    page.getByRole("heading", { name: "Choose a game", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Tutorials complete", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `View all ${TUTORIALS.length}`, exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "All tutorials" }).getByRole("button"),
  ).toHaveCount(TUTORIALS.length);
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
  const next = await actionAfterPlay(page);
  await expect(next).toBeFocused();
  await expect(next).toHaveCSS("opacity", "1");
  await page.reload();
  await expect(page.locator("#appStartup")).toHaveCount(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a game", exact: true }),
  ).toBeVisible();
});

test("hovering a home control makes it the active button, and keyboard continues from there", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); // skip the entrance stagger
  await page.goto("/");
  const play = page.getByRole("button", { name: "Play", exact: true });
  const settings = page.getByRole("button", {
    name: "Settings",
    exact: true,
  });
  await expect(page.locator("#appStartup")).toHaveCount(0); // the menu is revealed
  await settings.hover();
  await expect(settings).toBeFocused(); // the pointer moved the active button to Settings
  await page.keyboard.press("ArrowUp");
  const previous = page.getByRole("button", {
    name: "Play with friends",
    exact: true,
  });
  // Continue from the hovered control through the full order of the actions.
  if (await previous.isVisible()) {
    await expect(previous).toBeFocused();
    await page.keyboard.press("ArrowUp");
  }
  await expect(play).toBeFocused();
});

for (const theme of ["light", "dark"]) {
  test(`arrow selection paints only the current item on the next frame in ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto("/");
    await expect(page.locator("#appStartup")).toHaveCount(0);
    // Finish the entrance, then exercise the selection with normal motion enabled.
    await page.keyboard.press("ArrowDown");
    await page.locator("#centeredMenu").evaluate(async (menu) => {
      for (const animation of menu.getAnimations({ subtree: true }))
        animation.finish();
      await new Promise(requestAnimationFrame);
    });
    const frames = await page.locator("#menuCard").evaluate(async (menu) => {
      const buttons = Array.from(menu.querySelectorAll("button,a[href]"));
      const label = (element: Element) =>
        element.getAttribute("aria-label") || element.textContent!;
      const frames: { selected: string; painted: string[] }[] = [];
      for (const key of [
        "ArrowDown",
        "ArrowDown",
        "ArrowUp",
        "ArrowUp",
        "ArrowDown",
      ]) {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
        await new Promise(requestAnimationFrame);
        frames.push({
          selected: label(document.activeElement!),
          painted: buttons
            .filter(
              (button) =>
                getComputedStyle(button).backgroundColor !== "rgba(0, 0, 0, 0)",
            )
            .map(label),
        });
      }
      return frames;
    });
    for (const frame of frames) expect(frame.painted).toEqual([frame.selected]);
  });
}

for (const exit of ["Back", "Escape"]) {
  test(`returning home with ${exit} resets to the first action without a delayed jump`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto("/");
    const play = page.getByRole("button", { name: "Play", exact: true });
    await expect(play).toBeFocused();
    for (const destination of ["Manual", "Settings", "Achievements"]) {
      await page
        .getByRole("button", { name: destination, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: destination, exact: true }),
      ).toBeVisible();
      if (exit === "Back")
        await page.getByRole("button", { name: "Back", exact: true }).click();
      else await page.keyboard.press("Escape");
      await expect(play).toBeFocused();
      await page.clock.runFor(1000);
      await expect(play).toBeFocused();
      // A fresh return must also leave subsequent navigation alone.
      await page.keyboard.press("ArrowDown");
      const next = await actionAfterPlay(page);
      await expect(next).toBeFocused();
      await page.clock.runFor(1000);
      await expect(next).toBeFocused();
    }
  });
}

test("waits for saved games before revealing the returning menu in order", async ({
  page,
}) => {
  await page.goto("/?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => Boolean(await readSavedGame(page))).toBe(true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    const success = Object.getOwnPropertyDescriptor(
      IDBRequest.prototype,
      "onsuccess",
    )!;
    const release = new Promise<void>((resolve) => {
      document.addEventListener("release-save-catalog", () => resolve(), {
        once: true,
      });
    });
    IDBFactory.prototype.open = function (...args) {
      const request = open.apply(this, args);
      if (args[0] === "electrify-saves") {
        Object.defineProperty(request, "onsuccess", {
          set(callback: (event: Event) => void) {
            success.set!.call(request, (event: Event) => {
              document.documentElement.dataset.saveCatalogHeld = "true";
              void release.then(() => callback.call(request, event));
            });
          },
        });
      }
      return request;
    };
    document.addEventListener(
      "electrify-ready",
      () => {
        const labels = [
          ...document.querySelectorAll("#centeredMenu .mainActions button"),
        ].map((button) => button.textContent);
        document.documentElement.dataset.openingActions = labels.join(",");
      },
      { once: true },
    );
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-save-catalog-held",
    "true",
  );
  await expect(page.locator("#menuCard")).toBeAttached();
  await expect(page.locator("#appStartup")).toBeVisible();
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).not.toBeFocused();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("release-save-catalog")),
  );
  await expect(page.locator("#appStartup")).toHaveCount(0);
  const friends = page.getByRole("button", {
    name: "Play with friends",
    exact: true,
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-opening-actions",
    (await friends.isVisible())
      ? "Continue,Tutorials,Play,Saves,Play with friends"
      : "Continue,Tutorials,Play,Saves",
  );
});

test("loading and returning from Saved games select Continue at the top", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => Boolean(await readSavedGame(page))).toBe(true);
  await page.goto("/");
  const first = page.getByRole("button", { name: "Continue", exact: true });
  await expect(first).toBeFocused();
  await page.getByRole("button", { name: "Saves", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Saved games", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(first).toBeFocused();
  await page.clock.runFor(1000);
  await expect(first).toBeFocused();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a game", exact: true }),
  ).toBeVisible();
});

test("footer icons have equal optical gaps beside Share", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#appStartup")).toHaveCount(0);
  const edges = await page
    .locator(
      '.mainMenuFooter :is([aria-label="Join the Electrify Discord"],[aria-label="Send feedback"],[aria-label="Share Electrify"]) svg',
    )
    .evaluateAll((icons) =>
      icons.map((icon) => {
        const svg = icon as SVGSVGElement;
        const bounds = svg.getBBox();
        const matrix = svg.getScreenCTM()!;
        return {
          left: new DOMPoint(bounds.x, 0).matrixTransform(matrix).x,
          right: new DOMPoint(bounds.x + bounds.width, 0).matrixTransform(
            matrix,
          ).x,
        };
      }),
    );
  expect(edges).toHaveLength(3);
  expect(edges[2].left - edges[1].right).toBeCloseTo(
    edges[1].left - edges[0].right,
    1,
  );
});

// ============================================================================
// DANGER: CHANGING THE CTA COLOR IS NOT ALLOWED. The home-screen buttons, links and the logo smoke are
// the logo's blue (public/images/logo-home*.svg), in both themes. If this fails you changed
// it: put it back. Do not edit these constants, loosen the assertions, or re-declare
// --interactive-blue to chase a contrast score. src/CtaColor.test.ts guards the source.
// ============================================================================
const LOGO_BLUE = {
  light: "rgb(0, 132, 248)", // #0084f8
  dark: "rgb(98, 155, 225)", // #629be1
} as const;

for (const theme of ["light", "dark"] as const) {
  test(`home CTAs and logo smoke are the logo blue, with one primary action, in ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto("/");
    await expect(page.locator("#appStartup")).toHaveCount(0);
    const play = page.getByRole("button", { name: "Play", exact: true });
    await expect(play).toBeVisible();
    // Inspect the first-load selection before moving focus.
    const filled = page.locator(
      "#menuCard .mainActions .MuiButton-root:not([data-main-action])",
    );
    for (const button of await filled.all())
      await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator("#menuCard [data-main-action]")).toHaveCount(1);
    await expect(page.locator("#menuCard [data-main-action]")).toHaveCSS(
      "background-color",
      LOGO_BLUE[theme],
    );
    const smoke = page.locator("#menuCard .homeSmokePuff");
    await expect(smoke).toHaveCount(2);
    for (const puff of await smoke.all())
      await expect(puff).toHaveCSS("fill", LOGO_BLUE[theme]);
    // Settings (and Quit, Mods, Turn on sound) and the explore links are logo blue too,
    // not a quieter or deeper blue.
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toHaveCSS("color", LOGO_BLUE[theme]);
    for (const link of await page.locator("#menuCard .homeExplore a").all())
      await expect(link).toHaveCSS("color", LOGO_BLUE[theme]);
    // The CTAs that are not filled read in the same blue, and take the fill when selected.
    const friends = page.getByRole("button", { name: "Play with friends" });
    await expect(friends).toBeVisible();
    await expect(friends).toHaveCSS("color", LOGO_BLUE[theme]);
    // Touch has no moving selection: the one default action keeps the fill.
    if (!test.info().project.use.hasTouch) {
      await friends.focus();
      await expect(friends).toHaveCSS("background-color", LOGO_BLUE[theme]);
      await expect(play).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
  });
}

test("a returning player sees Continue as the only primary action, not Play with friends too", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => Boolean(await readSavedGame(page))).toBe(true);
  await page.goto("/");
  await expect(page.locator("#appStartup")).toHaveCount(0);
  const resume = page.getByRole("button", { name: "Continue", exact: true });
  await expect(resume).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expect(page.locator("#menuCard [data-main-action]")).toHaveCount(1);
  await expect(resume).toHaveCSS("background-color", LOGO_BLUE.light);
  for (const name of ["Play", "Saves", "Play with friends"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
});

test("a failed load can be retried", async ({ page }) => {
  // Returning players with stored preferences use the full bootstrap immediately.
  await page.addInitScript(() => localStorage.setItem("interfaceScale", "1"));
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
  test(`the home menu leads directly to play in ${theme}${theme === "dark" ? " @phone" : ""}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto("/");
    const description = page
      .locator("#centeredMenu")
      .getByText("An electricity strategy game.", { exact: true });
    await expect(description).toHaveCount(0);
    const logo = (await page.locator("#logo").boundingBox())!;
    const primary = (await page
      .getByRole("button", { name: "Play", exact: true })
      .boundingBox())!;
    expect(primary.y).toBeGreaterThanOrEqual(logo.y + logo.height);
    expect(primary.x).toBeGreaterThanOrEqual(0);
    expect(primary.x + primary.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
  });

  test(`home install and sound prompts update independently in ${theme} @phone`, async ({
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
    await expect(install.locator("svg")).toHaveCount(1);
    await expect(
      page
        .locator(".mainMenuFooter")
        .getByRole("button", { name: "Install app" }),
    ).toBeVisible();
    await expect(sound.locator("svg")).toHaveCount(0);
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

test("home actions and resources remain reachable at low height with and without a save @minimum-phone", async ({
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
    await primary.getByRole("button").first().scrollIntoViewIfNeeded();
    await expect(primary.getByRole("button").first()).toBeInViewport();
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

for (const theme of ["light", "dark"]) {
  test(`all home menu buttons share the primary action width in ${theme} @minimum-phone`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
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
      const primary = page.getByRole("button", {
        name: "Play",
        exact: true,
      });
      await expect(primary).toBeVisible();
      await page.evaluate(() =>
        window.dispatchEvent(
          new Event("beforeinstallprompt", { cancelable: true }),
        ),
      );
      await expect(
        page.getByRole("button", { name: "Install app" }),
      ).toBeVisible();
      const bounds = (await primary.boundingBox())!;
      for (const button of await page.locator("#centeredMenu button").all()) {
        await expectReadableText(button);
        const box = (await button.boundingBox())!;
        expect(box.width, await button.innerText()).toBeCloseTo(
          bounds.width,
          0,
        );
        expect(box.x, await button.innerText()).toBeCloseTo(bounds.x, 0);
      }
      if (
        hasSave &&
        process.env.REVIEW_SCREENSHOT_DIR &&
        ((theme === "light" && testInfo.project.name === "desktop-chromium") ||
          (theme === "dark" && testInfo.project.name === "mobile-390px"))
      ) {
        await page.mouse.move(0, 0);
        await page.getByRole("button", { name: "Manual", exact: true }).focus();
        await page.screenshot({
          path: `${process.env.REVIEW_SCREENSHOT_DIR}/menu-${theme}-${testInfo.project.name}.png`,
          animations: "disabled",
        });
      }
    }
  });
}

for (const theme of ["light", "dark"]) {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test(`home touch feedback releases cleanly in ${theme}, motion ${reducedMotion} @phone`, async ({
      page,
      context,
    }, testInfo) => {
      test.skip(!testInfo.project.use.hasTouch);
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      await page.goto("/");
      await expect(page.locator("#appStartup")).toHaveCount(0);
      const play = page.getByRole("button", { name: "Play", exact: true });
      const manual = page.getByRole("button", { name: "Manual", exact: true });
      const settings = page.getByRole("button", {
        name: "Settings",
        exact: true,
      });
      const sound = page.getByRole("button", { name: "Turn on sound" });
      await expect(sound).toHaveCSS("opacity", "1");
      // Establish the keyboard selection before checking that a touch drag leaves it alone.
      await play.focus();
      await expect(play).toBeFocused();
      const clear = "rgba(0, 0, 0, 0)";
      await expect(play).not.toHaveCSS("background-color", clear);
      await expect(manual).toHaveCSS("background-color", clear);

      const touch = await context.newCDPSession(page);
      try {
        for (const button of [play, settings]) {
          await button.scrollIntoViewIfNeeded();
          const box = (await button.boundingBox())!;
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
              { x: box.x + box.width / 2, y: box.y + box.height / 2 },
            ],
          });
          await expect(button).toHaveAttribute("data-touch-pressed", "");
          await button.evaluate((element) =>
            Promise.all(
              element.getAnimations().map((animation) => animation.finished),
            ).then(() => undefined),
          );
          await expectReadableText(button);
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchCancel",
            touchPoints: [],
          });
        }
        await manual.scrollIntoViewIfNeeded();
        const manualBox = (await manual.boundingBox())!;
        expect(manualBox.height).toBeGreaterThanOrEqual(44);
        const point = {
          x: manualBox.x + manualBox.width / 2,
          y: manualBox.y + manualBox.height / 2,
        };
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [point],
        });
        await expect(manual).not.toHaveCSS("background-color", clear);
        await expect(manual.locator(".MuiTouchRipple-root")).toBeHidden();
        if (reducedMotion === "reduce") {
          await expect(manual).toHaveCSS("transform", "none");
          expect(
            await manual.evaluate((element) =>
              getComputedStyle(element)
                .transitionDuration.split(",")
                .every((duration) => parseFloat(duration) <= 0.001),
            ),
          ).toBe(true);
        } else {
          await expect(manual).not.toHaveCSS("transform", "none");
        }
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: point.x + 3, y: point.y }],
        });
        await expect(play).toBeFocused();
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: manualBox.x - 20, y: point.y }],
        });
        await expect(manual).toHaveCSS("background-color", clear);
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchCancel",
          touchPoints: [],
        });
        await expect(manual).toHaveCSS("background-color", clear);
        await expect(manual).toHaveCSS("transform", "none");
        await expect(play).not.toHaveCSS("background-color", clear);
      } finally {
        await touch.detach();
      }

      await settings.tap();
      await expect(
        page.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Back", exact: true }).tap();
      await expect(play).toBeFocused();
      await expect(settings).toHaveCSS("background-color", clear);
      await expect(play).not.toHaveCSS("background-color", clear);

      // A physical keyboard on a touch device immediately restores selection feedback.
      await page.keyboard.press("ArrowDown");
      const friends = page.getByRole("button", {
        name: "Play with friends",
        exact: true,
      });
      if (await friends.isVisible()) {
        await expect(friends).toBeFocused();
        await page.keyboard.press("ArrowDown");
      }
      await expect(settings).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(sound).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(manual).toBeFocused();
      await expect(manual).not.toHaveCSS("background-color", clear);
      await expect(play).toHaveCSS("background-color", clear);
      await page.keyboard.press("ArrowUp");
      await expect(sound).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(settings).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible();
    });
  }
}

// The catalog shares cardList, whose responsive padding must not add a gutter here.
test("catalog and manual preserve spacing across responsive scales", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [{ scenarioId: 0, timesPlayed: 1, date: "2026-11-02" }],
      }),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a game" }),
  ).toBeVisible();
  // The catalog stays flush while the general card spacing scales with the viewport.
  const originalViewport = page.viewportSize()!;
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 699, height: 900 },
    { width: 700, height: 900 },
    { width: 1299, height: 900 },
    { width: 1300, height: 900 },
    { width: 1440, height: 900 },
    { width: 390, height: 1024 },
    { width: 390, height: 1025 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".missionList")).toHaveCSS("padding-top", "0px");
    await page
      .getByRole("button", { name: "Start Generators" })
      .click({ trial: true });
  }
  await page.setViewportSize(originalViewport);

  // The Manual keeps its root flush and scales the first content gutter instead.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  for (const [width, height, margin] of [
    [360, 640, "7.2px"],
    [700, 900, "12.8125px"],
    [1440, 900, "8px"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator("#manual")).toHaveCSS("padding-top", "0px");
    await expect(page.locator("#manual > :first-child")).toHaveCSS(
      "margin-top",
      margin,
    );
  }
});

for (const theme of ["light", "dark"]) {
  test(`footer icons join the arrow-key loop with visible selection in ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto("/");
    await expect(page.locator("#appStartup")).toHaveCount(0);
    await page.evaluate(() =>
      window.dispatchEvent(
        new Event("beforeinstallprompt", { cancelable: true }),
      ),
    );
    const footer = page.locator(".mainMenuFooter");
    await expect(
      footer.getByRole("button", { name: "Install app" }),
    ).toBeVisible();
    const actions = page.locator("#menuCard button, #menuCard a[href]");
    const count = await actions.count();
    const footerActions = footer.locator("button,a[href]");
    await expect(footerActions).toHaveCount(6);
    for (const action of await footerActions.all()) {
      const bounds = (await action.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );
    }
    const play = page.getByRole("button", { name: "Play", exact: true });
    await expect(play).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(actions.first()).toBeFocused();
    for (const key of ["ArrowDown", "ArrowRight"]) {
      for (let index = 1; index <= count; index++) {
        await page.keyboard.press(key);
        const selected = actions.nth(index % count);
        await expect(selected).toBeFocused();
        await expectFooterTooltip(page, selected);
        await expect(selected).not.toHaveCSS(
          "background-color",
          "rgba(0, 0, 0, 0)",
        );
      }
    }
    for (const key of ["ArrowUp", "ArrowLeft"]) {
      for (let index = count - 1; index >= 0; index--) {
        await page.keyboard.press(key);
        await expect(actions.nth(index)).toBeFocused();
        await expectFooterTooltip(page, actions.nth(index));
      }
    }
    await footer.getByRole("button", { name: "Achievements" }).hover();
    await expect(
      footer.getByRole("button", { name: "Achievements" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(
      footer.getByRole("button", { name: "Install app" }),
    ).toBeFocused();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(play).toBeFocused();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });
}

test("background clicks and returning to the page restore the first home action", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const first = page.getByRole("button", { name: "Play", exact: true });
  await expect(first).toBeFocused();
  // The first action stays visibly selected even before focus recovery gets a frame.
  const fallback = await first.evaluate((button) => {
    (document.activeElement as HTMLElement)?.blur();
    return getComputedStyle(button).backgroundColor;
  });
  expect(fallback).not.toBe("rgba(0, 0, 0, 0)");
  await expect(first).toBeFocused();
  await page.getByRole("button", { name: "Settings", exact: true }).hover();
  await page.locator("#logo").click();
  await expect(first).toBeFocused();
  const other = await context.newPage();
  await other.goto("about:blank");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.bringToFront();
  await expect(first).toBeFocused();
  await other.close();
});

// Touch keeps the first action highlighted at all times, so only pointer projects can show the jump.
test("leaving home does not light up the top action while the menu fades out", async ({
  page,
}, testInfo) => {
  test.skip(
    !["desktop-chromium", "desktop-1440px"].includes(testInfo.project.name),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const play = page.getByRole("button", { name: "Play", exact: true });
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await expect(page.locator("#appStartup")).toHaveCount(0);
  await expect(play).toBeFocused();
  await settings.hover();
  await expect(settings).toBeFocused(); // the pointer moved the active button to Settings
  // Capture the exit state in the browser before the outgoing menu can unmount.
  const exitState = await play.evaluateHandle((button) => {
    const screen = button.closest("main")!;
    const state = { inert: false, background: "" };
    const observer = new MutationObserver(() => {
      if (!screen.inert) return;
      state.inert = screen.inert;
      state.background = getComputedStyle(button).backgroundColor;
      observer.disconnect();
    });
    observer.observe(screen, { attributes: true, attributeFilter: ["inert"] });
    return state;
  });
  await settings.click();
  // The snapshot remains available even when the test reads it after the fade.
  await expect(page.locator("#menuCard")).toHaveCount(0);
  expect(await exitState.jsonValue()).toEqual({
    inert: true,
    background: "rgba(0, 0, 0, 0)",
  });
  await exitState.dispose();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`every footer icon has a consistent readable tooltip in ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto("/");
    await expect(page.locator("#appStartup")).toHaveCount(0);
    await page.evaluate(() =>
      window.dispatchEvent(
        new Event("beforeinstallprompt", { cancelable: true }),
      ),
    );
    const footer = page.locator(".mainMenuFooter");
    const actions = footer.locator("button,a[href]");
    await expect(actions).toHaveCount(6);
    const styles: Record<string, string>[] = [];
    for (const action of await actions.all()) {
      const name = (await action.getAttribute("aria-label"))!;
      await action.hover();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toHaveText(name);
      await expect(tooltip).toHaveAttribute("data-popper-placement", "top");
      await expect(tooltip).toHaveCSS("pointer-events", "none");
      const surface = tooltip.locator(".mainMenuTooltip");
      expect(await foregroundContrast(surface), name).toBeGreaterThanOrEqual(
        4.5,
      );
      // An immediate label can be visible before Popper's first position update.
      await expect
        .poll(async () => {
          const [tip, button] = await Promise.all([
            tooltip.boundingBox(),
            action.boundingBox(),
          ]);
          return tip && button ? button.y - tip.y - tip.height : -1;
        }, `${name} tooltip clears its icon`)
        .toBeGreaterThanOrEqual(7);
      const bounds = (await tooltip.boundingBox())!;
      const icon = (await action.boundingBox())!;
      expect(bounds.x, name).toBeGreaterThanOrEqual(7);
      expect(bounds.x + bounds.width, name).toBeLessThanOrEqual(
        page.viewportSize()!.width - 7,
      );
      expect(bounds.y, name).toBeGreaterThanOrEqual(0);
      expect(icon.y - bounds.y - bounds.height, name).toBeGreaterThanOrEqual(7);
      expect(icon.y - bounds.y - bounds.height, name).toBeLessThanOrEqual(9);
      styles.push(
        await surface.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            padding: style.padding,
            border: style.border,
            borderRadius: style.borderRadius,
            background: style.backgroundColor,
            color: style.color,
            shadow: style.boxShadow,
          };
        }),
      );
      const capture =
        process.env.REVIEW_SCREENSHOT_DIR &&
        ((theme === "light" &&
          info.project.name === "desktop-chromium" &&
          name === "Join the Electrify Discord") ||
          (theme === "light" &&
            info.project.name === "mobile-360px" &&
            name === "Manual") ||
          (theme === "dark" &&
            info.project.name === "mobile-390px" &&
            name === "Share Electrify"));
      if (capture) {
        const first = (await actions.first().boundingBox())!;
        const last = (await actions.last().boundingBox())!;
        const left = Math.max(0, Math.floor(Math.min(first.x, bounds.x) - 8));
        const top = Math.max(0, Math.floor(bounds.y - 8));
        const right = Math.min(
          page.viewportSize()!.width,
          Math.ceil(Math.max(last.x + last.width, bounds.x + bounds.width) + 8),
        );
        const bottom = Math.min(
          page.viewportSize()!.height,
          Math.ceil(last.y + last.height),
        );
        await page.screenshot({
          path: `${process.env.REVIEW_SCREENSHOT_DIR}/tooltip-${theme}-${info.project.name}.png`,
          ...(info.project.name === "desktop-chromium"
            ? {}
            : {
                clip: {
                  x: left,
                  y: top,
                  width: right - left,
                  height: bottom - top,
                },
              }),
          animations: "disabled",
        });
      }
    }
    for (const style of styles) expect(style).toEqual(styles[0]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    const exploreLinks = page
      .getByRole("navigation", { name: "Explore Electrify" })
      .getByRole("link");
    for (const link of await exploreLinks.all()) {
      await page.keyboard.press("ArrowDown");
      await expect(link).toBeFocused();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("button", { name: "Tutorials", exact: true }),
    ).toBeFocused();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    for (let index = (await exploreLinks.count()) - 1; index >= 0; index--) {
      await page.keyboard.press("ArrowUp");
      await expect(exploreLinks.nth(index)).toBeFocused();
    }
    await page.keyboard.press("ArrowUp");
    await expectFooterTooltip(page, actions.last());
  });
}
