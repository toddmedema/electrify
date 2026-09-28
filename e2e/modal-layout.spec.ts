import { expect, test } from "@playwright/test";
import { openPane } from "./layout";
import { expectDialogToFit } from "./dialog-layout";

for (const theme of ["light", "dark"]) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((mode) => {
        localStorage.clear();
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
        localStorage.setItem("installVisits", "2");
      }, theme);
    });

    test("preset dialogs fit even with a maximum-length unbroken name", async ({
      page,
    }, info) => {
      await page.goto("/?scenario=100");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const insights = page.locator(".insights:visible");
      await openPane(
        insights,
        page.getByRole("button", { name: "Insights", exact: true }),
      );
      await insights.getByRole("button", { name: "Preset actions" }).click();
      await page
        .getByRole("menuitem", { name: "Save as new preset", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expectDialogToFit(dialog);
      const field = dialog.getByRole("textbox", { name: "Preset name" });
      const length = Number(await field.getAttribute("maxlength"));
      await field.fill("W".repeat(length));
      await dialog
        .getByRole("button", { name: "Save preset", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      for (const action of ["Rename preset…", "Delete preset…"]) {
        await insights.getByRole("button", { name: "Preset actions" }).click();
        await page.getByRole("menuitem", { name: action, exact: true }).click();
        await expectDialogToFit(dialog);
        await page.screenshot({
          path: info.outputPath(action + ".png"),
          animations: "disabled",
        });
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
      }
    });

    test("facility sale and resilience confirmations fit", async ({
      page,
    }, info) => {
      await page.goto("/?scenario=108");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const fleet = page.locator(".facilities:visible");
      await openPane(
        fleet,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
      const row = fleet.locator(".facilityRow").filter({
        has: page.locator(".facilityName", { hasText: /^Solar$/ }),
      });
      await row.locator(".facilityDisclosure").click();
      await row.getByRole("button", { name: /^Sell/ }).click();
      const dialog = page.getByRole("dialog");
      await expectDialogToFit(dialog);
      await dialog
        .getByRole("button", { name: "Nevermind", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await row.locator(".facilityRetrofit button").click();
      await expectDialogToFit(dialog);
      await page.screenshot({
        path: info.outputPath("retrofit.png"),
        animations: "disabled",
      });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    });

    test("pre-game requirements and replacement confirmation fit", async ({
      page,
    }) => {
      await page.goto("/?scenario=111");
      await page
        .getByRole("button", { name: "What counts as a win", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expectDialogToFit(dialog);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await page.evaluate(() => {
        history.pushState(null, "", "/?scenario=100");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await expectDialogToFit(dialog);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    });

    test("iPhone install instructions fit", async ({ page }, info) => {
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "userAgent", {
          get: () =>
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        }),
      );
      await page.goto("/");
      await page
        .getByRole("button", { name: "Install app", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expectDialogToFit(dialog);
      await page.screenshot({
        path: info.outputPath("install.png"),
        animations: "disabled",
      });
      await dialog.getByRole("button", { name: "Got it", exact: true }).click();
    });
  });
}
