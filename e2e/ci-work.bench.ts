import { test, expect } from "./fixtures";
import fs from "node:fs/promises";
import path from "node:path";
import { reviewScreenshot } from "./review-screenshot";

test("measure optional review capture work on a real production page", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.addInitScript(() => localStorage.setItem("audioEnabled", "false"));
  await page.goto("/?scenario=108");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.locator("#chartSupplyDemand .u-wrap > canvas"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "pause", exact: true })
    .first()
    .click();
  const original = process.env.REVIEW_SCREENSHOT_DIR;
  delete process.env.REVIEW_SCREENSHOT_DIR;
  const samples: Record<string, number[]> = { captureMs: [], optionalMs: [] };
  try {
    for (let round = 0; round < 3; round++) {
      for (const mode of round % 2
        ? ["optionalMs", "captureMs"]
        : ["captureMs", "optionalMs"]) {
        const start = performance.now();
        for (let index = 0; index < 10; index++) {
          const options = {
            path: info.outputPath(`${mode}-${round}-${index}.png`),
            animations: "disabled" as const,
          };
          if (mode === "captureMs") await page.screenshot(options);
          else await reviewScreenshot(page, options);
        }
        samples[mode].push(performance.now() - start);
      }
    }
    const absent = info.outputPath("optionalMs-0-0.png");
    await expect(fs.stat(absent)).rejects.toMatchObject({ code: "ENOENT" });
    const directory = info.outputPath("review");
    process.env.REVIEW_SCREENSHOT_DIR = directory;
    const requested = info.outputPath("requested.png");
    await reviewScreenshot(page, { path: requested });
    expect(
      (
        await fs.stat(
          path.join(
            directory,
            path.basename(path.dirname(requested)),
            "requested.png",
          ),
        )
      ).size,
    ).toBeGreaterThan(0);
    await fs.writeFile(
      info.outputPath("timings.json"),
      JSON.stringify(
        { project: info.project.name, capturesPerSample: 10, ...samples },
        null,
        2,
      ),
    );
  } finally {
    if (original === undefined) delete process.env.REVIEW_SCREENSHOT_DIR;
    else process.env.REVIEW_SCREENSHOT_DIR = original;
  }
});
