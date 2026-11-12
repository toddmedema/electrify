import { expect, test } from "./fixtures";
import type { Frame, Locator, Page, Route } from "@playwright/test";
import { createHash } from "node:crypto";
import path from "node:path";
import { createCouchFixture } from "./couch-fixture";
import type { CouchFixture } from "./couch-fixture";

async function startCouch<Actor extends Page | Frame>(
  page: Page,
  couch: CouchFixture<Actor>,
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play with friends", exact: true })
    .click();
  await page.getByRole("button", { name: "On this TV", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "On this TV · Two players" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose a game", exact: true }),
  ).toBeDisabled();
  // The visible dialog renders before its native event subscription and setup finish.
  await expect
    .poll(() => couch.settledNativeRequests("setup"))
    .toBeGreaterThan(0);
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect(
    page.getByText("Controller joined", { exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Choose a game", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View Carbon Fee details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start for everyone", exact: true })
    .click();
  const start = page
    .getByRole("dialog")
    .getByRole("button", { name: "Start for everyone", exact: true });
  await expect(start).toBeDisabled();
  const openReplies = await couch.settledNativeRequests("open");
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect.poll(() => couch.seats.size).toBe(2);
  // The fixture publishes seat actors before navigating them. The open reply
  // follows both navigations and attachments; map size alone is not readiness.
  await expect
    .poll(() => couch.settledNativeRequests("open"))
    .toBe(openReplies + 1);
  for (const [id, { page: seat }] of couch.seats) {
    await expect(seat.locator("html")).toHaveAttribute("data-couch-seat", id);
    await expect(seat.locator("#appbar:visible")).toBeVisible();
  }
}

for (const nativeBindings of [false, true]) {
  test(`TV couch startup waits for delayed P2 navigation (native bindings=${nativeBindings})`, async ({
    context,
    page,
  }, info) => {
    test.skip(
      !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
      "Seat startup readiness in both palettes and transports",
    );
    const couch = nativeBindings
      ? await createCouchFixture(context, page, { nativeBindings: true })
      : await createCouchFixture(context, page);
    let documentReleased = false;
    let releaseDocument!: () => void;
    const heldDocument = new Promise<void>((resolve) => {
      releaseDocument = resolve;
    });
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    await context.route(/\?couchSeat=local-p2&generation=/, async (route) => {
      // Fault injection only: make the real second-seat document slower than
      // the map-size poll. Startup must await readiness, not an assumed delay.
      releaseTimer = setTimeout(() => {
        documentReleased = true;
        releaseDocument();
      }, 1000);
      await heldDocument;
      await route.continue();
    });
    try {
      await startCouch(page, couch);
      const openReplies = await couch.settledNativeRequests("open");
      await info.attach("startup-readiness", {
        body: JSON.stringify({
          documentReleased,
          openReplies,
          seats: [...couch.seats].map(([id, route]) => ({
            id,
            generation: route.generation,
            url: route.page.url(),
          })),
        }),
        contentType: "application/json",
      });
      expect(documentReleased).toBe(true);
      expect(openReplies).toBe(1);
      const p1 = couch.seats.get("local-p1")!.page;
      const p2 = couch.seats.get("local-p2")!.page;
      await couch.input({ "101": ["menu"] });
      const menu = page.getByRole("dialog", { name: "Game menu", exact: true });
      await expect(menu).toBeVisible();
      await menu
        .getByRole("button", { name: "Return to game", exact: true })
        .click();
      await expect(menu).toHaveCount(0);
      await couch.input({ "202": ["build"] });
      await expect(
        p2.getByRole("region", { name: "Build", exact: true }),
      ).toBeVisible();
      await expect(
        p1.getByRole("region", { name: "Build", exact: true }),
      ).toHaveCount(0);
    } finally {
      clearTimeout(releaseTimer);
      releaseDocument();
      await context.unrouteAll({ behavior: "wait" });
    }
  });
}

const speedControls = (seat: Page | Frame) =>
  seat.getByRole("group", { name: "your game speed", exact: true });
const clock = (seat: Page | Frame) =>
  // The global overlay hides embedded player views. Read their rendered clock
  // state while all interaction queries remain visible-only.
  seat.getByRole("group", {
    name: "your game speed",
    exact: true,
    includeHidden: true,
  });
async function runNormally(...seats: (Page | Frame)[]) {
  for (const seat of seats)
    await speedControls(seat)
      .getByRole("button", { name: "normal speed", exact: true })
      .click();
  for (const seat of seats)
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
}
async function renderedFontSize(element: Locator) {
  return element.evaluate((node) =>
    parseFloat(getComputedStyle(node).fontSize),
  );
}

async function expectCompanyMoneyRow(seat: Page | Frame) {
  const geometry = await seat.locator(".gameBalance").evaluate((balance) => {
    const cash = balance
      .querySelector(".gameStatusValue")!
      .getBoundingClientRect();
    const profit = balance
      .querySelector(".gameMonthlyProfit")!
      .getBoundingClientRect();
    return {
      cash: {
        left: cash.left,
        right: cash.right,
        top: cash.top,
        bottom: cash.bottom,
      },
      profit: {
        left: profit.left,
        right: profit.right,
        top: profit.top,
        bottom: profit.bottom,
      },
    };
  });
  expect
    .soft(geometry.profit.left, "profit sits beside company cash")
    .toBeGreaterThan(geometry.cash.right);
  expect
    .soft(
      Math.min(geometry.cash.bottom, geometry.profit.bottom) -
        Math.max(geometry.cash.top, geometry.profit.top),
      "cash and monthly profit share one row",
    )
    .toBeGreaterThan(0);
}

async function expectSettingsClearance(globalSettings: Locator) {
  const back = globalSettings.getByRole("button", {
    name: "Back",
    exact: true,
  });
  const credits = globalSettings.getByRole("button", {
    name: "Credits and licenses",
    exact: true,
  });
  const footer = globalSettings.getByRole("complementary", {
    name: "Controller controls",
    exact: true,
  });
  await credits.scrollIntoViewIfNeeded();
  await expect(back).toBeInViewport();
  await expect(credits).toBeInViewport();
  await expect
    .poll(
      async () => {
        const [header, bottomControl, legend] = await Promise.all([
          back.boundingBox(),
          credits.boundingBox(),
          footer.boundingBox(),
        ]);
        return header && bottomControl && legend
          ? Math.max(
              header.y + header.height,
              bottomControl.y + bottomControl.height,
            ) - legend.y
          : Infinity;
      },
      {
        message:
          "normal Settings header and scroll controls stay above Controls",
      },
    )
    .toBeLessThanOrEqual(0);
  await globalSettings
    .getByRole("button", { name: "System", exact: true })
    .scrollIntoViewIfNeeded();
}

async function expectSharedSettings(globalSettings: Locator) {
  await expect(
    globalSettings.getByRole("heading", { name: "Settings", exact: true }),
  ).toHaveCount(1);
  await expect(
    globalSettings.getByRole("heading", {
      name: /Utility|TV session settings/,
    }),
  ).toHaveCount(0);
  await expect(
    globalSettings.getByRole("button", {
      name: "Return to all companies",
      exact: true,
    }),
  ).toHaveCount(0);
  const controls = globalSettings.getByRole("complementary", {
    name: "Controller controls",
    exact: true,
  });
  await expect(controls.locator("strong")).toHaveText("Controls");
  await expect(controls).not.toContainText(/P[12]|Utility/);
}

async function expectSharedMenu(page: Page, menu: Locator) {
  await expect(menu).toBeVisible();
  for (const name of ["Return to game", "Manual", "Settings", "Quit"])
    await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
  const controls = menu.getByRole("complementary", {
    name: "Controller controls",
    exact: true,
  });
  await expect(controls.locator("strong")).toHaveText("Controls");
  await expect(controls).not.toContainText(/P[12]|Utility/);
  const bounds = await menu.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(
    Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2),
  ).toBeLessThan(2);
  expect(
    Math.abs(bounds!.y + bounds!.height / 2 - viewport.height / 2),
  ).toBeLessThan(viewport.height * 0.15);
  const backdropAlpha = await menu.evaluate((dialog) => {
    const backdrop = dialog
      .closest(".MuiModal-root")!
      .querySelector(".MuiBackdrop-root")!;
    const color = getComputedStyle(backdrop).backgroundColor;
    return color.startsWith("rgba(")
      ? Number(color.split(",").at(-1)!.replace(")", ""))
      : 1;
  });
  expect(backdropAlpha).toBeGreaterThan(0);
  expect(backdropAlpha).toBeLessThan(1);
  await expect(controls).toHaveCSS("opacity", "1");
  const focused = menu.getByRole("button", {
    name: "Return to game",
    exact: true,
  });
  await focused.focus();
  const color = await focused.evaluate((button) => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(button).getPropertyValue(
      "--interactive-contrast",
    );
    button.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { expected, actual: getComputedStyle(button).color };
  });
  expect(color.actual).toBe(color.expected);
}

