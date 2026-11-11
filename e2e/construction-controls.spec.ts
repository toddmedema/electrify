import { expect, test, Locator } from "./fixtures";
import { openPane, openBuild } from "./layout";

async function expectExpandedActions(row: Locator, touch: boolean) {
  const actions = row.locator(".facilityActions");
  const facts = row.locator(".facilityStats").last();
  const factsBounds = (await facts.boundingBox())!;
  const actionsBounds = (await actions.boundingBox())!;
  expect(actionsBounds.y).toBeGreaterThanOrEqual(
    factsBounds.y + factsBounds.height,
  );
  for (const button of await actions.getByRole("button").all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(touch ? 44 : 40);
    expect(bounds.x).toBeGreaterThanOrEqual(actionsBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(
      actionsBounds.x + actionsBounds.width + 1,
    );
  }
  expect(
    await row.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  // Native scrolling respects the fleet's reserved dock clearance. Playwright's
  // scrollIntoViewIfNeeded only considers the viewport, including the area behind the dock.
  await actions.evaluate((el) =>
    el.scrollIntoView({ block: "end", behavior: "instant" }),
  );
  const dock = (await row.page().locator("#navfooter").boundingBox())!;
  const visibleActions = (await actions.boundingBox())!;
  expect(visibleActions.y + visibleActions.height).toBeLessThanOrEqual(dock.y);
  for (const button of await actions.getByRole("button").all()) {
    await expect
      .poll(() =>
        button.evaluate((el) => {
          const bounds = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2,
            ),
          );
        }),
      )
      .toBe(true);
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`facility construction details and actions reflow in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const operating = pane.locator(".facilityRow").first();
    await operating.locator(".facilityDisclosure").click();
    await expect(operating).toContainText("Capacity");
    await expectExpandedActions(operating, !!testInfo.project.use.hasTouch);
    await page.screenshot({
      path: testInfo.outputPath("facility-operating.png"),
    });

    for (const [category, name, payment] of [
      ["Generators", "Solar", "Pay cash"],
      ["Storage", "Battery", "Take loan"],
    ]) {
      const purchaseName = name === "Battery" ? "Lithium Battery" : name;
      await openBuild(page);
      await page.getByRole("tab", { name: category, exact: true }).click();
      if (name === "Battery") {
        await page
          .getByRole("button", { name: "Use max size", exact: true })
          .click();
      }
      await page
        .getByRole("button", {
          name: `Review purchase of ${purchaseName}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: payment })
        .click();
      const row = pane.locator(".facilityRow").filter({
        has: page.locator(".facilityName", {
          hasText: new RegExp(`^${name}$`),
        }),
      });
      await row.locator(".facilityDisclosure").click();
      const construction = row.getByRole("region", { name: "Construction" });
      await expect(construction).toContainText("Capacity");
      await expect(construction).toContainText("Refund if canceled");
      if (name === "Battery") {
        await expect(construction).toContainText("Energy capacity");
        await expect(construction).toContainText("After loan payoff");
      }
      await expectExpandedActions(row, !!testInfo.project.use.hasTouch);
      const refund = (
        await construction
          .locator(".facilityStat")
          .filter({
            has: page.locator("dt", { hasText: "Refund if canceled" }),
          })
          .locator("dd")
          .innerText()
      ).split("\n")[0];
      await page.mouse.move(0, 0);
      await expect(page.locator(".snackbarContent")).toBeHidden();
      await page.screenshot({
        path: testInfo.outputPath(`${name}-construction.png`),
      });
      await row
        .getByRole("button", { name: `Cancel construction of ${name}` })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(`You will receive ${refund}`);
      if (name === "Solar") {
        await page.screenshot({
          path: testInfo.outputPath("cancel-confirmation.png"),
          animations: "disabled",
        });
      }
      await dialog
        .getByRole("button", { name: "Cancel construction", exact: true })
        .click();
      await expect(row).toHaveCount(0);
    }
  });

  test(`plant and intertie rows under construction look alike in ${theme}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    const facilities = page.getByRole("button", {
      name: "Facilities",
      exact: true,
    });
    await openPane(pane, facilities);
    await openBuild(page);
    await page.getByRole("tab", { name: "Generators", exact: true }).click();
    await page
      .getByRole("button", { name: "Review purchase of Solar", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Pay cash" })
      .click();
    await openBuild(page);
    await page.getByRole("tab", { name: "Interties", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Review purchase of Pacific Northwest intertie",
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Take loan" })
      .click();
    await openPane(pane, facilities);
    const plant = pane.locator('.facilityRow[data-facility="Solar"]');
    const line = pane.locator(".transmissionLine").first();
    await expect(plant).toContainText(/Building \d+%/);
    await expect(line).toContainText(/Building \d+%/);
    // Let the purchase snackbar go, so nothing covers the rows being measured
    await page.mouse.move(0, 0);
    await expect(page.locator(".snackbarContent")).toBeHidden();

    // Everything about how the row reads: the meter's placement and colours against its own
    // header, and the typography of the name and the two halves of the status line. Fill widths
    // and the words themselves differ between rows; nothing else should.
    const look = (row: Locator) =>
      row.evaluate((element) => {
        const text = [
          "font-size",
          "font-weight",
          "line-height",
          "color",
          "font-variant-numeric",
          "text-transform",
          "letter-spacing",
        ];
        const styles = (selector: string, properties: string[]) => {
          const target = element.querySelector(selector)!;
          return Object.fromEntries(
            properties.map((name) => [
              name,
              getComputedStyle(target).getPropertyValue(name),
            ]),
          );
        };
        const header = element
          .querySelector(".facilityRowHeader")!
          .getBoundingClientRect();
        const bar = element
          .querySelector(".constructionProgress")!
          .getBoundingClientRect();
        const fill = element.querySelector(".constructionProgressFill")!;
        return {
          rowHeight: header.height,
          meter: {
            // Flush with both edges and the foot of the header, not the text column
            leftInset: bar.left - header.left,
            rightInset: header.right - bar.right,
            bottomInset: header.bottom - bar.bottom,
            height: bar.height,
            ...styles(".constructionProgress", ["background-color"]),
            fill: getComputedStyle(fill).backgroundColor,
            sweep: getComputedStyle(fill, "::before").animationName,
            sweepState: getComputedStyle(fill, "::before").animationPlayState,
          },
          name: styles(".facilityName", text),
          status: styles(".facilityStatus", text),
          detail: styles(".facilityStatusDetail", text),
        };
      });
    const paused = await look(line);
    expect(paused).toEqual(await look(plant));
    expect(paused.meter).toMatchObject({
      leftInset: 0,
      rightInset: 0,
      bottomInset: 0,
      height: 4,
      sweepState: "paused",
    });

    // Both meters sweep while the clock runs, and the rows keep their size and place
    // when construction completes
    const speed = (name: string) =>
      page
        .locator("#appbar:visible")
        .getByRole("button", { name, exact: true })
        .first();
    await speed("fast speed").click();
    await expect
      .poll(async () => (await look(line)).meter.sweepState)
      .toBe("running");
    expect((await look(line)).meter).toEqual((await look(plant)).meter);
    await expect(async () => {
      if ((await speed("pause").getAttribute("aria-pressed")) === "true") {
        await speed("fast speed").click();
      }
      await expect(pane).not.toContainText("Building", { timeout: 1000 });
    }).toPass({ timeout: 90000 });
    await speed("pause").click();
    await expect(speed("pause")).toHaveAttribute("aria-pressed", "true");
    for (const row of [plant, line]) {
      const height = await row
        .locator(".facilityRowHeader")
        .evaluate((header) => header.getBoundingClientRect().height);
      expect(height).toBeCloseTo(paused.rowHeight, 0);
    }
  });

  test(`intertie construction controls and motion in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const build = async () => {
      await openBuild(page);
      await page.getByRole("tab", { name: "Interties", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Review purchase of Pacific Northwest intertie",
        })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Take loan" })
        .click();
    };
    await build();
    const line = pane.locator(".transmissionLine").first();
    await line.locator(".facilityDisclosure").click();
    const cancel = line.getByRole("button", { name: /Cancel construction of/ });
    await expect(cancel).toBeVisible();
    await expect(line).toContainText("Refund if canceled");
    await expect(line).toContainText("After loan payoff");
    await expectExpandedActions(line, !!testInfo.project.use.hasTouch);
    const refund = (
      await line
        .locator(".facilityStat")
        .filter({ has: page.locator("dt", { hasText: "Refund if canceled" }) })
        .locator("dd")
        .innerText()
    ).split("\n")[0];
    await cancel.click();
    await expect(page.getByRole("dialog")).toContainText(
      `Receive ${refund} back`,
    );
    await expect(page.getByRole("dialog")).toContainText(
      "after settling the outstanding loan",
    );
    await page.getByRole("button", { name: "Never mind", exact: true }).click();
    const speed = (name: string) =>
      page
        .locator("#appbar:visible")
        .getByRole("button", { name, exact: true })
        .first();
    await speed("fast speed").click();
    const fill = line.locator(".constructionProgressFill");
    await expect
      .poll(() => fill.evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(20);
    await speed("pause").click();
    await expect
      .poll(() =>
        fill.evaluate(
          (el) => getComputedStyle(el, "::before").animationPlayState,
        ),
      )
      .toBe("paused");
    await page.mouse.move(0, 0);
    await expect(page.locator(".snackbarContent")).toBeHidden();
    await expectExpandedActions(line, !!testInfo.project.use.hasTouch);
    await page.screenshot({
      path: testInfo.outputPath("intertie-construction.png"),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() =>
        fill.evaluate((el) => getComputedStyle(el, "::before").display),
      )
      .toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await cancel.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel construction", exact: true })
      .click();
    await expect(line).toHaveCount(0);
    await build();
    await speed("fast speed").click();
    // The rebuilt line can cross an event that pauses the clock before it finishes.
    await expect(async () => {
      if ((await speed("pause").getAttribute("aria-pressed")) === "true") {
        await speed("fast speed").click();
      }
      await expect(line).not.toContainText("Building", { timeout: 1000 });
    }).toPass({ timeout: 45000 });
    await speed("pause").click();
    await line.locator(".facilityDisclosure").click();
    await line
      .getByRole("button", { name: /^Pause Northern intertie/ })
      .click();
    await expect(line.locator(".facilityDisclosure")).toHaveAccessibleName(
      /paused/,
    );
    await expect(
      line.getByRole("button", { name: /^Resume Northern intertie/ }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.locator(".snackbarContent")).toBeHidden();
    await expectExpandedActions(line, !!testInfo.project.use.hasTouch);
    await page.screenshot({ path: testInfo.outputPath("intertie-paused.png") });
    const metrics = line.locator(".transmissionMetrics");
    await expect(metrics.locator("dt")).toHaveText([
      "Import capacity",
      "Export capacity",
      "Price now",
      "Import available now",
      "Emissions (CO₂e)",
      "Typical price",
      "Loan balance",
    ]);
    // Directional capacities and operational metrics use the shared facility grid.
    const facility = pane.locator(".facilityRow").first();
    await facility.locator(".facilityDisclosure").click();
    const facilityDetails = facility.locator(".facilityDetails");
    for (const width of [360, 459, 460, 608]) {
      const layouts = [];
      for (const details of [
        facilityDetails,
        line.locator(".transmissionLineDetails"),
      ]) {
        layouts.push(
          await details.evaluate((element, panelWidth) => {
            const container = element as HTMLElement;
            const original = container.style.cssText;
            container.style.width = panelWidth + "px";
            container.style.boxSizing = "border-box";
            const grid = container.querySelector(".facilityStats")!;
            const cells = Array.from(grid.children).map((cell) =>
              cell.getBoundingClientRect(),
            );
            const style = getComputedStyle(grid);
            const result = {
              columns: style.gridTemplateColumns.split(" ").length,
              cellWidth: cells[0].width,
              columnGap: style.columnGap,
              rowGap: style.rowGap,
              noOverflow: Array.from(
                grid.querySelectorAll<HTMLElement>("*"),
              ).every((cell) => cell.scrollWidth <= cell.clientWidth + 1),
            };
            container.style.cssText = original;
            return result;
          }, width),
        );
      }
      expect(layouts[1]).toEqual(layouts[0]);
      expect(layouts[1].columns).toBe(width < 460 ? 2 : width < 608 ? 3 : 4);
      expect(layouts[1].noOverflow).toBe(true);
    }
    await facility.locator(".facilityDisclosure").click();
    if (testInfo.project.name === "desktop-chromium") {
      // The Facilities pane fills the desktop window, past the widest breakpoint above.
      const width = await line
        .locator(".transmissionLineDetails")
        .evaluate((el) => el.getBoundingClientRect().width);
      expect(width).toBeGreaterThanOrEqual(608);
      await expect
        .poll(() =>
          metrics.evaluate(
            (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
          ),
        )
        .toBeGreaterThanOrEqual(4);
      await expectExpandedActions(line, !!testInfo.project.use.hasTouch);
      await page.screenshot({
        path: testInfo.outputPath("intertie-metrics-wide.png"),
      });
    }
    await line
      .getByRole("button", { name: /^Resume Northern intertie/ })
      .click();
    await expect(
      line.getByRole("button", { name: /^Pause Northern intertie/ }),
    ).toBeVisible();
  });
}
