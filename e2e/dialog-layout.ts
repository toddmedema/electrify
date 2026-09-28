import { expect, Locator } from "@playwright/test";

/** Check actual text rectangles: scrollWidth alone misses text clipped by an ancestor. */
export async function expectDialogToFit(dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((el) => {
        const root = el.closest(".MuiModal-root");
        return root ? getComputedStyle(root).opacity : "1";
      }),
    )
    .toBe("1");
  const problems = await dialog.evaluate((paper) => {
    const errors: string[] = [];
    const bounds = paper.getBoundingClientRect();
    if (
      bounds.left < -1 ||
      bounds.right > innerWidth + 1 ||
      bounds.top < -1 ||
      bounds.bottom > innerHeight + 1
    )
      errors.push("Dialog outside viewport");
    for (const el of [
      paper,
      ...Array.from(
        paper.querySelectorAll(
          ".MuiDialogContent-root, .MuiDialogTitle-root, .MuiDialogActions-root",
        ),
      ),
    ]) {
      if (el.scrollWidth > el.clientWidth + 1)
        errors.push("Horizontal overflow: " + el.className);
    }
    const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement!;
      if (
        !node.textContent?.trim() ||
        parent.closest("svg, .srOnly, .MuiInputLabel-root, .MuiInputBase-root")
      )
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (!rect.width || !rect.height) continue;
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
          errors.push("Text outside dialog: " + node.textContent);
      }
    }
    for (const button of Array.from(
      paper.querySelectorAll(".MuiDialogActions-root button"),
    )) {
      const box = button.getBoundingClientRect();
      if (box.width && (box.bottom > innerHeight + 1 || box.top < 0))
        errors.push("Unreachable action: " + button.textContent);
      if (button.scrollWidth > button.clientWidth + 1)
        errors.push("Clipped action: " + button.textContent);
    }
    return errors;
  });
  expect(problems).toEqual([]);
}
