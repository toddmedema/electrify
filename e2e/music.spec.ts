import { expect, Page, test } from "./fixtures";

declare global {
  interface Window {
    electrifyMusicDocument: string;
    electrifyMusicStarts: { duration: number; loop: boolean; offset: number }[];
    electrifyMusicPlayback: {
      source: AudioBufferSourceNode;
      startTime: number;
      offset: number;
      stopped: boolean;
      ended: boolean;
    }[];
  }
}

// Let the real audio clock run before the first gesture in headless Chromium.
// These tests exercise playback continuity rather than browser autoplay permission.
test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "true");
    localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [{ scenarioId: 0, timesPlayed: 1, date: new Date().toString() }],
      }),
    );
    window.electrifyMusicDocument = crypto.randomUUID();
    window.electrifyMusicStarts = [];
    window.electrifyMusicPlayback = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (
      this: AudioBufferSourceNode,
      ...args: Parameters<AudioBufferSourceNode["start"]>
    ) {
      if (this.buffer && this.buffer.duration > 20) {
        window.electrifyMusicStarts.push({
          duration: this.buffer.duration,
          loop: this.loop,
          offset: args[1] || 0,
        });
        const playback = {
          source: this,
          startTime: Math.max(this.context.currentTime, args[0] || 0),
          offset: args[1] || 0,
          stopped: false,
          ended: false,
        };
        window.electrifyMusicPlayback.push(playback);
        this.addEventListener(
          "ended",
          () => {
            playback.ended = true;
          },
          { once: true },
        );
      }
      start.apply(this, args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (
      this: AudioBufferSourceNode,
      ...args: Parameters<AudioBufferSourceNode["stop"]>
    ) {
      const playback = window.electrifyMusicPlayback.find(
        (entry) => entry.source === this,
      );
      if (playback) playback.stopped = true;
      stop.apply(this, args);
    };
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
    expect(music.loop).toBe(false);
    expect(music.duration).toBeGreaterThan(392);
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
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
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
