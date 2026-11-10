import { expect, test } from "./fixtures";
import { reviewScreenshot } from "./review-screenshot";

test("unsupported Web Audio disables Sound and reports the reason without gesture retries", async ({
  page,
}, testInfo) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Web Audio API is not supported"))
      warnings.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("audioEnabled", "false");
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const sound = page.getByRole("switch", { name: "Sound", exact: true });
  await sound.click();
  await expect(sound).not.toBeChecked();
  await expect(
    page.getByText("Audio not supported on this device; disabling.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("audioEnabled")))
    .toBe("false");
  await reviewScreenshot(page, {
    path: testInfo.outputPath("unsupported-audio.png"),
  });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(sound).not.toBeChecked();
  expect(warnings).toHaveLength(1);
});

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