async function expectSharedCaptionSize(
  page: Page,
  seat: Page | Frame,
  zoom: number,
) {
  await expect
    .poll(
      async () => {
        const reserveFont = await renderedFontSize(
          seat.locator(".gridHealthStatusWord, .gridHealthMetric").first(),
        );
        const fonts = await Promise.all([
          renderedFontSize(page.locator(".couchCalendar .gameStatusValue")),
          renderedFontSize(page.locator(".missionRiskText")),
          renderedFontSize(page.locator(".missionSummaryMonths > span")),
        ]);
        return Math.max(
          ...fonts.map((font) => Math.abs(font - reserveFont * zoom)),
        );
      },
      {
        message: "shared date/event/months matches physical reserve-label font",
      },
    )
    .toBeLessThan(0.5);
}

async function expectPlayersPainted(page: Page) {
  for (const id of ["local-p1", "local-p2"]) {
    const snapshot = page.locator(`[data-couch-backdrop-seat="${id}"]`);
    await expect(
      snapshot,
      `${id} remains painted beneath the shared overlay`,
    ).toBeVisible();
    await expect
      .poll(() =>
        snapshot.evaluate(
          (image) =>
            (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    // Native views hide only after the shell has decoded the real seat captures.
    await expect(page.locator(`#couch-fixture-${id}`)).toBeHidden();
    const nativeBounds = await page
      .locator(`#couch-fixture-${id}`)
      .evaluate((frame) => {
        const rect = frame.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
    const paintedBounds = await snapshot.boundingBox();
    expect(paintedBounds).not.toBeNull();
    for (const key of ["x", "y", "width", "height"] as const)
      expect(paintedBounds![key]).toBeCloseTo(nativeBounds[key], 0);
  }
}

async function pointerTarget(page: Page, seat: Frame, button: Locator) {
  const seatId = await seat.locator("html").getAttribute("data-couch-seat");
  const bounds = await button.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const frame = await page
    .locator(`#couch-fixture-${seatId}`)
    .evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        zoom: new DOMMatrix(getComputedStyle(node).transform).a,
      };
    });
  // Observe the real event target, including when the coordinator would reject
  // its command. The global overlay must intercept the pointer before the pane.
  await button.evaluate((target) =>
    target.addEventListener(
      "click",
      () => {
        document.documentElement.dataset.couchPointerLeak = "true";
      },
      { once: true },
    ),
  );
  await page.mouse.click(
    frame.x + (bounds.x + bounds.width / 2) * frame.zoom,
    frame.y + (bounds.y + bounds.height / 2) * frame.zoom,
  );
  await expect(seat.locator("html")).not.toHaveAttribute(
    "data-couch-pointer-leak",
    "true",
  );
}

async function expectSeatChromeRemoved(seat: Page | Frame) {
  await expect(seat.locator(".couchIdentity")).toHaveCount(0);
  await expect(seat.locator(".gameMenuButton")).toHaveCount(0);
  await expect(seat.locator("#yearProgressBar")).toHaveCount(0);
  await expect(seat.locator(".missionSummary")).toHaveCount(0);
  await expect(seat.locator(".controllerHints")).toHaveCount(0);
  await expect(seat.locator(".gameDockLabel")).toHaveCount(0);
  await expect(speedControls(seat)).toBeVisible();
  await expect(
    seat.locator("#appbar").getByRole("group", {
      name: "your game speed",
      exact: true,
    }),
  ).toHaveCount(1);
  for (const name of ["Build", "Programs", "Insights", "Events", "Scenario"])
    await expect(seat.getByRole("button", { name, exact: true })).toBeVisible();
}

test("TV couch companies keep independent dialogs and purchases through atomic save and resume", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Two seat renderer journey at 1080p in each palette",
  );
  const couch = await createCouchFixture(context, page);
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  for (const seat of [p1, p2]) {
    await expect(seat.locator("#appbar:visible")).toBeVisible();
    await expect(seat.locator(".gameStage")).toHaveAttribute(
      "data-layout",
      "tv",
    );
  }
  await expect(page.locator(".appFrameBody")).toBeHidden();
  await expect(speedControls(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "menu", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#yearProgressBar")).toHaveCount(1);
  await expect(page.locator(".missionSummary")).toBeVisible();
  await expectSeatChromeRemoved(p1);
  await expectSeatChromeRemoved(p2);
  await runNormally(p1, p2);
  await expect.poll(() => couch.checkpoint()?.grids.length).toBe(2);
  const originalCounts = couch
    .checkpoint()!
    .grids.map((grid) => grid.facilities.length);
  await couch.input({ "101": ["build"], "202": ["build"] });
  const build1 = p1.getByRole("region", { name: "Build", exact: true });
  const build2 = p2.getByRole("region", { name: "Build", exact: true });
  await expect(build1).toBeVisible();
  await expect(build2).toBeVisible();
  const review1 = build1.getByRole("button", {
    name: "Review purchase of Solar",
    exact: true,
  });
  const review2 = build2.getByRole("button", {
    name: "Review purchase of Solar",
    exact: true,
  });
  // Each document retains its own real focus; both devices confirm in the same sample.
  await review1.focus();
  await review2.focus();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  const purchase1 = p1.getByRole("dialog");
  const purchase2 = p2.getByRole("dialog");
  await expect(purchase1).toBeVisible();
  await expect(purchase2).toBeVisible();
  await purchase1
    .getByRole("button", { name: "Take loan", exact: true })
    .focus();
  await purchase2
    .getByRole("button", { name: "Take loan", exact: true })
    .focus();
  await couch.input({ "101": ["confirm"] });
  await expect(purchase1).toHaveCount(0);
  await expect(purchase2).toBeVisible();
  await expect(
    purchase2.getByRole("button", { name: "Take loan", exact: true }),
  ).toBeFocused();
  await couch.input({ "202": ["confirm"] });
  await expect(purchase2).toHaveCount(0);
  await expect(build1).toHaveCount(0);
  await expect(build2).toHaveCount(0);
  await p2.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(
    p2.getByRole("region", { name: "Insights", exact: true }),
  ).toBeVisible();
  await couch.input({ "101": ["menu"] });
  const gameMenu = page.getByRole("dialog", { name: "Game menu", exact: true });
  await expectSharedMenu(page, gameMenu);
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "PAUSED");
  await expect(clock(p2)).toHaveAttribute("data-active-speed", "PAUSED");
  await expect(
    page.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toBeVisible();

  await expect(
    page
      .getByRole("complementary", {
        name: "Controller controls",
        exact: true,
      })
      .getByRole("img", { name: "Right stick up", exact: true }),
  ).toBeVisible();
  await couch.input({ "202": ["down"] });
  await expect(
    gameMenu.getByRole("button", { name: "Manual", exact: true }),
  ).toBeFocused();
  await couch.input({ "202": ["down"] });
  await expect(
    gameMenu.getByRole("button", { name: "Settings", exact: true }),
  ).toBeFocused();
  await couch.input({ "202": ["confirm"] });

  const globalSettings = page.getByRole("dialog", {
    name: "Settings",
    exact: true,
  });
  await expectSharedSettings(globalSettings);
  await expect(
    globalSettings.getByRole("heading", {
      name: "Settings",
      exact: true,
    }),
  ).toBeVisible();
  await p2.evaluate(() =>
    window.electrifyCouch!.post({
      kind: "global-settings",
      requestId: "p2-settings",
    }),
  );
  // Shared settings remain one dialog while both companies' gameplay controls are gated.
  await couch.input({ "202": ["build"] });
  await expect(
    globalSettings.getByRole("heading", {
      name: "Settings",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    p2.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await globalSettings
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await expect(globalSettings).toHaveCount(0);
  await expect(purchase1).toHaveCount(0);
  await expect(
    p2.getByRole("region", { name: "Insights", exact: true }),
  ).toBeVisible();
  await expect(
    p1.getByRole("region", { name: "Insights", exact: true }),
  ).toHaveCount(0);
  await expect(p2.locator(".insights:visible .uplot").first()).toBeVisible();
  // A purchase review remains usable while the partner's real forecast/chart is open.
  await couch.input({ "101": ["build"] });
  await build1
    .getByRole("button", { name: "Review purchase of Solar", exact: true })
    .focus();
  await couch.input({ "101": ["confirm"] });
  await expect(purchase1).toBeVisible();
  await expect(
    p2.getByRole("region", { name: "Insights", exact: true }),
  ).toBeVisible();
  for (const seat of [p1, p2]) {
    const dismiss = seat.getByRole("button", {
      name: "Dismiss notification",
      exact: true,
    });
    if (await dismiss.isVisible()) await dismiss.click();
    await expect(dismiss).toHaveCount(0);
  }
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await p1.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-p1-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
    await p2.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-p2-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
  }
  await couch.input({ "101": ["back"] });
  await expect(purchase1).toHaveCount(0);
  await couch.input({ "101": ["menu"] });
  await page
    .getByRole("dialog", { name: "Game menu", exact: true })
    .getByRole("button", { name: "Quit", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save & Quit", exact: true })
    .click();
  await expect.poll(() => couch.seats.size).toBe(0);
  const complete = couch.checkpoint()!;
  expect(complete.grids.map((grid) => grid.facilities.length)).toEqual(
    originalCounts.map((count) => count + 1),
  );
  expect(complete.edges).toHaveLength(1);
  expect(Object.keys(complete.receipts)).toEqual(
    expect.arrayContaining(["local-p1", "local-p2"]),
  );
  await page
    .getByRole("button", { name: "Play with friends", exact: true })
    .click();
  await page.getByRole("button", { name: "On this TV", exact: true }).click();
  await page.getByRole("button", { name: /^Resume Local campaign/ }).click();
  for (const name of ["P1 company", "P2 company"])
    await expect(
      page.getByRole("textbox", { name, exact: true }),
    ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review saved game", exact: true }),
  ).toBeDisabled();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect(
    page.getByText("Controller joined", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Review saved game", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review saved game", exact: true })
    .click();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect.poll(() => couch.seats.size).toBe(2);
  await expect.poll(() => couch.checkpoint()?.epoch).not.toBe(complete.epoch);
  expect(
    couch.checkpoint()!.grids.map((grid) => grid.facilities.length),
  ).toEqual(complete.grids.map((grid) => grid.facilities.length));
});

test("TV couch player toolbars own speed with edge-to-edge panes and global pause", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Full two-company presentation at the 1080p couch preset in both palettes",
  );
  const couch = await createCouchFixture(context, page, { embedded: true });
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  for (const seat of [p1, p2]) {
    await expect(seat.locator("#appbar:visible")).toBeVisible();
    await expectSeatChromeRemoved(seat);
  }
  const zoom = couch.layout()!.zoom;
  for (const seat of [p1, p2]) await expectCompanyMoneyRow(seat);
  await expectSharedCaptionSize(page, p1, zoom);
  await expect(page.locator(".appFrameBody")).toBeHidden();
  await expect(speedControls(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "menu", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#yearProgressBar")).toHaveCount(1);
  await expect(page.locator(".missionSummary")).toBeVisible();
  await expect(page.locator(".missionRiskText")).toContainText(
    "Carbon fee rising",
  );
  await expect(page.getByRole("button", { name: /months left$/ })).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save & Quit for everyone", exact: true }),
  ).toHaveCount(0);
  await runNormally(p1, p2);
  await speedControls(p1)
    .getByRole("button", { name: "fast speed", exact: true })
    .click();
  await expect(
    speedControls(p1).getByRole("button", {
      name: "fast speed",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    speedControls(p2).getByRole("button", {
      name: "normal speed",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "NORMAL");
  // The clock's thumb, not the button, carries the fill: it sits under the running speed.
  await expect
    .poll(() =>
      speedControls(p1)
        .getByRole("button", { name: "normal speed", exact: true })
        .evaluate((button) => {
          const group = button.closest(".speedToggles")!;
          const style = getComputedStyle(group, "::before");
          const probe = document.createElement("span");
          probe.style.color =
            getComputedStyle(group).getPropertyValue("--speed-thumb");
          group.appendChild(probe);
          const expected = getComputedStyle(probe).color;
          probe.remove();
          const box = button.getBoundingClientRect();
          const centre =
            group.getBoundingClientRect().left +
            parseFloat(style.left) +
            new DOMMatrix(style.transform).m41 +
            parseFloat(style.width) / 2;
          return {
            filled: style.backgroundColor === expected,
            underButton: Math.abs(centre - (box.left + box.width / 2)) <= 1,
          };
        }),
    )
    .toEqual({ filled: true, underButton: true });
  await expect
    .poll(() =>
      speedControls(p1)
        .getByRole("button", { name: "fast speed", exact: true })
        .evaluate(
          (button) => getComputedStyle(button, "::before").borderTopWidth,
        ),
    )
    .toBe("2px");
  await speedControls(p2)
    .getByRole("button", { name: "slow speed", exact: true })
    .click();
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "SLOW");
  await expect(
    speedControls(p1).getByRole("button", {
      name: "fast speed",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await runNormally(p1, p2);
  // The couch daily plot uses 176 design px, 20% below solo's 220. Larger
  // text is already enabled by the real fixture, making its visible height 220 px.
  for (const seat of [p1, p2]) {
    await expect(seat.locator("html")).toHaveAttribute(
      "data-text-size",
      "larger",
    );
    const dailyChart = seat.locator(".facilitySupplyChart .accessibleChart");
    await expect(dailyChart).toBeVisible();
    await expect
      .poll(() =>
        dailyChart.evaluate((chart) => chart.getBoundingClientRect().height),
      )
      .toBe(220);
  }
  await p2.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(p2.locator(".insights:visible .uplot").first()).toBeVisible();
  await p2.locator(".insights:visible .uplot").first().scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  for (const seat of [p1, p2]) {
    await seat.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
    await expect(seat.getByRole("tooltip")).toHaveCount(0);
  }
  const band = await page.locator(".couchBand").boundingBox();
  const layout = couch.layout();
  expect(band).not.toBeNull();
  expect(layout?.fits).toBe(true);
  expect(layout!.cssWidth).toBeGreaterThanOrEqual(360);
  for (const seat of [p1, p2]) {
    const viewport = await seat.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    expect(viewport.width).toBeGreaterThanOrEqual(360);
    expect(Math.abs(viewport.width - layout!.cssWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(viewport.height - layout!.cssHeight)).toBeLessThanOrEqual(
      1,
    );
  }
  expect(layout!.bounds[0].x).toBe(0);
  expect(layout!.bounds[1].x + layout!.bounds[1].width).toBe(1920);
  expect(layout!.bounds[1].x).toBeGreaterThan(
    layout!.bounds[0].x + layout!.bounds[0].width,
  );
  for (const [index, bounds] of layout!.bounds.entries()) {
    expect(bounds.y).toBe(Math.ceil(band!.y + band!.height));
    expect(bounds.y + bounds.height).toBe(1080);
    const rendered = await page
      .locator(`#couch-fixture-local-p${index + 1}`)
      .boundingBox();
    expect(rendered).not.toBeNull();
    expect(rendered!.x).toBeCloseTo(bounds.x, 1);
    expect(rendered!.y).toBeCloseTo(bounds.y, 1);
    expect(rendered!.x + rendered!.width).toBeCloseTo(
      bounds.x + bounds.width,
      1,
    );
    expect(rendered!.y + rendered!.height).toBeCloseTo(1080, 1);
  }
  if (process.env.REVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-full-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
  await couch.input({ "202": ["menu"] });
  const gameMenu = page.getByRole("dialog", { name: "Game menu", exact: true });
  await expectSharedMenu(page, gameMenu);
  await expectPlayersPainted(page);
  await expect(
    page.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toBeVisible();
  const legend = page.getByRole("complementary", {
    name: "Controller controls",
    exact: true,
  });
  // The native fixture intentionally supplies labels without images. Recognized
  // bindings still need visible icons with their actual accessible origin names.
  for (const name of ["Cross", "Options", "Right stick up", "Right stick down"])
    await expect(legend.getByRole("img", { name, exact: true })).toBeVisible();
  for (const action of ["Game menu", "Pause / resume", "Slower", "Faster"])
    await expect(legend.getByText(action, { exact: true })).toBeVisible();
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "PAUSED");
  await couch.input({ "101": ["build"] });
  await expect(
    p1.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await expect(gameMenu).toBeVisible();
  if (process.env.REVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-menu-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
  await couch.input({ "101": ["menu"] });
  await expect(gameMenu).toHaveCount(0);
  await expect(
    page.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toHaveCount(0);
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
  await expect(
    p1.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await expect(
    p2.getByRole("region", { name: "Insights", exact: true }),
  ).toBeVisible();
  await couch.input({ "202": ["menu"] });
  await expect(gameMenu).toBeVisible();
  await expectPlayersPainted(page);
  await pointerTarget(
    page,
    p2,
    clock(p2).getByRole("button", {
      name: "ultra speed",
      exact: true,
      includeHidden: true,
    }),
  );
  // A backdrop click may dismiss the menu; either way the underlying speed never changes.
  await expect(
    clock(p2).getByRole("button", {
      name: "normal speed",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(gameMenu).toHaveCount(0);
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
  await couch.input({ "202": ["menu"] });
  await gameMenu.getByRole("button", { name: "Settings", exact: true }).click();
  const globalSettings = page.getByRole("dialog", {
    name: "Settings",
    exact: true,
  });
  await expect(globalSettings).toBeVisible();
  await expectPlayersPainted(page);
  await expectSharedSettings(globalSettings);
  await expectSettingsClearance(globalSettings);
  await expect(
    page.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toBeVisible();
  if (process.env.REVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-settings-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "PAUSED");
  await couch.input({ "101": ["build"] });
  await expect(
    p1.getByRole("region", { name: "Build", exact: true, includeHidden: true }),
  ).toHaveCount(0);
  await pointerTarget(
    page,
    p2,
    clock(p2).getByRole("button", {
      name: "ultra speed",
      exact: true,
      includeHidden: true,
    }),
  );
  await expect(globalSettings).toHaveCount(0);
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
  await expect(
    clock(p2).getByRole("button", {
      name: "normal speed",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const closeWith of ["controller", "header"] as const) {
    await couch.input({
      "202": [closeWith === "controller" ? "menuAlt" : "menu"],
    });
    await gameMenu
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expect(globalSettings).toBeVisible();
    await expect(
      globalSettings.getByRole("complementary", {
        name: "Controller controls",
        exact: true,
      }),
    ).toBeVisible();
    await expectSharedSettings(globalSettings);
    await expectSettingsClearance(globalSettings);
    await expectPlayersPainted(page);
    if (closeWith === "controller") {
      await globalSettings
        .getByRole("button", { name: "System", exact: true })
        .focus();
      await couch.input({ "101": ["back"] });
    } else {
      await globalSettings
        .getByRole("button", { name: "Back", exact: true })
        .click();
    }
    await expect(globalSettings).toHaveCount(0);
    await expect(page.locator(".couchDialogWithControls:visible")).toHaveCount(
      0,
    );
    for (const seat of [p1, p2])
      await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
  }
  await couch.input({ "202": ["menu"] });
  await gameMenu.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(globalSettings).toBeVisible();
  await expect(
    globalSettings.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toBeVisible();
  await expectSharedSettings(globalSettings);
  await expectSettingsClearance(globalSettings);
  await expectPlayersPainted(page);
  const appearance = globalSettings.getByRole("group", {
    name: "Appearance",
    exact: true,
  });
  await appearance.getByRole("button", { name: "System", exact: true }).focus();
  await couch.input({ "101": ["right"] });
  await expect(
    appearance.getByRole("button", { name: "Light", exact: true }),
  ).toBeFocused();
  await couch.input({ "202": ["left"] });
  await expect(
    appearance.getByRole("button", { name: "System", exact: true }),
  ).toBeFocused();
  const backdropHash = async () =>
    createHash("sha256")
      .update(
        (await page
          .locator('[data-couch-backdrop-seat="local-p1"]')
          .getAttribute("src")) ?? "",
      )
      .digest("hex");
  const desktopBackdrop = couch.backdropRevision();
  const desktopGeometry = JSON.stringify(couch.layout());
  const interfaceLayout = globalSettings.getByRole("group", {
    name: "Interface layout",
    exact: true,
  });
  await interfaceLayout
    .getByRole("button", { name: "TV", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-tv-layout", "true");
  await expectSharedSettings(globalSettings);
  await expectSettingsClearance(globalSettings);
  await expectSharedCaptionSize(page, p1, couch.layout()!.zoom);
  if (JSON.stringify(couch.layout()) !== desktopGeometry)
    await expect
      .poll(couch.backdropRevision, {
        message: "changed native bounds refresh the paused player capture",
      })
      .toBeGreaterThan(desktopBackdrop);
  await expectPlayersPainted(page);
  const tvBackdrop = couch.backdropRevision();
  const tvGeometry = JSON.stringify(couch.layout());
  await interfaceLayout
    .getByRole("button", { name: "Desktop", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-tv-layout", "false");
  await expectSharedSettings(globalSettings);
  await expectSettingsClearance(globalSettings);
  await expectSharedCaptionSize(page, p1, couch.layout()!.zoom);
  if (JSON.stringify(couch.layout()) !== tvGeometry)
    await expect.poll(couch.backdropRevision).toBeGreaterThan(tvBackdrop);
  await expectPlayersPainted(page);
  const previousBackdrop = await backdropHash();
  const originalTheme =
    info.project.use.colorScheme === "dark" ? "dark" : "light";
  const changedTheme = originalTheme === "dark" ? "light" : "dark";
  await globalSettings
    .getByRole("group", { name: "Appearance", exact: true })
    .getByRole("button", {
      name: changedTheme === "dark" ? "Dark" : "Light",
      exact: true,
    })
    .click();
  for (const seat of [p1, p2])
    await expect(seat.locator("html")).toHaveAttribute(
      "data-theme",
      changedTheme,
    );
  await expect
    .poll(backdropHash, {
      message: "paused player capture refreshes with shared appearance",
    })
    .not.toBe(previousBackdrop);
  await expectPlayersPainted(page);
  const changedBackdrop = await backdropHash();
  await globalSettings
    .getByRole("group", { name: "Appearance", exact: true })
    .getByRole("button", { name: "System", exact: true })
    .click();
  for (const seat of [p1, p2])
    await expect(seat.locator("html")).toHaveAttribute(
      "data-theme",
      originalTheme,
    );
  await expect.poll(backdropHash).not.toBe(changedBackdrop);
  await expectPlayersPainted(page);
  await globalSettings
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await expect(globalSettings).toHaveCount(0);
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
});

test("TV couch lost Steam text owner recovers without dismissing newer text", async ({
  context,
  page,
}, info) => {
  test.skip(
    info.project.name !== "tv-1080-light",
    "One authenticated shell event regression covers the owner lifecycle",
  );
  const couch = await createCouchFixture(context, page);
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!;
  const p2 = couch.seats.get("local-p2")!;
  for (const seat of [p1.page, p2.page])
    await expect(seat.locator("#appbar:visible")).toBeVisible();
  await runNormally(p1.page, p2.page);
  const nativeEvent = (detail: Record<string, unknown>) =>
    page.evaluate((event) => {
      window.dispatchEvent(
        new CustomEvent("couchNativeEvent", { detail: event }),
      );
    }, detail);
  const oldText = {
    kind: "global-text",
    id: "old-p1-text",
    seatId: "local-p1",
    generation: p1.generation,
  };
  await nativeEvent({ ...oldText, open: true });
  await expect(
    page.getByRole("heading", {
      name: "P1 Utility: entering text",
      exact: true,
    }),
  ).toBeVisible();
  await nativeEvent({
    kind: "seat-lost",
    seatId: "local-p1",
    generation: p1.generation,
    reason: "Controller seat unavailable",
  });
  await expect.poll(couch.cancelledText).toContain("old-p1-text");
  await expect(
    page.getByRole("heading", {
      name: "P1 Utility: entering text",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "TV session paused", exact: true }),
  ).toBeVisible();
  await nativeEvent({ ...oldText, open: false });
  await expect(
    page.getByRole("heading", { name: "TV session paused", exact: true }),
  ).toBeVisible();
  const newText = {
    kind: "global-text",
    id: "new-p2-text",
    seatId: "local-p2",
    generation: p2.generation,
  };
  await nativeEvent({ ...newText, open: true });
  const newerDialog = page.getByRole("heading", {
    name: "P2 Utility: entering text",
    exact: true,
  });
  await expect(newerDialog).toBeVisible();
  await nativeEvent({ ...oldText, open: false });
  await expect(newerDialog).toBeVisible();
  await nativeEvent({ ...newText, open: false });
  await expect(newerDialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "TV session paused", exact: true }),
  ).toBeVisible();
});

test("TV couch native promise failures return control to the main menu", async ({
  context,
  page,
}, info) => {
  test.skip(
    info.project.name !== "tv-1080-light",
    "Native failure cleanup is independent of palette",
  );
  const couch = await createCouchFixture(context, page);
  await page.goto("/");
  const openSetup = async () => {
    await page
      .getByRole("button", { name: "Play with friends", exact: true })
      .click();
    await page.getByRole("button", { name: "On this TV", exact: true }).click();
    const setup = page.getByRole("dialog", {
      name: "On this TV · Two players",
      exact: true,
    });
    await expect(setup).toBeVisible();
    return setup;
  };
  for (const operation of ["setup", "list-saves"] as const) {
    couch.failNextNative(operation);
    const setup = await openSetup();
    await expect(setup.getByRole("alert")).toContainText(
      `Fixture ${operation} failure`,
    );
    await setup.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Play with friends", exact: true }),
    ).toBeVisible();
  }
  const setup = await openSetup();
  couch.failNextNative("close");
  await setup.getByRole("button", { name: "Back", exact: true }).click();
  const failure = page.getByRole("dialog", {
    name: "TV session cleanup failed",
    exact: true,
  });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("Fixture close failure");
  await expect(
    page.getByRole("heading", {
      name: "On this TV · Two players",
      exact: true,
    }),
  ).toHaveCount(0);
  await failure.getByRole("button", { name: "OK", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play with friends", exact: true }),
  ).toBeVisible();
});

test("TV couch coalesces visual preferences without capturing audio changes", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Preference capture behavior in each palette",
  );
  const couch = await createCouchFixture(context, page, { embedded: true });
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  for (const seat of [p1, p2])
    await expect(seat.locator("#appbar:visible")).toBeVisible();
  await runNormally(p1, p2);
  await couch.input({ "202": ["menu"] });
  await page
    .getByRole("dialog", { name: "Game menu", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expectSharedSettings(settings);
  await expectPlayersPainted(page);
  await couch.settleCaptures();
  const baselineRefreshes = couch.refreshRequests();
  const baselinePresentations = couch.presentationMessages();
  const sound = settings.getByRole("switch", { name: "Sound", exact: true });
  await sound.check();
  await settings
    .getByRole("slider", { name: "Music volume", exact: true })
    .press("Home");
  await settings
    .getByRole("slider", { name: "Music volume", exact: true })
    .press("ArrowRight");
  await settings
    .getByRole("slider", { name: "Effects volume", exact: true })
    .press("Home");
  await sound.uncheck();
  await expect
    .poll(couch.presentationMessages)
    .toBeGreaterThan(baselinePresentations);
  // Observe the deferred capture window before checking that audio did not
  // schedule a refresh; the native bridge must still receive the preferences.
  await page.waitForTimeout(500);
  await couch.settleCaptures();
  expect
    .soft(
      couch.refreshRequests(),
      "sound and volume preferences do not recapture player screens",
    )
    .toBe(baselineRefreshes);

  const baselineRevision = couch.backdropRevision();
  const beforeVisual = couch.refreshRequests();
  const snapshotHash = async () =>
    createHash("sha256")
      .update(
        (await page
          .locator('[data-couch-backdrop-seat="local-p1"]')
          .getAttribute("src")) ?? "",
      )
      .digest("hex");
  const beforeImage = await snapshotHash();
  const finalTheme = info.project.use.colorScheme === "dark" ? "light" : "dark";
  const finalThemeLabel = finalTheme === "dark" ? "Dark" : "Light";
  const otherThemeLabel = finalTheme === "dark" ? "Light" : "Dark";
  await settings.evaluate(
    (dialog, choices) => {
      const click = (name: string, label: string) => {
        const group = dialog.querySelector(`[aria-label="${name}"]`);
        const button = [
          ...group!.querySelectorAll<HTMLButtonElement>("button"),
        ].find((candidate) => candidate.textContent?.trim() === label);
        if (!button) throw new Error(`Missing ${name}: ${label}`);
        button.click();
      };
      // A burst traverses all visual fields before one paint. Later nonvisual
      // updates must neither trigger screenshots nor cancel the pending visual one.
      click("Appearance", choices.finalThemeLabel);
      click("Text size", "Standard");
      click("Units", "Imperial");
      click("Appearance", choices.otherThemeLabel);
      click("Text size", "Larger");
      click("Units", "Metric");
      click("Appearance", choices.finalThemeLabel);
      click("Text size", "Large");
      click("Units", "Imperial");
      const audio = dialog.querySelector<HTMLInputElement>(
        'input[aria-label="Sound"]',
      )!;
      audio.click();
      audio.click();
    },
    { finalThemeLabel, otherThemeLabel },
  );
  for (const seat of [p1, p2]) {
    await expect(seat.locator("html")).toHaveAttribute(
      "data-theme",
      finalTheme,
    );
    await expect(seat.locator("html")).toHaveAttribute(
      "data-text-size",
      "large",
    );
  }
  await expect.poll(couch.refreshRequests).toBeGreaterThan(beforeVisual);
  await expect.poll(couch.backdropRevision).toBeGreaterThan(baselineRevision);
  await expect.poll(snapshotHash).not.toBe(beforeImage);
  await expectPlayersPainted(page);
  await page.waitForTimeout(500);
  await couch.settleCaptures();
  expect
    .soft(
      couch.refreshRequests(),
      "one refresh captures the latest burst, including its final theme and text size",
    )
    .toBe(beforeVisual + 1);

  // Units are visual even when they do not change the currently open forecast.
  const beforeUnits = couch.refreshRequests();
  const unitsRevision = couch.backdropRevision();
  await settings
    .getByRole("group", { name: "Units", exact: true })
    .getByRole("button", { name: "Metric", exact: true })
    .click();
  await expect.poll(couch.refreshRequests).toBe(beforeUnits + 1);
  await expect.poll(couch.backdropRevision).toBeGreaterThan(unitsRevision);
  await expectPlayersPainted(page);
  await settings.getByRole("button", { name: "Back", exact: true }).click();
  await expect(settings).toHaveCount(0);
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
});

for (const committed of [false, true]) {
  test(`TV couch rejected controller binding retries without false ownership (native committed=${committed})`, async ({
    context,
    page,
  }, info) => {
    test.skip(
      !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
      "Binding recovery in both palettes",
    );
    const couch = await createCouchFixture(context, page);
    await page.goto("/");
    const setupReplies = await couch.settledNativeRequests("setup");
    await page
      .getByRole("button", { name: "Play with friends", exact: true })
      .click();
    await page.getByRole("button", { name: "On this TV", exact: true }).click();
    const setup = page.getByRole("dialog", {
      name: "On this TV · Two players",
      exact: true,
    });
    await expect(setup).toBeVisible();
    await expect
      .poll(() => couch.settledNativeRequests("setup"))
      .toBe(setupReplies + 1);
    await couch.input({ "202": ["confirm"] });
    await expect(
      setup.getByText("Controller joined", { exact: true }),
    ).toHaveCount(1);
    const nativeBefore = couch.nativeBindings();
    expect(nativeBefore).toEqual({ "local-p1": "202" });
    const pending = couch.deferNextBind(committed);
    await couch.input({ "101": ["confirm"] });
    await pending.requested;
    await expect
      .soft(setup.getByText("Controller joined", { exact: true }))
      .toHaveCount(1);
    await expect
      .soft(setup.getByRole("button", { name: "Choose a game", exact: true }))
      .toBeDisabled();
    await couch.input({ "101": ["confirm"] });
    expect(couch.bindAttempts()).toHaveLength(2);
    pending.settle("reject");
    await expect
      .soft(setup.getByRole("alert"))
      .toHaveText(
        `Error: Fixture bind failure${committed ? ". Native routing changed but recovery did not finish. Press Confirm again." : ""}`,
      );
    await expect
      .soft(setup.getByText("Controller joined", { exact: true }))
      .toHaveCount(1);
    await expect
      .soft(setup.getByRole("button", { name: "Choose a game", exact: true }))
      .toBeDisabled();
    expect(couch.nativeBindings()).toEqual(
      committed ? { ...nativeBefore, "local-p2": "101" } : nativeBefore,
    );
    await couch.input({ "101": ["confirm"] });
    await expect.poll(() => couch.bindAttempts().length).toBe(3);
    await expect(
      setup.getByText("Controller joined", { exact: true }),
    ).toHaveCount(2);
    await expect(
      setup.getByRole("button", { name: "Choose a game", exact: true }),
    ).toBeEnabled();
    expect(couch.nativeBindings()).toEqual({
      "local-p1": "202",
      "local-p2": "101",
    });
  });
}

for (const outcome of ["resolve", "reject"] as const) {
  test(`TV couch stale controller binding ${outcome} cannot affect a new setup`, async ({
    context,
    page,
  }, info) => {
    test.skip(
      info.project.name !== "tv-1080-light",
      "Lifecycle guard is independent of palette",
    );
    const couch = await createCouchFixture(context, page);
    await page.goto("/");
    const open = async () => {
      const replies = await couch.settledNativeRequests("setup");
      await page
        .getByRole("button", { name: "Play with friends", exact: true })
        .click();
      await page
        .getByRole("button", { name: "On this TV", exact: true })
        .click();
      const setup = page.getByRole("dialog", {
        name: "On this TV · Two players",
        exact: true,
      });
      await expect(setup).toBeVisible();
      await expect
        .poll(() => couch.settledNativeRequests("setup"))
        .toBe(replies + 1);
      return setup;
    };
    const setup = await open();
    const pending = couch.deferNextBind(true);
    await couch.input({ "101": ["confirm"] });
    await pending.requested;
    // The explicit close finishes first; hold the unmount cleanup at its real
    // asynchronous transport boundary while the next setup accepts input.
    const closing = couch.deferNativeClose(2);
    const closeReplies = await couch.settledNativeRequests("close");
    await setup.getByRole("button", { name: "Back", exact: true }).click();
    await closing.requested;
    const newer = await open();
    const fresh = couch.deferNextBind(true);
    await couch.input({ "202": ["confirm"] });
    await fresh.requested;
    expect(couch.nativeBindings()).toEqual({ "local-p1": "202" });
    closing.settle();
    await expect
      .poll(() => couch.settledNativeRequests("close"))
      .toBe(closeReplies + 2);
    expect
      .soft(couch.nativeBindings(), "old close cannot revoke the fresh binding")
      .toEqual({ "local-p1": "202" });
    fresh.settle("resolve");
    await expect(
      newer.getByText("Controller joined", { exact: true }),
    ).toHaveCount(1);
    pending.settle(outcome);
    // The native reply is released before this second real event/frame reaches the shell.
    await couch.input({});
    await expect(newer.getByRole("alert")).toHaveCount(0);
    await expect(
      newer.getByText("Controller joined", { exact: true }),
    ).toHaveCount(1);
    expect(couch.nativeBindings()).toEqual({ "local-p1": "202" });
    await couch.input({ "101": ["confirm"] });
    await expect(
      newer.getByText("Controller joined", { exact: true }),
    ).toHaveCount(2);
    expect(couch.nativeBindings()).toEqual({
      "local-p1": "202",
      "local-p2": "101",
    });
  });
}

test("TV couch play controller binding recovery preserves the other company and renderer blocker", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Live controller recovery in both palettes",
  );
  const couch = await createCouchFixture(context, page);
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  // Native seat creation precedes the shell's final startup reply. Exercise the
  // real menu, whose owner waits for startup, before sending replacement input.
  const gameMenu = page.getByRole("dialog", { name: "Game menu", exact: true });
  await expect
    .poll(async () => {
      if (await gameMenu.isVisible()) return true;
      await couch.input({ "101": ["menu"] });
      return gameMenu.isVisible();
    })
    .toBe(true);
  await gameMenu
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await expect(gameMenu).toHaveCount(0);
  await couch.setConnected({ "101": false, "303": true });
  const paused = page.getByRole("dialog", {
    name: "TV session paused",
    exact: true,
  });
  await expect(paused).toBeVisible();
  const pending = couch.deferNextBind(true);
  await couch.input({ "303": ["confirm"] });
  await pending.requested;
  await couch.setConnected({ "202": false });
  await expect
    .soft(
      paused.getByText(
        "P1 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    )
    .toBeVisible();
  await expect(
    paused.getByText(
      "P2 Utility: controller disconnected. Reconnect its assigned controller.",
      { exact: true },
    ),
  ).toBeVisible();
  pending.settle("reject");
  await couch.setConnected({ "202": true });
  await expect
    .soft(
      paused.getByText(
        "P1 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(couch.nativeBindings()).toEqual({
    "local-p1": "303",
    "local-p2": "202",
  });
  await couch.input({ "303": ["confirm"] });
  await expect.poll(() => couch.bindAttempts().length).toBe(4);
  await expect(paused).toHaveCount(0);
  await couch.input({ "303": ["build"] });
  await expect(
    p1.getByRole("region", { name: "Build", exact: true }),
  ).toBeVisible();
  await expect(
    p2.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await couch.input({ "303": ["back"] });
  await expect(
    p1.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  const lost = couch.seats.get("local-p2")!;
  await page.evaluate(
    ({ generation }) => {
      window.dispatchEvent(
        new CustomEvent("couchNativeEvent", {
          detail: {
            kind: "seat-lost",
            seatId: "local-p2",
            generation,
            reason: "regression route loss",
          },
        }),
      );
    },
    { generation: lost.generation },
  );
  await expect(
    paused.getByRole("button", { name: "Restore P2 Utility", exact: true }),
  ).toBeVisible();
  await couch.setConnected({ "303": false, "404": true });
  await couch.input({ "404": ["confirm"] });
  await expect
    .poll(() => couch.nativeBindings())
    .toEqual({ "local-p1": "404", "local-p2": "202" });
  await expect(
    paused.getByText(
      "P1 Utility: controller disconnected. Reconnect its assigned controller.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(
    paused.getByRole("button", { name: "Restore P2 Utility", exact: true }),
  ).toBeVisible();
});

for (const statusFailure of [false, true]) {
  test(`TV couch retries native-owned P2 after partial reload failure and P1 loss (status unavailable=${statusFailure})`, async ({
    context,
    page,
  }, info) => {
    test.skip(
      !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
      "Real native binding recovery in both palettes",
    );
    const couch = await createCouchFixture(context, page, {
      nativeBindings: true,
    });
    await startCouch(page, couch);
    const gameMenu = page.getByRole("dialog", {
      name: "Game menu",
      exact: true,
    });
    await expect
      .poll(async () => {
        if (await gameMenu.isVisible()) return true;
        await couch.input({ "101": ["menu"] });
        return gameMenu.isVisible();
      })
      .toBe(true);
    await gameMenu
      .getByRole("button", { name: "Return to game", exact: true })
      .click();
    await expect(gameMenu).toHaveCount(0);
    const original = couch.nativeEvidence().topology;
    expect(original["local-p1"].hasPort).toBe(true);
    expect(original["local-p2"].hasPort).toBe(true);
    const statusReplies = await couch.settledNativeRequests("status");
    await couch.setConnected({ "202": false, "404": true });
    couch.failNextNativeReload("local-p2");
    if (statusFailure) couch.failNextNative("status");
    await couch.input({ "404": ["confirm"] });
    await expect
      .poll(() => couch.settledNativeRequests("status"))
      .toBe(statusReplies + 1);
    expect(couch.nativeBindings()).toEqual({
      "local-p1": "101",
      "local-p2": "404",
    });
    const failed = couch.nativeEvidence();
    expect(failed.errors).toEqual(["Error: Fixture native reload failure"]);
    expect(failed.topology["local-p2"].generation).toBeGreaterThan(
      original["local-p2"].generation,
    );
    expect(failed.topology["local-p2"].hasPort).toBe(false);
    const paused = page.getByRole("dialog", {
      name: "TV session paused",
      exact: true,
    });
    await expect(
      paused.getByRole("button", { name: "Restore P2 Utility", exact: true }),
    ).toBeVisible();
    await expect(
      paused.getByText(
        "P2 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    ).toBeVisible();
    await couch.setConnected({ "101": false });
    await expect(
      paused.getByText(
        "P1 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    ).toBeVisible();
    await couch.input({ "404": ["confirm"] });
    await expect
      .poll(() => couch.settledNativeRequests("status"))
      .toBe(statusReplies + 2);
    const expectedErrors = ["Error: Fixture native reload failure"];
    if (statusFailure) {
      // The first status was unavailable, so this attempt discovers ownership
      // through the actual native exclusivity rejection and a recovered status.
      expect(couch.bindAttempts().at(-1)).toEqual({
        seatId: "local-p1",
        controllerId: "404",
      });
      expectedErrors.push(
        "Error: That controller already owns another company",
      );
      expect(couch.nativeEvidence().errors).toEqual(expectedErrors);
      expect(couch.nativeEvidence().topology["local-p2"]).toEqual(
        failed.topology["local-p2"],
      );
      await couch.input({ "404": ["confirm"] });
      await expect
        .poll(() => couch.settledNativeRequests("status"))
        .toBe(statusReplies + 3);
    }
    expect
      .soft(couch.bindAttempts().at(-1))
      .toEqual({ seatId: "local-p2", controllerId: "404" });
    expect(couch.nativeEvidence().errors).toEqual(expectedErrors);
    expect(couch.nativeBindings()).toEqual({
      "local-p1": "101",
      "local-p2": "404",
    });
    await expect(
      paused.getByText(
        "P2 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(
      paused.getByRole("button", { name: "Restore P2 Utility", exact: true }),
    ).toHaveCount(0);
    await expect(
      paused.getByText(
        "P1 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    ).toBeVisible();
    const recoveredP2 = couch.nativeEvidence().topology["local-p2"];
    expect(recoveredP2.hasPort).toBe(true);
    expect(recoveredP2.generation).toBeGreaterThan(
      failed.topology["local-p2"].generation,
    );
    expect(couch.nativeEvidence().topology["local-p1"]).toEqual(
      original["local-p1"],
    );
    await couch.setConnected({ "303": true });
    await couch.input({ "303": ["confirm"] });
    await expect
      .poll(() => couch.nativeBindings())
      .toEqual({ "local-p1": "303", "local-p2": "404" });
    await expect(paused).toHaveCount(0);
    const p1 = couch.seats.get("local-p1")!.page;
    const p2 = couch.seats.get("local-p2")!.page;
    await couch.input({ "404": ["build"] });
    await expect(
      p2.getByRole("region", { name: "Build", exact: true }),
    ).toBeVisible();
    await expect(
      p1.getByRole("region", { name: "Build", exact: true }),
    ).toHaveCount(0);
    expect(couch.nativeEvidence().topology["local-p2"]).toEqual(recoveredP2);
    expect(couch.nativeEvidence().calls.inputFrame).toBeGreaterThan(0);
    expect(couch.nativeEvidence().calls.bind).toBe(statusFailure ? 6 : 5);
  });
}

test("TV couch keeps controller input usable when one backdrop capture stalls", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Bounded native capture behavior in both palettes",
  );
  const couch = await createCouchFixture(context, page, {
    nativeBindings: true,
  });
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  for (const seat of [p1, p2])
    await expect(seat.locator("#appbar:visible")).toBeVisible();
  await couch.settleCaptures();
  const revision = couch.backdropRevision();
  // A real pending font request blocks screenshot preparation in every browser
  // world. Native capture failure must omit only that seat, not trap input.
  let stalledFont: Route | undefined;
  await p1.route("**/couch-capture-stall.woff2", (route) => {
    stalledFont = route;
  });
  await p1.evaluate(() => {
    const font = new FontFace(
      "CouchCaptureStall",
      "url('/couch-capture-stall.woff2')",
    );
    document.fonts.add(font);
    void font.load().catch(() => {});
  });
  await expect.poll(() => !!stalledFont).toBe(true);
  await expect
    .poll(() => p1.evaluate(() => document.fonts.status))
    .toBe("loading");
  try {
    await couch.input({ "101": ["menu"] });
    const menu = page.getByRole("dialog", { name: "Game menu", exact: true });
    await expect(menu).toBeVisible();
    await expect.poll(couch.backdropRevision).toBeGreaterThan(revision);
    await expect(
      page.locator('[data-couch-backdrop-seat="local-p1"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-couch-backdrop-seat="local-p2"]'),
    ).toBeVisible();
    await couch.input({ "101": ["back"] });
    await expect(menu).toHaveCount(0);
    await couch.input({ "202": ["build"] });
    await expect(
      p2.getByRole("region", { name: "Build", exact: true }),
    ).toBeVisible();
    await expect(
      p1.getByRole("region", { name: "Build", exact: true }),
    ).toHaveCount(0);
  } finally {
    await stalledFont?.abort();
  }
});
