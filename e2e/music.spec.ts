import { installMusicAudit } from "./music-audit";
import { expect, Page, test } from "./fixtures";
import { writeFile } from "node:fs/promises";

// Let the real audio clock run before the first gesture in headless Chromium.
// These tests exercise playback continuity rather than browser autoplay permission.
test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});
// Readiness checks include three six-minute stems before gameplay assertions.
// Leave room for that setup on CI without relaxing any navigation assertion.
test.setTimeout(90000);

test.beforeEach(async ({ page }) => {
  await installMusicAudit(page);
});

test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  const startupPath = testInfo.outputPath("music-startup.json");
  await writeFile(
    startupPath,
    JSON.stringify(
      await page.evaluate(() => window.electrifyMusicDecodes),
      null,
      2,
    ),
  );
  await testInfo.attach("music-startup", {
    path: startupPath,
    contentType: "application/json",
  });
});

async function playbackSnapshot(page: Page) {
  return page.evaluate(() => ({
    document: window.electrifyMusicDocument,
    starts: window.electrifyMusicStarts,
    active: window.electrifyMusicPlayback.flatMap((entry, index) =>
      entry.stopped || entry.ended
        ? []
        : [
            {
              id: index,
              state: entry.source.context.state,
              position:
                entry.offset +
                entry.source.context.currentTime -
                entry.startTime,
            },
          ],
    ),
  }));
}

async function expectContinuousMusic(
  page: Page,
  before: Awaited<ReturnType<typeof playbackSnapshot>>,
) {
  // A document reload would reset the probe and could otherwise make source counts look equal.
  await expect(async () => {
    const after = await playbackSnapshot(page);
    expect(after.document).toBe(before.document);
    expect(after.starts).toEqual(before.starts);
    expect(after.active.map((entry) => entry.id)).toEqual(
      before.active.map((entry) => entry.id),
    );
    for (const [index, entry] of after.active.entries()) {
      expect(entry.state).toBe("running");
      expect(entry.position).toBeGreaterThan(
        before.active[index].position + 0.05,
      );
    }
  }).toPass({ timeout: 5000 });
  return playbackSnapshot(page);
}

async function expectMenuMusic(page: Page) {
  // Fetching is quick on localhost, but decoding the full soundtrack can exceed
  // the normal UI timeout on macOS runners. Wait for real decoder completion;
  // retain the pending/error details in failures instead of guessing from starts.
  await expect
    .poll(() => page.evaluate(() => window.electrifyMusicDecodes), {
      message: "All soundtrack files finish decoding before playback checks",
      timeout: 60000,
    })
    .toEqual(
      Array.from({ length: 4 }, () =>
        expect.objectContaining({ state: "decoded" }),
      ),
    );
  await expect
    .poll(() => page.evaluate(() => window.electrifyMusicStarts))
    .toHaveLength(1);
  const [music] = await page.evaluate(() => window.electrifyMusicStarts);
  expect(music.duration).toBeCloseTo(43.63637, 3);
  expect(music.loop).toBe(true);
}

test("menus keep the calm loop without advancing to gameplay music", async ({
  page,
}) => {
  await page.goto("/");
  await expectMenuMusic(page);
  let playback = await playbackSnapshot(page);
  expect(playback.active).toHaveLength(1);
  for (const [index, title] of [
    "Manual",
    "Settings",
    "Achievements",
  ].entries()) {
    await page.getByRole("button", { name: title, exact: true }).click();
    const heading = page.getByRole("heading", { name: title, exact: true });
    await expect(heading).toBeVisible();
    await expect(page.locator("main.base_main")).toHaveCount(1);
    if (title === "Settings") {
      await page.getByRole("button", { name: "Dark", exact: true }).click();
      await page
        .getByRole("slider", { name: "Music volume" })
        .press("ArrowLeft");
    }
    if (index === 0)
      await page.getByRole("button", { name: "Back", exact: true }).click();
    else if (index === 1) await page.keyboard.press("Escape");
    else await page.goBack();
    await expect(page.locator("#menuCard")).toBeVisible();
    await expect(heading).toHaveCount(0);
    playback = await expectContinuousMusic(page, playback);
  }
  await page.clock.install();
  await page.clock.fastForward(90000);
  await expectMenuMusic(page);
});

