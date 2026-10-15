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
  const widths = constrainedPaneWidths([1, 2, 1], 1200);
  widths.forEach((width, index) =>
    expect(width).toBeCloseTo([300, 600, 300][index]),
  );
});

test("bounds side panels and gives released width to analysis, even for extreme saved ratios", () => {
  for (const scale of [1, 1.25, 1.5]) {
    for (const weights of [
      [1, 2, 0.8],
      [100, 1, 1],
      [1, 1, 100],
    ]) {
      const total = 2000 * scale - 10;
      const widths = constrainedPaneWidths(weights, total, scale);
      expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(total);
      expect(widths[0]).toBeLessThanOrEqual(480 * scale);
      expect(widths[2]).toBeLessThanOrEqual(360 * scale);
      widths.forEach((width) =>
        expect(width).toBeGreaterThanOrEqual(240 * scale - 0.001),
      );
    }
  }
});

test("keeps the full surface usable on scaled tablets and supported foldables", () => {
  for (const total of [690, 834, 1014, 1430]) {
    const widths = constrainedPaneWidths([100, 1], total, 1.5);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(total);
    widths.forEach((width) =>
      expect(width).toBeGreaterThanOrEqual(Math.min(360, total / 2) - 0.001),
    );
  }
});
