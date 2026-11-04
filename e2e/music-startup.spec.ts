import { expect, test } from "./fixtures";
import { installMusicAudit } from "./music-audit";

test.use({
  launchOptions: { args: ["--autoplay-policy=user-gesture-required"] },
});
test.setTimeout(90000);

async function prepared(page: import("@playwright/test").Page) {
  await expect
    .poll(() => page.evaluate(() => window.electrifyMusicDecodes), {
      timeout: 60000,
    })
    .toEqual(
      Array.from({ length: 4 }, () =>
        expect.objectContaining({ state: "decoded" }),
      ),
    );
}

test("enabling prepared installed-app sound starts on that gesture and quick toggles retain position", async ({
  page,
}) => {
  await installMusicAudit(page, {
    enabled: false,
    installed: true,
    firstTutorial: true,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await prepared(page);
  expect(await page.evaluate(() => window.electrifyMusicStarts)).toHaveLength(
    0,
  );
  // A silent sink can run without autoplay permission in Chromium. Suspend the real clock so
  // this assertion exercises recovery from the state seen on mobile before its first gesture.
  await page.evaluate(() =>
    Promise.all(
      window.electrifyMusicContexts.map((context) => context.suspend()),
    ),
  );
  const sound = page.getByRole("switch", { name: "Sound", exact: true });
  await sound.click();
  await expect
    .poll(() => page.evaluate(() => window.electrifyMusicStarts.length))
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.electrifyMusicPlayback[0].source.context.state,
      ),
    )
    .toBe("running");
  expect(
    await page.evaluate(() =>
      window.electrifyMusicResumes.some((resume) => resume.active),
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.electrifyMusicPlayback[0].source.context.currentTime,
      ),
    )
    .toBeGreaterThan(0.3);
  for (let i = 0; i < 4; i++) {
    const before = await page.evaluate(() => {
      const entry = window.electrifyMusicPlayback.at(-1)!;
      return entry.offset + entry.source.context.currentTime - entry.startTime;
    });
    await sound.click();
    await sound.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.electrifyMusicPlayback.filter(
              (entry) => !entry.stopped && !entry.ended,
            ).length,
        ),
      )
      .toBe(1);
    const resumed = await page.evaluate(() =>
      window.electrifyMusicStarts.at(-1)!,
    );
    expect(resumed.offset).toBeGreaterThanOrEqual(before);
    expect(resumed.offset).toBeLessThan(before + 2);
  }
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".tutorialHud")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.electrifyMusicPlayback.filter(
            (entry) => !entry.stopped && !entry.ended,
          ).length,
      ),
    )
    .toBe(3);
  for (let i = 0; i < 2; i++) {
    const before = await page.evaluate(() => {
      const entry = window.electrifyMusicPlayback.at(-1)!;
      return entry.offset + entry.source.context.currentTime - entry.startTime;
    });
    await page.evaluate(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.all(
        window.electrifyMusicContexts.map((context) => context.suspend()),
      );
    });
    expect(
      await page.evaluate(() =>
        window.electrifyMusicPlayback.filter(
          (entry) => !entry.stopped && !entry.ended,
        ),
      ),
    ).toHaveLength(0);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.electrifyMusicPlayback.filter(
              (entry) =>
                !entry.stopped &&
                !entry.ended &&
                entry.source.context.state === "running",
            ).length,
        ),
      )
      .toBe(3);
    const offset = await page.evaluate(
      () => window.electrifyMusicStarts.at(-1)!.offset,
    );
    expect(offset).toBeGreaterThanOrEqual(Math.max(0, before));
    expect(offset).toBeLessThan(before + 2);
  }
});
test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  await testInfo.attach("audio-lifecycle", {
    body: JSON.stringify(
      await page.evaluate(() => ({
        decodes: window.electrifyMusicDecodes,
        starts: window.electrifyMusicStarts,
        resumes: window.electrifyMusicResumes,
      })),
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("a muted installed app caches every audio file before its first offline sound gesture", async ({
  page,
  context,
}) => {
  await installMusicAudit(page, {
    enabled: false,
    installed: true,
    firstTutorial: true,
  });
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const audio = [
    "intro/intro.mp3",
    "menu/quiet-current.wav",
    "menu/select.wav",
    "menu/confirm.wav",
    "menu/back.wav",
    "basic/low.mp3",
    "basic/medium.mp3",
    "basic/high.mp3",
  ];
  await expect
    .poll(
      () =>
        page.evaluate(async (files) => {
          const results = await Promise.all(
            files.map(async (file) =>
              Boolean(await caches.match(`/audio/${file}`)),
            ),
          );
          return results.every(Boolean);
        }, audio),
      { timeout: 60000 },
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await prepared(page);
  expect(await page.evaluate(() => window.electrifyMusicStarts)).toHaveLength(
    0,
  );
  await page.getByRole("switch", { name: "Sound", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.electrifyMusicPlayback[0]?.source.context.state,
      ),
    )
    .toBe("running");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".tutorialHud")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.electrifyMusicPlayback.filter(
            (entry) => !entry.stopped && !entry.ended,
          ).length,
      ),
    )
    .toBe(3);
});

test.describe("cold gesture startup", () => {
  test.use({ serviceWorkers: "block" });
  test("starts menu music before slow gameplay downloads complete, without another tap", async ({
    page,
  }) => {
    await installMusicAudit(page, {
      enabled: false,
      installed: false,
      firstTutorial: true,
    });
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/audio/basic/**", async (route) => {
      await waiting;
      await route.continue();
    });
    try {
      await page.goto("/");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("switch", { name: "Sound", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.electrifyMusicPlayback[0]?.source.context.state,
          ),
        )
        .toBe("running");
      expect(
        await page.evaluate(() => window.electrifyMusicStarts),
      ).toHaveLength(1);
      expect(
        await page.evaluate(() => window.electrifyMusicDecodes),
      ).toHaveLength(1);
      release();
      await prepared(page);
      expect(
        await page.evaluate(() => window.electrifyMusicStarts),
      ).toHaveLength(1);
    } finally {
      release();
    }
  });
});
