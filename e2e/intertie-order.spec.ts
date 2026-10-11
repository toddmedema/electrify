import { expect, test } from "./fixtures";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`interties share facility row surfaces and support trading reordering in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const speed = page.getByRole("group", { name: "game speed" });
    await speed.getByRole("button", { name: "pause", exact: true }).click();

    for (const neighbor of ["Pacific Northwest", "Desert Southwest"]) {
      await pane.getByRole("button", { name: "Build", exact: true }).click();
      await page.getByRole("tab", { name: "Interties", exact: true }).click();
      await page
        .getByRole("button", {
          name: `Review purchase of ${neighbor} intertie`,
        })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
      await openPane(
        pane,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
    }
    // The approval toast can cover a row on phones. Keep the pointer away so it dismisses.
    await page.mouse.move(0, 0);
    await expect(page.locator(".snackbarContent")).toBeHidden();
    const rows = pane.locator(".transmissionLine");
    await expect(rows).toHaveCount(2);
    await expect(pane.locator("#your-interties-title")).toContainText(
      "Trading order",
    );
    const originalFirstId = await rows
      .first()
      .getAttribute("data-rfd-draggable-id");
    const facilitiesBefore = await pane
      .locator(".facilityRow")
      .evaluateAll((elements) =>
        elements.map((element) =>
          element.getAttribute("data-rfd-draggable-id"),
        ),
      );
    const disclosure = rows.first().locator(".facilityDisclosure");
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await rows.first().locator(".facilityDragHandle").focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect(rows.last()).toHaveAttribute(
      "data-rfd-draggable-id",
      originalFirstId!,
    );
    await expect(rows.last().locator(".facilityDragHandle")).toBeFocused();
    await expect(rows.last().locator(".facilityDisclosure")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await rows.last().locator(".facilityDisclosure").click();

    // Canceling a lift restores the clock and leaves the order intact.
    await speed
      .getByRole("button", { name: "slow speed", exact: true })
      .click();
    await rows.first().locator(".facilityDragHandle").focus();
    await page.keyboard.press("Space");
    await expect(
      speed.getByRole("button", { name: "pause", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(
      speed.getByRole("button", { name: "slow speed", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(rows.last()).toHaveAttribute(
      "data-rfd-draggable-id",
      originalFirstId!,
    );
    await speed.getByRole("button", { name: "pause", exact: true }).click();

    // Reorder back with the pointer on desktop and a long-press touch drag on phones.
    const handle = rows.last().locator(".facilityDragHandle");
    await handle.scrollIntoViewIfNeeded();
    const start = (await handle.boundingBox())!;
    const destination = (await rows
      .first()
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
      // The drag sensor requires a long press before movement.
      await expect(rows.last()).toHaveClass(/dragging/);
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
      await page.mouse.move(x, fromY - 8, { steps: 2 });
      await expect(rows.last()).toHaveClass(/dragging/);
      await page.mouse.move(x, toY, { steps: 10 });
      await page.mouse.up();
    }
    await expect(rows.first()).toHaveAttribute(
      "data-rfd-draggable-id",
      originalFirstId!,
    );
    expect(
      await pane
        .locator(".facilityRow")
        .evaluateAll((elements) =>
          elements.map((element) =>
            element.getAttribute("data-rfd-draggable-id"),
          ),
        ),
    ).toEqual(facilitiesBefore);
    expect(
      await pane.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    const header = rows.first().locator(".facilityRowHeader");
    const surfaces = await header.evaluate((element) => {
      const grip = element.querySelector(".facilityDragHandle")!;
      const disclosure = element.querySelector(".facilityDisclosure")!;
      return {
        separator: getComputedStyle(element).borderTopWidth,
        children: [grip, disclosure].map((child) => ({
          background: getComputedStyle(child).backgroundColor,
          separator: getComputedStyle(child).borderTopWidth,
        })),
        gripHeight: grip.getBoundingClientRect().height,
      };
    });
    expect(surfaces.separator).toBe("1px");
    expect(surfaces.children).toEqual([
      { background: "rgba(0, 0, 0, 0)", separator: "0px" },
      { background: "rgba(0, 0, 0, 0)", separator: "0px" },
    ]);
    expect(surfaces.gripHeight).toBeGreaterThanOrEqual(
      testInfo.project.use.hasTouch ? 44 : 40,
    );
    await rows.first().scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await pane.screenshot({
      path: testInfo.outputPath(`intertie-order-${theme}.png`),
      animations: "disabled",
    });
  });
}
