import { expect, Locator } from "@playwright/test";

/** Content must resolve to the same visible surface as the dialog chrome. */
export async function expectContinuousDialogSurface(dialog: Locator) {
  const surfaces = await dialog.evaluate((paper) => {
    const visibleBackground = (element: Element): string => {
      const style = getComputedStyle(element);
      if (style.backgroundImage !== "none") return style.backgroundImage;
      if (
        style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        style.backgroundColor !== "transparent"
      ) {
        return style.backgroundColor;
      }
      return element.parentElement
        ? visibleBackground(element.parentElement)
        : "transparent";
    };
    return {
      paper: visibleBackground(paper),
      sections: Array.from(
        paper.querySelectorAll(
          ".MuiDialogTitle-root, .MuiDialogContent-root, .MuiDialogActions-root, .decisionImpact, .decisionImpactFact",
        ),
      ).map(visibleBackground),
    };
  });
  expect(surfaces.sections.length).toBeGreaterThan(3);
  for (const surface of surfaces.sections) expect(surface).toBe(surfaces.paper);
}
