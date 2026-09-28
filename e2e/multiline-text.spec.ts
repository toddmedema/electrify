import { expect, Locator, test } from "@playwright/test";
import { openPane } from "./layout";

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
      const fleet = page.locator(".facilities:visible");
      await openPane(
        fleet,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
      await fleet.getByRole("button", { name: "Build", exact: true }).click();
      await expect(page.locator("main.base_main")).toHaveCount(1);
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
        page.locator(".generatorDetailLabel, .generatorDetailValue"),
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
