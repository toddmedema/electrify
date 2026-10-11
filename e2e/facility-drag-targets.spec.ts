import { expect, test } from "./fixtures";
import { openPane } from "./layout";

for (const theme of ["light", "dark"]) {
  test(`compact facility grips and icons share a drag target in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await page
      .getByRole("group", { name: "game speed" })
      .getByRole("button", { name: "pause", exact: true })
      .click();
    await expect(
      page.getByText("Starting your mission…", { exact: true }),
    ).toBeHidden();

    const rows = pane.locator(".facilityRow");
    const row = rows.first();
    const originalId = await row.getAttribute("data-rfd-draggable-id");
    const handle = row.locator(".facilityDragHandle");
    const icon = handle.locator(".MuiAvatar-root");
    await handle.scrollIntoViewIfNeeded();
    const layout = await handle.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const grip = element
        .querySelector(":scope > svg")!
        .getBoundingClientRect();
      const icon = element
        .querySelector(".MuiAvatar-root")!
        .getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        leadingSpace: grip.left - bounds.left,
        iconGap: icon.left - grip.right,
      };
    });
    expect(layout.width).toBeGreaterThanOrEqual(44);
    expect(layout.width).toBeLessThanOrEqual(72);
    expect(layout.height).toBeGreaterThanOrEqual(44);
    expect(layout.leadingSpace).toBeLessThanOrEqual(4);
    expect(layout.iconGap).toBeLessThanOrEqual(4);

    // A tap on the icon belongs to reordering; the name still opens details.
    await icon.click();
    await expect(row.locator(".facilityDisclosure")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await row.locator(".facilityName").click();
    await expect(row.locator(".facilityDetails")).toBeVisible();
    await row.locator(".facilityName").click();

    const start = (await icon.boundingBox())!;
    const destination = (await rows
      .nth(1)
      .locator(".facilityDragHandle")
      .boundingBox())!;
    const x = start.x + start.width / 2;
    const fromY = start.y + start.height / 2;
    const toY = destination.y + destination.height / 2;
    if (testInfo.project.use.hasTouch) {
      const session = await page.context().newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: fromY }],
      });
      await expect(row).toHaveClass(/dragging/);
      for (let step = 1; step <= 10; step++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: fromY + ((toY - fromY) * step) / 10 }],
        });
      }
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await session.detach();
    } else {
      await page.mouse.move(x, fromY);
      await page.mouse.down();
      await page.mouse.move(x, fromY + 8, { steps: 2 });
      await expect(row).toHaveClass(/dragging/);
      await page.mouse.move(x, toY, { steps: 10 });
      await page.mouse.up();
    }
    await expect(rows.nth(1)).toHaveAttribute(
      "data-rfd-draggable-id",
      originalId!,
    );
    await expect(rows.nth(1).locator(".facilityDisclosure")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      await pane.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    // Restore the order with the keyboard, also checking the shared target retains focus.
    await rows.nth(1).locator(".facilityDragHandle").focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Space");
    await expect(rows.first()).toHaveAttribute(
      "data-rfd-draggable-id",
      originalId!,
    );
    await expect(rows.first().locator(".facilityDragHandle")).toBeFocused();
    await expect(rows.first().locator(".facilityDragHandle")).toHaveCSS(
      "outline-offset",
      "-2px",
    );

    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await rows.first().locator(".facilityDragHandle").blur();
      await pane.locator(".facilitiesBody").evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `${process.env.REVIEW_SCREENSHOT_DIR}/facility-drag-${testInfo.project.name}-${theme}.png`,
        animations: "disabled",
      });
    }
  });
}
