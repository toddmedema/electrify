import { isDesktopScreen, isPaneLayout } from "./Globals";
import { getInterfaceScale, setInterfaceSize } from "./InterfaceSizing";
import { chartFont, chartScale } from "./components/base/UPlotHelpers";

function viewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  window.dispatchEvent(new Event("resize"));
}

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;
afterEach(() => {
  setInterfaceSize("normal");
  viewport(originalWidth, originalHeight);
});

it("gives larger text enough pane space at each layout boundary", () => {
  viewport(1280, 800);
  expect(isPaneLayout()).toBe(true);
  expect(isDesktopScreen()).toBe(false);
  setInterfaceSize("larger");
  expect(isPaneLayout()).toBe(true);
  viewport(1279, 800);
  expect(isPaneLayout()).toBe(false);
  viewport(1625, 900);
  expect(isDesktopScreen()).toBe(true);
  viewport(1624, 900);
  expect(isDesktopScreen()).toBe(false);
  viewport(390, 844);
  expect(isPaneLayout()).toBe(false);
});

it("enlarges canvas font and geometry together without changing CSS pointer coordinates", () => {
  const normalFont = chartFont();
  const normalHeight = chartScale(700);
  setInterfaceSize("larger");
  expect(getInterfaceScale()).toBe(1.25);
  expect(chartFont()).toBe(normalFont.replace("11px", "14px"));
  expect(chartScale(700)).toBe(normalHeight * 1.25);
  expect(chartFont(2)).toContain("28px");
  expect(document.documentElement.style.fontSize).toBe("125%");
  expect(document.documentElement.style.transform).toBe("");
});