test("starting a game selects the existing song and quitting restores the menu loop", async ({
  page,
}) => {
  await page.goto("/?scenario=111");
  await expectMenuMusic(page);
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".gameMenuButton")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.electrifyMusicStarts))
    .toHaveLength(4);
  const gameplay = await page.evaluate(() =>
    window.electrifyMusicStarts.slice(1),
  );
  for (const music of gameplay) {
    expect(music.loop).toBe(true);
    expect(music.duration).toBeGreaterThan(391);
    expect(music.offset).toBe(0);
  }
  await page.locator(".gameMenuButton").click();
  await page
    .getByRole("menuitem", { name: "Save & Quit", exact: true })
    .click();
  await expect(page.locator("#menuCard")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.electrifyMusicStarts))
    .toHaveLength(5);
  const returned = await page.evaluate(() =>
    window.electrifyMusicStarts.at(-1)!,
  );
  expect(returned.loop).toBe(true);
  expect(returned.duration).toBeCloseTo(43.63637, 3);
  expect(returned.offset).toBe(0);
});

test("gameplay sources and playheads survive card changes and all Back paths", async ({
  page,
}) => {
  await page.goto("/");
  await expectMenuMusic(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page
    .getByRole("button", { name: "All challenges", exact: true })
    .click();
  await page.getByTestId("mission-row-111").click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".gameMenuButton")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.electrifyMusicStarts))
    .toHaveLength(4);
  let playback = await playbackSnapshot(page);
  expect(playback.active).toHaveLength(3);

  for (const key of ["r", "w", "q"]) {
    await page.keyboard.press(key);
    playback = await expectContinuousMusic(page, playback);
  }
  await page.keyboard.press("g");
  await expect(page.locator(".buildOption").first()).toBeVisible();
  const closeBuild = page.getByRole("button", {
    name: "Close Build",
    exact: true,
  });
  await closeBuild.focus();
  await expect(closeBuild).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".buildOption")).toHaveCount(0);
  playback = await expectContinuousMusic(page, playback);

  for (const [index, title] of [
    "Settings",
    "Manual",
    "Saved games",
  ].entries()) {
    await page.locator(".gameMenuButton").click();
    await page.getByRole("menuitem", { name: title, exact: true }).click();
    const heading = page.getByRole("heading", { name: title, exact: true });
    await expect(heading).toBeVisible();
    await expect(page.locator("main.base_main")).toHaveCount(1);
    if (index === 0)
      await page.getByRole("button", { name: "Back", exact: true }).click();
    else if (index === 1) await page.keyboard.press("Escape");
    else await page.goBack();
    await expect(heading).toHaveCount(0);
    playback = await expectContinuousMusic(page, playback);
  }
});

test("a suspended audio clock does not restart gameplay early", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/?scenario=111");
  await expectMenuMusic(page);
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".gameMenuButton")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.electrifyMusicStarts))
    .toHaveLength(4);
  await expect
    .poll(async () => (await playbackSnapshot(page)).active[0].position)
    .toBeGreaterThan(0.1);
  await page.evaluate(async () => {
    const contexts = new Set(
      window.electrifyMusicPlayback.map((entry) => entry.source.context),
    );
    await Promise.all(
      [...contexts].map((context) => (context as AudioContext).suspend()),
    );
  });
  const before = await playbackSnapshot(page);
  expect(before.active).toHaveLength(3);
  expect(before.active.map((entry) => entry.state)).toEqual([
    "suspended",
    "suspended",
    "suspended",
  ]);
  // Advance the loop timer while the real audio clock stays at the saved playhead.
  await page.clock.fastForward(392119);
  const after = await playbackSnapshot(page);
  expect(after.starts).toEqual(before.starts);
  expect(after.active).toEqual(before.active);
  await page.evaluate(async () => {
    const contexts = new Set(
      window.electrifyMusicPlayback.map((entry) => entry.source.context),
    );
    await Promise.all(
      [...contexts].map((context) => (context as AudioContext).resume()),
    );
  });
  await expectContinuousMusic(page, before);
});

test("first tutorial keeps its sources through the real native song boundary", async ({
  page,
}) => {
  await page.goto("/");
  await expectMenuMusic(page);
  await page.evaluate(() => {
    localStorage.removeItem("plays");
    window.electrifyMusicSeekTail = true;
  });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".tutorialHud")).toBeVisible();
  await expect
    .poll(async () => (await playbackSnapshot(page)).active.length)
    .toBe(3);
  const before = await playbackSnapshot(page);
  const durations = before.starts.slice(-3).map((entry) => entry.duration);
  expect(new Set(durations).size).toBe(1);
  await expect
    .poll(async () => (await playbackSnapshot(page)).active[0]?.position)
    .toBeGreaterThan(durations[0] + 0.3);
  await expectContinuousMusic(page, before);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expectContinuousMusic(page, before);
});
