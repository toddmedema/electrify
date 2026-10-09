import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { editSavedGame, readSavedGame } from "./save-fixture";

for (const theme of ["light", "dark"]) {
  test(`expanded facilities scroll during gameplay in ${theme} mode`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    const navigation = page.getByRole("button", {
      name: "Facilities",
      exact: true,
    });
    await openPane(pane, navigation);
    // A real saved fleet makes overflow independent of the scenario's starting row count.
    await editSavedGame(page, (save) => {
      const templates = [...save.game.facilities];
      const nextId = Math.max(...templates.map(({ id }) => id)) + 1;
      for (let i = 0; i < 16; i++) {
        save.game.facilities.push({
          ...templates[i % templates.length],
          id: nextId + i,
        });
      }
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(pane, navigation);
    await pane.getByRole("button", { name: "Dispatch", exact: true }).click();
    await expect(page.locator("main.base_main")).toHaveCount(1);
    await expect(
      page.getByText("Starting your mission…", { exact: true }),
    ).toBeHidden();
    const list = pane.locator(".unifiedFacilitiesList");
    await list.locator(".facilityDisclosure").first().click();
    // Wide panes scroll the fleet; phones and short panes scroll its containing body/card.
    const scroller = await list.evaluateHandle((element) => {
      let parent = element as HTMLElement;
      while (
        parent.parentElement &&
        !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)
      ) {
        parent = parent.parentElement;
      }
      return parent;
    });
    expect(
      await scroller.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    ).toBeGreaterThan(400);
    const before = (await readSavedGame(page))!.date.minute;
    const speeds = ["pause", "slow speed", "normal speed", "fast speed"];
    if (await page.getByRole("button", { name: "ultra speed" }).count()) {
      speeds.push("ultra speed");
    }
    for (const speed of speeds) {
      const control = page.getByRole("button", { name: speed, exact: true });
      await control.click();
      await expect(control).toHaveAttribute("aria-pressed", "true");
      await scroller.evaluate((element) => {
        element.scrollTop = 0;
      });
      const box = (await list.boundingBox())!;
      await page.mouse.move(
        box.x + box.width / 2,
        Math.min(box.y + 100, page.viewportSize()!.height - 100),
      );
      // Use real input: assigning scrollTop bypasses the interrupted native wheel gesture.
      await page.mouse.wheel(0, 300);
      // Let the gesture and several simulation updates finish before checking retention.
      await page.waitForTimeout(1000);
      expect(
        await scroller.evaluate((element) => element.scrollTop),
        `the fleet should scroll and stay scrolled at ${speed}`,
      ).toBeGreaterThan(250);
    }
    if (
      process.env.PR_SCREENSHOTS &&
      ((info.project.name === "desktop-chromium" && theme === "light") ||
        (info.project.name === "mobile-390px" && theme === "dark"))
    ) {
      await page.screenshot({
        path: path.join(
          process.env.PR_SCREENSHOTS,
          `facilities-${info.project.name}-${theme}.png`,
        ),
      });
    }
    if (info.project.use.hasTouch) {
      await scroller.evaluate((element) => {
        element.scrollTop = 0;
      });
      const box = (await list.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = Math.min(box.y + 150, page.viewportSize()!.height - 100);
      const touch = await page.context().newCDPSession(page);
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 5; step++) {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - step * 40 }],
        });
      }
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(100);
      await touch.detach();
    }
    expect((await readSavedGame(page))!.date.minute).toBeGreaterThan(before);
  });
}
