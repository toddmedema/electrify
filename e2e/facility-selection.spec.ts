import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { editSavedGame, readSavedGame } from "./save-fixture";

for (const theme of ["light", "dark"]) {
  test(`facility selection, context actions and group drag in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    const nav = page.getByRole("button", { name: "Facilities", exact: true });
    await openPane(pane, nav);
    const original = await editSavedGame(page, (save) => {
      const templates = save.game.facilities;
      save.game.facilities = Array.from({ length: 5 }, (_, i) => ({
        ...templates[i % templates.length],
        id: i + 1,
        paused: false,
      }));
      save.game.speed = "PAUSED";
      return save.game.facilities.map((f) => f.id);
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(pane, nav);
    const rows = pane.locator(".facilityRow");
    const disclosure = (index: number) =>
      rows.nth(index).locator(".facilityDisclosure");
    if (info.project.use.hasTouch) {
      await expect(pane.locator(".facilitySelectionBar")).toBeHidden();
      await disclosure(0).tap();
      await expect(disclosure(0)).toHaveAttribute("aria-expanded", "true");
      await expect(
        rows.first().getByRole("button", { name: /^Pause / }),
      ).toBeVisible();
      await expect(
        page.getByRole("menu", { name: "Facility actions" }),
      ).toHaveCount(0);
      await expect(pane).toHaveJSProperty(
        "scrollWidth",
        await pane.evaluate((el) => el.clientWidth),
      );
      if (
        process.env.PR_SCREENSHOTS &&
        theme === "dark" &&
        info.project.name === "mobile-390px"
      ) {
        await page.screenshot({
          path: path.join(
            process.env.PR_SCREENSHOTS,
            "facilities-mobile-dark.png",
          ),
        });
      }
      return;
    }
    await disclosure(0).click();
    await disclosure(2).click({ modifiers: ["Shift"] });
    await expect(
      pane.locator(".facilitySelectionBar").getByRole("status"),
    ).toHaveText("3 facilities selected");
    await disclosure(1).click({ modifiers: ["Control"] });
    await disclosure(4).click({ modifiers: ["Meta"] });
    await expect(
      pane.locator(".facilitySelectionBar").getByRole("status"),
    ).toHaveText("3 facilities selected");
    await disclosure(4).click({ modifiers: ["Meta"] });
    await expect(
      pane.locator(".facilitySelectionBar").getByRole("status"),
    ).toHaveText("2 facilities selected");
    await rows.first().scrollIntoViewIfNeeded();
    await disclosure(2).click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Facility actions" });
    await page.keyboard.press("Escape");
    await expect(disclosure(2)).toBeFocused();
    await disclosure(2).click({ button: "right" });
    await expect(menu).toContainText("2 facilities selected");
    await page.keyboard.press("End");
    await expect(
      menu.getByRole("menuitem", { name: "Sell (2)", exact: true }),
    ).toBeFocused();
    await expect(page.locator(".facilityContextMenu")).toHaveCSS(
      "opacity",
      "1",
    );
    if (process.env.PR_SCREENSHOTS) {
      await pane.locator(".unifiedFacilitiesList").evaluate((list) => {
        list.scrollTop = 0;
      });
      await page.screenshot({
        path: path.join(
          process.env.PR_SCREENSHOTS,
          `facilities-selection-${theme}.png`,
        ),
      });
    }
    await menu
      .getByRole("menuitem", { name: "Pause (2)", exact: true })
      .click();
    expect(
      (await readSavedGame(page))!.facilities
        .filter((f) => f.paused)
        .map((f) => f.id),
    ).toEqual([original[0], original[2]]);
    await disclosure(0).click({ button: "right" });
    await menu
      .getByRole("menuitem", { name: "Resume (2)", exact: true })
      .click();
    await expect(menu).toBeHidden();
    expect((await readSavedGame(page))!.facilities.some((f) => f.paused)).toBe(
      false,
    );
    const drag = async (source: number, destination: number) => {
      await pane.locator(".unifiedFacilitiesList").evaluate((list) => {
        list.scrollTop = 0;
      });
      const handle = rows.nth(source).locator(".facilityDragHandle");
      await handle.scrollIntoViewIfNeeded();
      await handle.click({ trial: true });
      const from = (await handle.boundingBox())!;
      const to = (await rows
        .nth(destination)
        .locator(".facilityDragHandle")
        .boundingBox())!;
      const x = from.x + from.width / 2;
      await page.mouse.move(x, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, from.y + from.height / 2 + 8, { steps: 2 });
      await expect(rows.nth(source)).toHaveClass(/dragging/);
      await expect(pane.locator(".facilityDragCount")).toHaveText(
        "2 facilities",
      );
      await page.screenshot({
        path: info.outputPath(`facility-group-drag-${theme}.png`),
      });
      await page.mouse.move(x, to.y + to.height / 2, { steps: 12 });
      await expect(rows.nth(destination)).not.toHaveCSS("transform", "none");
      await page.mouse.up();
      await expect(pane.locator(".dragging")).toHaveCount(0);
    };
    await drag(2, 4);
    expect((await readSavedGame(page))!.facilities.map((f) => f.id)).toEqual([
      original[1],
      original[3],
      original[4],
      original[0],
      original[2],
    ]);
    await drag(3, 0);
    expect((await readSavedGame(page))!.facilities.map((f) => f.id)).toEqual([
      original[0],
      original[2],
      original[1],
      original[3],
      original[4],
    ]);
    // Lifting an unselected row leaves the group alone and must not imply a bulk drag.
    const speed = page.getByRole("group", { name: "game speed" });
    await speed
      .getByRole("button", { name: "slow speed", exact: true })
      .click();
    await rows.nth(3).locator(".facilityDragHandle").focus();
    await page.keyboard.press("Space");
    await expect(rows.nth(3)).toHaveClass(/dragging/);
    await expect(pane.locator(".facilityDragCount")).toHaveCount(0);
    await expect(rows.first()).toHaveCSS("opacity", "1");
    await page.keyboard.press("Escape");
    await expect(
      speed.getByRole("button", { name: "slow speed", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      pane.locator(".facilitySelectionBar").getByRole("status"),
    ).toHaveText("2 facilities selected");
    await speed.getByRole("button", { name: "pause", exact: true }).click();
    // An unselected row has its own actions; dismissing a sale must leave the fleet intact.
    await disclosure(3).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Sell", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(rows).toHaveCount(5);
    await expect(disclosure(3)).toBeFocused();
    // Re-select a range and confirm the bulk sale using the real persisted game state.
    await disclosure(0).click();
    await disclosure(1).click({ modifiers: ["Shift"] });
    await disclosure(0).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Sell (2)", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sell", exact: true })
      .click();
    await expect(rows).toHaveCount(3);
    expect((await readSavedGame(page))!.facilities.map((f) => f.id)).toEqual([
      original[1],
      original[3],
      original[4],
    ]);
    // A narrow window can still have a mouse. The context menu must stay within it.
    await page.setViewportSize({ width: 360, height: 800 });
    await disclosure(0).click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(page.locator(".facilityContextMenu")).toHaveCSS(
      "transform",
      "none",
    );
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    for (const item of await menu.getByRole("menuitem").all()) {
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    }
    await page.screenshot({
      path: info.outputPath(`facility-menu-mouse-360-${theme}.png`),
    });
  });
}
