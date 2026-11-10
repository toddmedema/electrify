import { expect, test } from "./fixtures";

test("one online visit stores everything a styled offline launch needs", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const play = page.getByRole("button", { name: "Play" });
  await expect(play).toBeVisible();
  // Activation follows install, which stores the build. A browser HTTP cache could otherwise
  // hide a missing file on this reload, so check the worker's own cache as well.
  await page.evaluate(() => navigator.serviceWorker.ready);
  const uncached = await page.evaluate(async () => {
    const manifest = await (await fetch("/asset-manifest.json")).json();
    const files = Object.values<string>(manifest.files).filter(
      (file) => file.startsWith("/static/") && !/\.(map|txt)$/.test(file),
    );
    const loaded = await Promise.all(
      files.map(async (file) => ((await caches.match(file)) ? "" : file)),
    );
    return loaded.filter(Boolean);
  });
  expect(uncached).toEqual([]);

  await context.setOffline(true);
  await page.reload();

  await expect(play).toBeVisible();
  // The stored fonts and stylesheet replace browser defaults; only app styles hide this heading.
  await expect(page.locator("body")).toHaveCSS("font-family", /Inter/);
  const heading = await page.locator("h1").boundingBox();
  expect(heading!.width).toBeLessThanOrEqual(1);
});
