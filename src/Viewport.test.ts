import { isDesktopScreen, isPaneLayout } from "./Globals";

const originalWidth = Object.getOwnPropertyDescriptor(
  document.documentElement,
  "clientWidth",
);
const originalOverflow = Object.getOwnPropertyDescriptor(
  document.body,
  "scrollWidth",
);
const originalHeight = window.innerHeight;

function viewport(width: number, height = 900) {
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: width,
  });
  window.innerHeight = height;
  window.dispatchEvent(new Event("resize"));
}

afterEach(() => {
  if (originalWidth)
    Object.defineProperty(
      document.documentElement,
      "clientWidth",
      originalWidth,
    );
  else Reflect.deleteProperty(document.documentElement, "clientWidth");
  if (originalOverflow)
    Object.defineProperty(document.body, "scrollWidth", originalOverflow);
  else Reflect.deleteProperty(document.body, "scrollWidth");
  window.innerHeight = originalHeight;
  delete document.documentElement.dataset.interfaceScale;
  window.dispatchEvent(new Event("resize"));
});

test("uses the CSS viewport when a previous layout overflows during a resize", () => {
  Object.defineProperty(document.body, "scrollWidth", {
    configurable: true,
    value: 2560,
  });
  viewport(768, 900);
  expect(isDesktopScreen()).toBe(false);
  expect(isPaneLayout()).toBe(true);
  viewport(390, 844);
  expect(isPaneLayout()).toBe(false);
});

test("keeps pane eligibility while reflowing desktop columns for the chosen size", () => {
  document.documentElement.dataset.interfaceScale = "1.5";
  viewport(1440);
  expect(isPaneLayout()).toBe(true);
  expect(isDesktopScreen()).toBe(false);
  viewport(2560);
  expect(isDesktopScreen()).toBe(true);
  viewport(844, 690);
  expect(isPaneLayout()).toBe(true);
});
