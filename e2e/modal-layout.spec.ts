import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { expectDialogToFit } from "./dialog-layout";
import { SAVE_NAME_LIMIT } from "../src/SaveModel";
import { readSavedGame, readSaveRecords } from "./save-fixture";

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
      for (const action of ["Rename preset…", "Delete custom preset"]) {
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
      await fleet
        .getByRole("button", { name: "Dispatch", exact: true })
        .click();
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

    test("pre-game requirements fit and starting another game preserves the earlier save", async ({
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
      await expect(page.locator("#appbar:visible")).toBeVisible();
      const original = await readSavedGame(page);
      expect(original?.scenarioId).toBe(111);
      const originalId = (await readSaveRecords(page))[0].metadata.id;
      await page.evaluate(() => {
        history.pushState(null, "", "/?scenario=100");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await expect
        .poll(async () => (await readSaveRecords(page)).length)
        .toBe(2);
      const secondId = (await readSaveRecords(page)).find(
        (record) => record.metadata.id !== originalId,
      )!.metadata.id;
      await expect(
        page.locator("#appbar:visible [data-save-state]").first(),
      ).toHaveAttribute("data-active-save-id", secondId);
      expect((await readSavedGame(page, secondId))?.scenarioId).toBe(100);
      expect(await readSavedGame(page, originalId)).toEqual(original);
      await expect(dialog).toHaveCount(0);
    });

    test("saved-game rename and deletion dialogs fit a maximum-length unbroken name", async ({
      page,
    }, info) => {
      await page.goto("/?scenario=100");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await expect(page.locator("#appbar:visible")).toBeVisible();
      await readSavedGame(page);
      const id = (await readSaveRecords(page))[0].metadata.id;
      await page.getByRole("button", { name: "menu", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "Saved games", exact: true })
        .click();
      const row = page.locator('[data-save-id="' + id + '"]');
      await row.getByRole("button", { name: /^Actions for/ }).click();
      await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
      const rename = page.getByRole("dialog", { name: "Rename saved game" });
      const name = "W".repeat(SAVE_NAME_LIMIT);
      await rename.getByRole("textbox", { name: "Save name" }).fill(name);
      await expectDialogToFit(rename);
      await page.screenshot({
        path: info.outputPath("rename-save.png"),
        animations: "disabled",
      });
      await rename.getByRole("button", { name: "Rename", exact: true }).click();
      await expect(
        row.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      const saved = (await readSaveRecords(page))[0];

      await row.getByRole("button", { name: /^Actions for/ }).click();
      await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
      await expectDialogToFit(rename);
      await rename
        .getByRole("textbox", { name: "Save name" })
        .fill("Cancelled name");
      await rename.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(rename).toHaveCount(0);
      expect(await readSaveRecords(page)).toEqual([saved]);

      await row.getByRole("button", { name: /^Actions for/ }).click();
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
      const deleting = page.getByRole("dialog", { name: "Delete saved game?" });
      await expectDialogToFit(deleting);
      await expect(
        deleting.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      await page.screenshot({
        path: info.outputPath("delete-save.png"),
        animations: "disabled",
      });
      await deleting
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(deleting).toHaveCount(0);
      expect(await readSaveRecords(page)).toEqual([saved]);
      await expect(row).toBeVisible();

      await row.getByRole("button", { name: /^Actions for/ }).click();
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
      await deleting
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await expect(row).toHaveCount(0);
      expect(await readSaveRecords(page)).toEqual([]);
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
