import { expectDialogToFit } from "./dialog-layout";
import { expect, Locator, test } from "./fixtures";
import { openBuild } from "./layout";

async function expectTextToFit(elements: Locator) {
  await expect(elements.first()).toBeVisible();
  const overflow = await elements.evaluateAll((nodes) =>
    nodes.flatMap((el) => {
      const box = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      const range = document.createRange();
      range.selectNodeContents(el);
      const outside = Array.from(range.getClientRects()).some(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          (rect.left < box.left + parseFloat(css.paddingLeft) - 1 ||
            rect.right > box.right - parseFloat(css.paddingRight) + 1 ||
            rect.top < box.top + parseFloat(css.paddingTop) - 1 ||
            rect.bottom > box.bottom - parseFloat(css.paddingBottom) + 1),
      );
      return outside ? [el.textContent] : [];
    }),
  );
  expect(
    overflow,
    "text must fit its box, including every wrapped line",
  ).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((mode) => {
        localStorage.clear();
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
      }, theme);
      await page.goto("/?scenario=100");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await page.getByRole("button", { name: "pause", exact: true }).click();
      await openBuild(page);
      await expect(page.locator("main.base_main")).toHaveCount(1);
    });

    test(`Build keeps its title and shared cash and speed controls readable in ${theme}`, async ({
      page,
    }, info) => {
      const build = page.getByRole("region", { name: "Build", exact: true });
      const header = build.locator(".gameToolHeader");
      const title = header.getByRole("heading", { name: "Build", exact: true });
      const close = header.getByRole("button", {
        name: "Close Build",
        exact: true,
      });
      const hud = page.locator("#topbar");
      const status = hud.locator(".gameStatus");
      const speeds = hud.getByRole("group", {
        name: "game speed",
        exact: true,
      });
      const cash = status.locator(".gameStatusValue").first();
      await expect(speeds).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await build.evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished),
        );
      });
      // Separate boundingBox calls can straddle animation frames and invent a misalignment.
      // Sample the actual controls together, keeping the one-pixel alignment contract.
      const [heading, dismiss, hudBar, statusBox, clock] =
        await header.evaluate((element) => {
          const controls = [
            element.querySelector("h2"),
            element.querySelector('button[aria-label="Close Build"]'),
            document.querySelector("#topbar"),
            document.querySelector("#topbar .gameStatus"),
            document.querySelector(
              '#topbar [role="group"][aria-label="game speed"]',
            ),
          ];
          return controls.map((control) => {
            if (!control)
              throw new Error("Build header or HUD control is missing");
            const { x, y, width, height } = control.getBoundingClientRect();
            return { x, y, width, height };
          });
        });
      // The tool header has a separator below its 56px control area.
      expect(
        await header.evaluate((element) => element.clientHeight),
      ).toBeLessThanOrEqual(56);
      expect(hudBar.height).toBeLessThanOrEqual(56);
      expect(
        Math.abs(
          heading.y + heading.height / 2 - dismiss.y - dismiss.height / 2,
        ),
      ).toBeLessThanOrEqual(1);
      expect(heading.x + heading.width + 8).toBeLessThanOrEqual(dismiss.x);
      expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(clock.x + 1);
      expect(clock.x + clock.width).toBeLessThanOrEqual(
        hudBar.x + hudBar.width,
      );
      await expectTextToFit(title);
      await expectTextToFit(status.locator(".gameStatusValue"));
      await expect(hud).toBeInViewport();
      await expect(header).toBeInViewport();
      if (info.project.use.hasTouch) {
        for (const button of [
          ...(await speeds.getByRole("button").all()),
          close,
        ]) {
          const box = (await button.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }
      await page.screenshot({
        path: info.outputPath(`build-header-${theme}.png`),
        animations: "disabled",
      });
      // Stress the same layout with the formatter's wider negative-balance text.
      // This probe changes only text, keeping the real header, styles and controls.
      await cash.evaluate((el) => {
        el.textContent = "$-9.99M";
      });
      await expectTextToFit(status.locator(".gameStatusValue"));
      const cashBox = (await cash.boundingBox())!;
      expect(cashBox.x + cashBox.width + 4).toBeLessThanOrEqual(clock.x);
    });

    test(`purchase explanations and long titles wrap in ${theme}`, async ({
      page,
    }, info) => {
      for (const [category, name] of [
        ["Generators", "Solar"],
        ["Generators", "Natural Gas CC"],
        ["Storage", "Pumped Hydro"],
        ["Interties", "Pacific Northwest intertie"],
      ]) {
        await page.getByRole("tab", { name: category, exact: true }).click();
        await page
          .getByRole("button", {
            name: `Review purchase of ${name}`,
            exact: true,
          })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(page.locator(".MuiDialog-root")).toHaveCSS("opacity", "1");
        await expectDialogToFit(dialog);
        const content = dialog.locator(".MuiDialogContent-root");
        expect(
          await content.evaluate((el) => el.scrollWidth - el.clientWidth),
        ).toBeLessThanOrEqual(1);
        await expectTextToFit(
          dialog.locator(
            ".resilienceBuildOptionDetail, .closableDialogTitleText, .decisionImpactFact strong",
          ),
        );
        const title = (await dialog
          .locator(".closableDialogTitleText")
          .boundingBox())!;
        const close = (await dialog
          .getByRole("button", { name: "close", exact: true })
          .boundingBox())!;
        expect(title.x + title.width + 7).toBeLessThanOrEqual(close.x);
        if (name === "Solar") {
          const description = dialog.getByText(
            "Follows the sun for about 20% more morning and evening power.",
            { exact: true },
          );
          await expect(description).toBeVisible();
          if (page.viewportSize()!.width < 600) {
            const lines = await description.evaluate(
              (el) =>
                el.getBoundingClientRect().height /
                parseFloat(getComputedStyle(el).lineHeight),
            );
            expect(lines).toBeGreaterThan(1);
          }
          await page.screenshot({
            path: info.outputPath(`solar-purchase-${theme}.png`),
            animations: "disabled",
          });
        }
        await dialog
          .getByRole("button", { name: "close", exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
      }
    });

    test(`generator detail labels and values fit their columns in ${theme}`, async ({
      page,
    }, info) => {
      const details = page.getByRole("button", { name: /^Show .* details$/ });
      while (await details.count()) await details.first().click();
      await expect(
        page.locator(".MuiCollapse-root:not(.MuiCollapse-entered)"),
      ).toHaveCount(0);
      await expectTextToFit(
        page.locator(".buildDetailLabel, .buildDetailValue"),
      );
      const gas = page.locator(".buildOption").filter({
        has: page.getByRole("button", {
          name: "Review purchase of Natural Gas CC",
          exact: true,
        }),
      });
      await gas
        .getByRole("rowheader", { name: "Non-fuel start cost", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`generator-details-${theme}.png`),
        animations: "disabled",
      });
    });
  });
}
