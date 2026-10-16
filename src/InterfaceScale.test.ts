import { getInterfaceScale, normalizeInterfaceScale } from "./InterfaceScale";
import { chartFont, chartScale } from "./components/base/UPlotHelpers";

afterEach(() => {
  delete document.documentElement.dataset.interfaceScale;
});

test("ignores unknown preferences and scales chart geometry and text together", () => {
  expect(normalizeInterfaceScale(2)).toBe(1);
  expect(normalizeInterfaceScale(NaN)).toBe(1);
  document.documentElement.dataset.interfaceScale = "1.5";
  expect(getInterfaceScale()).toBe(1.5);
  expect(chartFont()).toMatch(/^17px /);
  expect(chartScale(700)).toBeCloseTo(2.1);
  document.documentElement.dataset.interfaceScale = "1";
  expect(chartFont()).toMatch(/^11px /);
  expect(chartScale(700)).toBe(1.4);
});
