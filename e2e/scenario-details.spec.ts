import { reviewScreenshot } from "./review-screenshot";
import { openPane } from "./layout";
import { expectDialogToFit } from "./dialog-layout";
import { expect, test } from "./fixtures";
import { editSavedGame, readSavedGame } from "./save-fixture";

for (const theme of ["light", "dark"] as const) {
  test(`scenario tool reflows and dismisses in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      window.localStorage.clear();
      window.localStorage.setItem("theme", mode);
      window.localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game" }).click();
    // The dock's Scenario tool is the way into the full requirements
    const details = page
      .locator("#navfooter:visible")
      .getByRole("button", { name: "Scenario", exact: true })
      .first();
    const panel = page.getByRole("region", { name: "Scenario", exact: true });
    await openPane(panel, details);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Wildfire Emergency");
    await expect(
      panel.getByRole("status", { name: "Scenario forecast" }),
    ).toHaveAttribute("data-status", /^(win|loss|unknown)$/);
    const requirements = panel.getByRole("region", {
      name: "Goals",
    });
    await expect(requirements).not.toContainText(
      /Projected miss|Projected to meet|Projected loss|Not started|Recorded:|months completed|Delivered customer electricity divided/,
    );
    await expect(
      requirements.getByText(
        "Serving less than 90% of demand for 3 months in a row ends the run.",
        {
          exact: true,
        },
      ),
    ).toBeAttached();
    const outlook = panel.getByRole("region", { name: "Score outlook" });
    await expect(
      outlook.getByRole("img", { name: /Chart of score/ }),
    ).toBeVisible();
    await expect(
      outlook.getByRole("status", { name: "Scenario forecast" }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: testInfo.outputPath(`scenario-score-${theme}.png`),
    });
    await expect(panel).not.toContainText("(partial month)");
    await expect(panel).toBeInViewport({ ratio: 1 });
    await expectDialogToFit(panel);
    await expect(
      panel.getByText(/Breakdown appears after your first month/),
    ).toBeAttached();
    // Like every other tool, it leaves the action bar in place
    await expect(details).toBeInViewport();
    const close = panel.getByRole("button", { name: "Close Scenario" });
    await expect(close).toBeInViewport();
    expect(
      await panel.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    const box = await close.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(
      testInfo.project.use.hasTouch ? 44 : 40,
    );
    await close.click();
    await expect(panel).not.toBeVisible();
    // Scoring needs one completed month, not the wildfire event 35 months later.
    // Observe the real clock crossing the boundary without depending on event-pane layout.
    const appbar = page.locator("#appbar:visible").first();
    await expect(appbar).toContainText(/Jan \d{4}/);
    await appbar
      .getByRole("button", { name: "fast speed", exact: true })
      .click();
    await expect(appbar).toContainText(/Feb \d{4}/);
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "pause", exact: true })
      .first()
      .click();
    await details.click();
    const score = panel.getByRole("region", { name: "Score breakdown" });
    await expect(score).not.toContainText(
      "Breakdown appears after your first month.",
    );
    await expect(score.locator("dt")).toHaveText([
      "Service",
      "Financial performance",
      "Environmental impact",
    ]);
    await expect(score).not.toContainText("final customers");
    await expect(score.getByText(/points? per/).first()).toBeAttached();
    await expect(
      panel.getByRole("region", { name: "Score outlook" }),
    ).toContainText("Projected final");
    await expect(panel).toBeInViewport({ ratio: 1 });
    await expectDialogToFit(panel);
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await details.click();
    await expect(panel).toBeVisible();
    await details.click();
    await expect(panel).not.toBeVisible();
  });
}

test("scenario outlook flags insolvency with the first projected month-end", async ({
  page,
}, testInfo) => {
  if (!testInfo.project.use.hasTouch)
    await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=111");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => Boolean(await readSavedGame(page))).toBe(true);
  await editSavedGame(page, (save) => {
    save.game.lowCashWarningMonth = save.game.date.monthsElapsed;
    for (const tick of save.game.timeline) tick.cash = -10_000_000;
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const panel = page.getByRole("region", { name: "Scenario", exact: true });
  await openPane(
    panel,
    page
      .locator("#navfooter:visible")
      .getByRole("button", { name: "Scenario", exact: true })
      .first(),
  );
  const outlook = panel.getByRole("region", { name: "Score outlook" });
  const failure = outlook.getByRole("status", { name: "Scenario forecast" });
  await expect(failure.locator("strong")).toHaveText("Projected loss:");
  await expect(failure.locator("svg")).toBeVisible();
  await expect(outlook).not.toContainText("If you build nothing");
  await expect(failure.getByRole("listitem").first()).toContainText(
    /Cash below \$0 by \w+ \d{4}\./,
  );
  await expect(
    outlook.getByRole("img", { name: /Projected loss periods shaded/ }),
  ).toBeVisible();
  await expect(panel.getByRole("region", { name: "Goals" })).not.toContainText(
    "Projected miss",
  );
  if (!testInfo.project.use.hasTouch) {
    await expect(page.locator(".gameStage")).toHaveAttribute(
      "data-layout",
      "side",
    );
    const bounds = (await panel.boundingBox())!;
    expect(bounds.width).toBeLessThan(1920 / 2);
  }
  await expectDialogToFit(panel);
  await page.screenshot({
    path: testInfo.outputPath(
      testInfo.project.use.hasTouch
        ? "scenario-score-bankruptcy-mobile.png"
        : "scenario-score-sidepanel-desktop.png",
    ),
  });
});

test("score outlook keeps its prediction and height while refreshing", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
    const controls = window as typeof window & {
      holdScenarioForecast: boolean;
      releaseScenarioForecast: () => void;
    };
    controls.holdScenarioForecast = false;
    const replies: Array<() => void> = [];
    controls.releaseScenarioForecast = () => {
      controls.holdScenarioForecast = false;
      replies.splice(0).forEach((reply) => reply());
    };
    // Hold real worker replies so the intermediate layout can be inspected deterministically.
    window.Worker = class extends Worker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (!controls.holdScenarioForecast || !event.data?.transport) return;
          event.stopImmediatePropagation();
          replies.push(() =>
            this.dispatchEvent(
              new MessageEvent("message", { data: event.data }),
            ),
          );
        });
      }
    };
  });
  await page.goto("/?scenario=111");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const panel = page.getByRole("region", { name: "Scenario", exact: true });
  await openPane(
    panel,
    page
      .locator("#navfooter")
      .getByRole("button", { name: "Scenario", exact: true }),
  );
  const outlook = panel.getByRole("region", { name: "Score outlook" });
  const outcome = outlook.getByRole("status", { name: "Scenario forecast" });
  await expect(outcome).toHaveAttribute("data-status", /^(win|loss|unknown)$/);
  const before = await outlook.boundingBox();
  const figures = await outlook.locator("dl").innerText();
  const prediction = await outcome.innerText();
  await page.evaluate(() =>
    Object.assign(window, { holdScenarioForecast: true }),
  );
  const bar = page.locator("#appbar:visible");
  await bar.getByRole("button", { name: "fast speed", exact: true }).click();
  await expect(bar).toContainText(/Feb \d{4}/);
  await bar.getByRole("button", { name: "pause", exact: true }).click();
  const updating = outlook.getByRole("status", {
    name: "Updating score outlook",
  });
  await expect(updating).toBeVisible();
  await expect(outlook.locator("dl")).toHaveText(figures, {
    useInnerText: true,
  });
  await expect(outcome).toHaveText(prediction, { useInnerText: true });
  expect((await outlook.boundingBox())!.height).toBeCloseTo(before!.height, 0);
  const title = await outlook
    .getByRole("heading", { name: "Score outlook", exact: true })
    .boundingBox();
  const label = await updating.boundingBox();
  expect(label!.x).toBeGreaterThan(title!.x + title!.width);
  expect(
    Math.abs(label!.y + label!.height / 2 - title!.y - title!.height / 2),
  ).toBeLessThanOrEqual(1);
  await reviewScreenshot(page, {
    path: info.outputPath("score-outlook-updating.png"),
    animations: "disabled",
  });
  await page.evaluate(() =>
    (
      window as typeof window & { releaseScenarioForecast: () => void }
    ).releaseScenarioForecast(),
  );
  await expect(updating).toHaveCount(0);
  await expect(outcome).toHaveAttribute("data-status", /^(win|loss|unknown)$/);
});
