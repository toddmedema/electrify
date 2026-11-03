import { reviewScreenshot } from "./review-screenshot";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { expectDialogToFit } from "./dialog-layout";
import { SAVE_NAME_LIMIT } from "../src/SaveModel";
import { readSavedGame, readSaveRecords } from "./save-fixture";
import path from "node:path";

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
        .getByRole("menuitem", { name: "Save as new", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expectDialogToFit(dialog);
      const field = dialog.getByRole("textbox", { name: "Preset name" });
      const border = dialog.locator(".MuiOutlinedInput-notchedOutline");
      const blue = await field.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--interactive-blue")
          .trim(),
      );
      await field.fill("Grid watch");
      await expect(field).toBeFocused();
      await expect(field).toHaveCSS("outline-style", "none");
      // Compare computed colors so hex and rgb token spellings are equivalent.
      const blueRgb = await field.evaluate((input, color) => {
        const probe = document.createElement("span");
        probe.style.color = color;
        input.parentElement!.appendChild(probe);
        const result = getComputedStyle(probe).color;
        probe.remove();
        return result;
      }, blue);
      await expect(border).toHaveCSS("border-color", blueRgb);
      await field.press("Tab");
      await field.hover();
      await expect(field).toHaveCSS("outline-style", "none");
      await expect(border).toHaveCSS("border-color", blueRgb);
      const length = Number(await field.getAttribute("maxlength"));
      await field.fill("W".repeat(length));
      await dialog
        .getByRole("button", { name: "Save preset", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      for (const action of ["Rename", "Delete custom"]) {
        await insights.getByRole("button", { name: "Preset actions" }).click();
        await page.getByRole("menuitem", { name: action, exact: true }).click();
        await expectDialogToFit(dialog);
        await reviewScreenshot(page, {
          path: info.outputPath(action + ".png"),
          animations: "disabled",
        });
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
      }
    });

    test("preset menus keep edits with the named preset and only show useful groups", async ({
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
      const preset = insights.getByRole("combobox", { name: "Insight preset" });
      await preset.click();
      await expect(
        page.getByText("Default presets", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("option", { name: "Unsaved view" }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");

      await insights.getByRole("button", { name: "Preset actions" }).click();
      await page
        .getByRole("menuitem", { name: "Save as new", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("textbox", { name: "Preset name" })
        .fill("Grid watch");
      const shots = process.env.REVIEW_SCREENSHOT_DIR;
      if (shots && theme === "dark" && info.project.name === "desktop-chromium")
        await page.screenshot({
          path: path.join(shots, "preset-input-desktop-dark.png"),
          animations: "disabled",
        });
      await dialog
        .getByRole("button", { name: "Save preset", exact: true })
        .click();
      await insights.getByRole("button", { name: /^Layers/ }).click();
      await insights
        .getByRole("checkbox", { name: "Revenue", exact: true })
        .click();
      await insights
        .getByRole("button", { name: "Done choosing layers", exact: true })
        .click();
      await expect(preset).toContainText("Grid watch");
      await expect(
        preset.getByRole("status", { name: "Unsaved changes" }),
      ).toBeVisible();
      await preset.click();
      await expect(
        page.getByText("Default presets", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Your presets", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("option", { name: "Grid watch", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("option", { name: "Unsaved view" }),
      ).toHaveCount(0);
      if (shots && theme === "dark" && info.project.name === "desktop-chromium")
        await page.screenshot({
          path: path.join(shots, "preset-menu-desktop-dark.png"),
          animations: "disabled",
        });
      await page.keyboard.press("Escape");
      await insights.getByRole("button", { name: "Preset actions" }).click();
      const rename = page.getByRole("menuitem", {
        name: "Rename",
        exact: true,
      });
      await expect(rename.locator("svg")).toBeVisible();
      if (shots && theme === "light" && info.project.name === "mobile-390px")
        await page.screenshot({
          path: path.join(shots, "preset-actions-mobile-light.png"),
          animations: "disabled",
        });
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
      await reviewScreenshot(page, {
        path: info.outputPath("retrofit.png"),
        animations: "disabled",
      });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    });

    test("pre-game requirements fit and starting another game preserves the earlier save", async ({
      page,
    }) => {
      await page.goto("/?scenario=111");
      await page.getByRole("button", { name: "Goals", exact: true }).click();
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
      await reviewScreenshot(page, {
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
      await reviewScreenshot(page, {
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
      let releaseAuth!: () => void;
      const authPending = new Promise<void>((resolve) => {
        releaseAuth = resolve;
      });
      await page.route("https://apis.google.com/js/api.js*", async (route) => {
        await authPending;
        await route.abort();
      });
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "userAgent", {
          get: () =>
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        });
        // Put Safari's background auth script in the initial load-event window.
        document.addEventListener(
          "DOMContentLoaded",
          () => {
            const script = document.createElement("script");
            script.async = true;
            script.src = "https://apis.google.com/js/api.js";
            document.head.append(script);
          },
          { once: true },
        );
      });
      try {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page
          .getByRole("button", { name: "Install app", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await expectDialogToFit(dialog);
        expect(await page.evaluate(() => document.readyState)).toBe(
          "interactive",
        );
        await reviewScreenshot(page, {
          path: info.outputPath("install.png"),
          animations: "disabled",
        });
        await dialog
          .getByRole("button", { name: "Got it", exact: true })
          .click();
      } finally {
        releaseAuth();
        await page.unrouteAll({ behavior: "wait" });
      }
    });

    test("credits fit and return focus to Settings", async ({ page }, info) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const credits = page.getByRole("button", {
        name: "Credits and licenses",
        exact: true,
      });
      await credits.click();
      const dialog = page.getByRole("dialog", { name: "Credits and licenses" });
      await expect(
        dialog.getByText("Todd Medema", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText("Chris Gebhart", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText("Nicholas Coronado", { exact: true }),
      ).toBeVisible();
      await expectDialogToFit(dialog);
      await reviewScreenshot(page, {
        path: info.outputPath("credits-and-licenses.png"),
        animations: "disabled",
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(credits).toBeFocused();
      await expect(
        page.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible();
    });
  });
}
