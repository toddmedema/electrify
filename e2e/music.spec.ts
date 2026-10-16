import { expect, Page, test } from "./fixtures";

declare global {
  interface Window {
    electrifyMusicStarts: { duration: number; loop: boolean }[];
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "true");
    window.electrifyMusicStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (
      this: AudioBufferSourceNode,
      ...args: Parameters<AudioBufferSourceNode["start"]>
    ) {
      if (this.buffer && this.buffer.duration > 20) {
        window.electrifyMusicStarts.push({
          duration: this.buffer.duration,
          loop: this.loop,
        });
      }
      start.apply(this, args);
    };
  });
});

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
  for (const title of ["Manual", "Settings", "Achievements"]) {
    await page.getByRole("button", { name: title, exact: true }).click();
    const heading = page.getByRole("heading", { name: title, exact: true });
    await expect(heading).toBeVisible();
    await expect(page.locator("main.base_main")).toHaveCount(1);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.locator("#menuCard")).toBeVisible();
    await expect(heading).toHaveCount(0);
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
});
