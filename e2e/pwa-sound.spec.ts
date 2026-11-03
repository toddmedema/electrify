import { expect, test } from "./fixtures";

for (const platform of ["standalone", "ios"]) {
  test(`installed ${platform} PWA enables sound and restores an explicit mute`, async ({
    page,
  }) => {
    await page.addInitScript((platform) => {
      if (platform === "ios") {
        Object.defineProperty(navigator, "standalone", { value: true });
      } else {
        const matchMedia = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const result = matchMedia(query);
          if (query === "(display-mode: standalone)") {
            Object.defineProperty(result, "matches", { value: true });
          }
          return result;
        };
      }
    }, platform);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Turn on sound" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const sound = page.getByRole("switch", { name: "Sound", exact: true });
    await expect(sound).toBeChecked();
    await sound.uncheck();
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(sound).not.toBeChecked();
  });
}
