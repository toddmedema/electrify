import { expect, Locator } from "@playwright/test";

/** Measure rendered text/icon color with translucent backgrounds composited over their ancestors. */
export async function foregroundContrast(locator: Locator): Promise<number> {
  const { foreground, backgrounds } = await locator.evaluate((element) => {
    const backgrounds: string[] = [];
    for (
      let surface: Element | null = element;
      surface;
      surface = surface.parentElement
    ) {
      const { backgroundColor } = getComputedStyle(surface);
      backgrounds.push(backgroundColor);
      if (backgroundColor.startsWith("rgb(")) break;
    }
    return { foreground: getComputedStyle(element).color, backgrounds };
  });
  let painted = [255, 255, 255];
  for (const background of backgrounds.reverse()) {
    painted = composite(colorChannels(background), painted);
  }
  return rgbContrast(colorChannels(foreground), painted);
}

/** WCAG contrast between computed colors, for text on a painted
 * pseudo-element that foregroundContrast's ancestor walk cannot see. */
export function contrastRatio(
  foreground: string,
  background: string,
  underlay?: string,
): number {
  const surface = colorChannels(background);
  return rgbContrast(
    colorChannels(foreground),
    underlay ? composite(surface, colorChannels(underlay)) : surface,
  );
}

function composite(
  [red, green, blue, alpha]: number[],
  underlay: number[],
): number[] {
  return [red, green, blue].map(
    (value, channel) => value * alpha + underlay[channel] * (1 - alpha),
  );
}

function colorChannels(color: string): number[] {
  const [red, green, blue, alpha = 1] = color
    .match(/-?\d+(?:\.\d+)?/g)!
    .map(Number);
  const scale = color.startsWith("color(srgb ") ? 255 : 1;
  return [red * scale, green * scale, blue * scale, alpha];
}

function rgbContrast(foreground: number[], background: number[]): number {
  const luminance = (rgb: number[]) => {
    const [red, green, blue] = rgb.slice(0, 3).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 1.4.3 uses a 3:1 floor for at least 14pt bold or 18pt regular. */
export async function expectReadableText(
  locator: Locator,
  minimumRatio = 3,
): Promise<void> {
  const floor = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    return size >= 24 || (bold && size >= (14 * 96) / 72) ? 3 : 4.5;
  });
  expect(
    await foregroundContrast(locator),
    `contrast of ${(await locator.textContent())?.trim()}`,
  ).toBeGreaterThanOrEqual(Math.max(minimumRatio, floor));
}
