import { expect, Locator, Page } from "@playwright/test";

/** Drag across real text: a DOM Range alone can select even when CSS forbids user selection. */
export async function selectManualText(page: Page, paragraph: Locator) {
  await paragraph.scrollIntoViewIfNeeded();
  await expect(paragraph).toHaveCSS("user-select", "text");
  // Chromium's mobile emulation does not implement the OS text-selection handles.
  // Verify its selection style here; desktop exercises an actual drag below.
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches))
    return;
  const points = await paragraph.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.trim()) node = walker.nextNode();
    if (!node) throw new Error("Manual paragraph has no text");
    const start = node.textContent!.search(/\S/);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, Math.min(start + 8, node.textContent!.length));
    const rect = range.getBoundingClientRect();
    window.getSelection()?.removeAllRanges();
    return {
      left: rect.left,
      right: rect.right,
      y: rect.top + rect.height / 2,
    };
  });
  await page.mouse.move(points.left, points.y);
  await page.mouse.down();
  await page.mouse.move(points.right, points.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => window.getSelection()?.toString().trim().length || 0),
    )
    .toBeGreaterThan(3);
}
