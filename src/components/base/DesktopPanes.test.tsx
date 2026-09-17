import { constrainedPaneWidths } from "./DesktopPanes";

test("constrains default and saved layouts while preserving available width", () => {
  for (const weights of [
    [1, 2],
    [1, 2, 0.8],
    [100, 1, 1],
  ]) {
    for (const total of [480, 758, 1014, 1430, 1900]) {
      const widths = constrainedPaneWidths(weights, total);
      expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(total);
      widths.forEach((width) =>
        expect(width).toBeGreaterThanOrEqual(
          Math.min(240, total / weights.length) - 0.001,
        ),
      );
    }
  }
});

test("retains requested proportions when every pane has enough room", () => {
  expect(constrainedPaneWidths([1, 2, 1], 1200)).toEqual([300, 600, 300]);
});
