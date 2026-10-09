import path from "path";
import { expect, Page, test } from "./fixtures";
import { expectDialogToFit } from "./dialog-layout";
import { editSavedGame, readSavedGame, readSaveRecords } from "./save-fixture";

const TITLE = "You're about to run out of cash - raise your rates?";

async function prepareLowCash(page: Page) {
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
  await editSavedGame(page, (save) => {
    save.game.dollarsPerkWh = 0.04;
    save.game.timeline[0].cash = 90_000;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("dialog", { name: TITLE })).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  test(`cash warning pauses play and applies its exact quote in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await prepareLowCash(page);
    const dialog = page.getByRole("dialog", { name: TITLE });
    await expectDialogToFit(dialog);
    const message = await dialog.locator(".MuiDialogContent-root").innerText();
    expect(message).toMatch(
      /You must raise your rates to [\d.]+c\/kWh \(a \d+% increase\) to avoid bankruptcy this month\./,
    );
    const rate = Number(message.match(/to ([\d.]+)c\/kWh/)![1]) / 100;
    for (const button of await dialog.getByRole("button").all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(
        info.project.use.hasTouch ? 44 : 40,
      );
    }
    // Neither dismissal nor speed shortcuts can bypass the decision.
    await page.keyboard.press("Escape");
    await page.keyboard.press("2");
    await expect(dialog).toBeVisible();
    await expect(
      page.locator('button[aria-label="pause"]').first(),
    ).toHaveAttribute("aria-pressed", "true");
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      ((theme === "light" && info.project.name === "desktop-chromium") ||
        (theme === "dark" && info.project.name === "mobile-390px"))
    ) {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `low-cash-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
    await dialog
      .getByRole("button", { name: "Raise rates", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const accepted = (await readSavedGame(page))!;
    expect(accepted.dollarsPerkWh).toBeCloseTo(rate, 10);
    expect(accepted.lowCashWarningMonth).toBe(0);
    // Once the new month starts, low cash can ask again.
    await page.getByRole("button", { name: "fast speed", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Go bankrupt", exact: true })
      .click();
    await page.getByRole("button", { name: "pause", exact: true }).click();
    const after = (await readSavedGame(page))!;
    expect(after.date.monthsElapsed).toBe(1);
    expect(after.lowCashWarningMonth).toBe(1);
    expect(after.dollarsPerkWh).toBeCloseTo(rate, 10);
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator("#appbar:visible")).toBeVisible();
    await expect(dialog).not.toBeVisible();
  });
}

test("the data-center landing page contains the requested shorter copy", async ({
  page,
}, info) => {
  await page.goto("/data-centers.html");
  await expect(page.locator(".hero .eyebrow")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(
    "These decisions get made close to home",
  );
  await expect(page.locator(".community-model-note")).toContainText(
    "Electrify is a simulation. It shows what's possible, but it can't predict a specific project's exact effects.",
  );
  if (
    process.env.REVIEW_SCREENSHOT_DIR &&
    info.project.name === "desktop-chromium"
  ) {
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        "data-center-copy-desktop.png",
      ),
      fullPage: true,
      animations: "disabled",
    });
  }
});
