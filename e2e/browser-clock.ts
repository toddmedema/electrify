import type { Page } from "@playwright/test";

/** After installing the clock, pause it so tests can drive frames with runFor. */
export async function pauseBrowserClock(page: Page) {
  // Freezing wall time keeps a delayed pause RPC from targeting the past.
  const time = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(time);
  await page.clock.pauseAt(time);
  await page.clock.setSystemTime(time);
}
