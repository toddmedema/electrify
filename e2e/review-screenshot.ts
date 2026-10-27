import type { Locator, Page } from "@playwright/test";
import path from "node:path";

/** Optional review artifacts. Assertions and failure screenshots run independently. */
export async function reviewScreenshot(
  target: Page | Locator,
  options: NonNullable<Parameters<Page["screenshot"]>[0]> & { path: string },
): Promise<void> {
  const directory = process.env.REVIEW_SCREENSHOT_DIR;
  if (!directory) return;
  await target.screenshot({
    ...options,
    // outputPath's parent identifies the test and viewport, avoiding name collisions.
    path: path.join(
      directory,
      path.basename(path.dirname(options.path)),
      path.basename(options.path),
    ),
  });
}
