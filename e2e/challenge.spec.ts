import path from "path";
import { expect, test, Page } from "@playwright/test";
import manifest from "../src/data/RunCompatibility.json";

function invitation(scenarioId = 101, seed = 42, target = 12400) {
  return {
    invitationSchemaVersion: 1,
    run: {
      identitySchemaVersion: 1,
      scenarioId,
      scenarioRevision: manifest.compatibilityId,
      seed,
      difficulty: "CEO",
      compatibilityId: manifest.compatibilityId,
      optionsProfile: "canonical-v1",
    },
    target,
  };
}
function link(value = invitation()) {
  return `/?challenge=${encodeURIComponent(JSON.stringify(value))}&utm_campaign=friend`;
}
async function savedGame(page: Page) {
  return page.evaluate(() => {
    const saved = localStorage.getItem("savedGame");
    return saved ? JSON.parse(saved).game : undefined;
  });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("audioEnabled", "false");
  });
});

test("an active run stays paused while browsing and cancelling a challenge", async ({
  page,
}) => {
  await page.goto("/?scenario=101");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible();
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "fast speed", exact: true })
    .first()
    .click();
  await page.waitForTimeout(250);
  await page.evaluate((href) => {
    history.pushState(null, "", href);
    dispatchEvent(new PopStateEvent("popstate"));
  }, link());
  await expect(
    page.getByRole("button", { name: "Start challenge", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
  const before = await savedGame(page);
  expect(before.speed).toBe("PAUSED");
  await page
    .getByRole("button", { name: "Start challenge", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Start a new game?" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.waitForTimeout(500);
  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
  expect((await savedGame(page)).date.minute).toBe(before.date.minute);
  expect((await savedGame(page)).runIdentity).toEqual(before.runIdentity);
  await expect(
    page.getByRole("button", { name: "back", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "back", exact: true }).click();
  await page
    .getByRole("button", { name: "All challenges", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "View Wildfire Emergency details",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "back", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a game", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
  expect((await savedGame(page)).date.minute).toBe(before.date.minute);
  expect((await savedGame(page)).speed).toBe("PAUSED");
  await page
    .getByRole("button", { name: "View Custom Game details", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "back", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a game", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
  expect((await savedGame(page)).date.minute).toBe(before.date.minute);
  expect((await savedGame(page)).runIdentity).toEqual(before.runIdentity);
  await page.evaluate((href) => {
    history.pushState(null, "", href);
    dispatchEvent(new PopStateEvent("popstate"));
  }, link());
  await page
    .getByRole("button", { name: "Continue saved game", exact: true })
    .click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`challenge briefing and actual start in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (mode) => localStorage.setItem("theme", mode),
      theme,
    );
    const value =
      theme === "light" ? invitation() : invitation(107, 268107, -10);
    await page.goto(link(value));
    const start = page.getByRole("button", {
      name: "Start challenge",
      exact: true,
    });
    await expect(start).toBeVisible();
    await expect(
      page.getByText("Shared score · unverified", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("group", { name: "Difficulty" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Log in", exact: true }),
    ).toHaveCount(0);
    expect(await savedGame(page)).toBeUndefined();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const size = await start.boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(
      info.project.use.hasTouch ? 44 : 40,
    );
    const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      reviewDir &&
      ((theme === "light" && info.project.name === "desktop-chromium") ||
        (theme === "dark" && info.project.name === "mobile-390px"))
    ) {
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(
          reviewDir,
          `challenge-${info.project.name}-${theme}.png`,
        ),
      });
    }
    await start.click();
    await expect
      .poll(async () => (await savedGame(page))?.seed)
      .toBe(value.run.seed);
    const game = await savedGame(page);
    expect(game.scenarioId).toBe(value.run.scenarioId);
    expect(game.difficulty).toBe("CEO");
    expect(game.challenge).toEqual(value);
    expect(game.runIdentity.inputs.location).toEqual(game.location);
    expect(game.runIdentity.seed).toBe(value.run.seed);
    expect(game.facilities.length).toBeGreaterThan(0);
    await page.reload();
    await page
      .getByRole("button", { name: /Continue/ })
      .first()
      .click();
    await expect
      .poll(async () => (await savedGame(page))?.challenge)
      .toEqual(value);
  });
}

test("landing, history and cancelled overwrite preserve the save", async ({
  page,
}) => {
  await page.goto("/?scenario=111");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => (await savedGame(page))?.scenarioId).toBe(111);
  await page.goto(link());
  const before = await savedGame(page);
  await expect(
    page.getByRole("button", { name: "Continue saved game" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start challenge", exact: true })
    .click();
  const guard = page.getByRole("dialog", { name: "Start a new game?" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await savedGame(page)).toEqual(before);
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Start challenge", exact: true }),
  ).toHaveCount(0);
  await page.goForward();
  await expect(
    page.getByRole("button", { name: "Start challenge", exact: true }),
  ).toBeVisible();
  expect(await savedGame(page)).toEqual(before);
  await page.getByRole("button", { name: "Continue saved game" }).click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible();
  expect((await savedGame(page)).scenarioId).toBe(111);
  expect(page.url()).not.toContain("challenge=");
  await page.goto(link());
  await page
    .getByRole("button", { name: "Start challenge", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Start a new game?" })
    .getByRole("button", { name: "Start new game", exact: true })
    .click();
  await expect.poll(async () => (await savedGame(page))?.scenarioId).toBe(101);
  expect((await savedGame(page)).seed).toBe(42);
  expect((await savedGame(page)).challenge).toEqual(invitation());
});

test("incompatible invitations require an explicit ordinary mission choice", async ({
  page,
}) => {
  const value = invitation();
  value.run.compatibilityId = "old-model";
  await page.goto(link(value));
  await expect(
    page.getByRole("heading", { name: "Challenge unavailable" }),
  ).toBeVisible();
  expect(await savedGame(page)).toBeUndefined();
  await page
    .getByRole("button", { name: "Open current mission", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start game", exact: true }),
  ).toBeVisible();
  expect(page.url()).not.toContain("challenge=");
  expect(await savedGame(page)).toBeUndefined();
});

test("mismatched market bytes cannot initialize an equivalent challenge", async ({
  page,
}) => {
  await page.route("**/data/EconomyRaw.csv", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n` });
  });
  await page.goto(link());
  await page
    .getByRole("button", { name: "Start challenge", exact: true })
    .click();
  await expect(
    page.getByText(/Could not load the economic record/),
  ).toBeVisible();
  expect(await savedGame(page)).toBeUndefined();
});
