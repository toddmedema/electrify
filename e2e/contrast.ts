import { Locator } from "@playwright/test";

/** Measure rendered text/icon color against its nearest painted surface. */
export async function foregroundContrast(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    let surface: Element | null = element;
    while (
      surface &&
      /^rgba\(.*,\s*0\)$|^transparent$/.test(
        getComputedStyle(surface).backgroundColor,
      )
    )
      surface = surface.parentElement;
    const luminance = (rgb: string) => {
      const channels = rgb
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map((channel) => {
          const value = Number(channel) / 255;
          return value <= 0.04045
            ? value / 12.92
            : Math.pow((value + 0.055) / 1.055, 2.4);
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(style.color);
    const background = luminance(
      getComputedStyle(surface ?? document.body).backgroundColor,
    );
    return (
      (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05)
    );
  });
}

/** WCAG contrast between two computed `rgb()` or `rgba()` colors, for text on a painted
 * pseudo-element that foregroundContrast's ancestor walk cannot see. */
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (rgb: string) => {
    const [red, green, blue] = rgb
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((channel) => {
        const value = Number(channel) / 255;
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
