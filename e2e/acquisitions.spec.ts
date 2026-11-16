import { TERRITORIES, LAND_TERRITORIES } from "../src/data/Territories";
import { territoryMapLabel } from "../src/components/base/TerritoryMapLayout";
import { expect, test } from "./fixtures";
import { openBuild, openPane } from "./layout";
import { reviewScreenshot } from "./review-screenshot";
import { expectDialogToFit } from "./dialog-layout";
import { readSavedGame, readSaveRecords } from "./save-fixture";

for (const theme of ["light", "dark"] as const) {
  test(`territory map uses named borders and purchasable parcels in ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=116");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const facilities = page.locator(".facilities:visible");
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const network = facilities.getByRole("region", { name: "Territories" });
    await expect(network.locator("[data-map-target]")).toHaveCount(
      TERRITORIES.length,
    );
    await expect(
      network.locator(".territoryMapKey,.territoryHexHub"),
    ).toHaveCount(0);
    await expect(network.locator(".territoryUtilityLabel strong")).toHaveText([
      "You",
      "Valley Electric",
      "Ridge Electric",
    ]);
    await expect(network.locator(".territoryParcel")).toHaveCount(
      LAND_TERRITORIES.length,
    );
    const colors = await network
      .locator(".territoryHexBoundary")
      .evaluateAll((paths) =>
        paths.map((path) => getComputedStyle(path).stroke),
      );
    expect(new Set(colors).size).toBe(3);
    for (const territory of TERRITORIES) {
      const node = network.locator(`[data-map-target="${territory.id}"]`);
      const box = await node.boundingBox();
      expect(
        box!.height,
        `${territory.id} target height`,
      ).toBeGreaterThanOrEqual(44);
      expect(box!.width, `${territory.id} target width`).toBeGreaterThanOrEqual(
        44,
      );
      await node.click();
      await expect(node).toHaveAttribute("aria-pressed", "true");
      const detail = network.getByRole("region", {
        name: "Selected territory",
      });
      const heading = detail.getByRole("heading", { level: 3 });
      await expect(heading).toHaveText(territoryMapLabel(territory.id));
      // Inspection hands focus to the detail before another map navigation begins.
      await expect(heading).toBeFocused();
      if (territory.kind === "greenfield")
        await expect(
          detail.getByRole("button", { name: /Buy territory/ }),
        ).toBeEnabled();
    }
    const home = network.getByRole("button", {
      name: "Inspect You territory",
      exact: true,
    });
    await home.focus();
    await home.press("ArrowRight");
    const active = await page.evaluate(() =>
      document.activeElement?.getAttribute("data-map-target"),
    );
    expect(active).toBeTruthy();
    expect(active).not.toBe("champlain");
    await network.locator(`[data-map-target="${active}"]`).press("Enter");
    await expect(
      network
        .getByRole("region", { name: "Selected territory" })
        .getByRole("heading", { level: 3 }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`acquires a neighboring utility directly in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=116");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const facilities = page.locator(".facilities:visible");
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await facilities
      .getByRole("button", {
        name: "Inspect Ridge Electric territory",
        exact: true,
      })
      .click();
    const detail = facilities.getByRole("region", {
      name: "Selected territory",
    });
    await detail
      .getByRole("button", { name: "Inspect Ridge Electric", exact: true })
      .click();
    const terms = page.getByRole("dialog", {
      name: "Acquisition terms",
      exact: true,
    });
    await expectDialogToFit(terms);
    await expect(terms).toContainText("Assumed debt");
    await terms
      .getByRole("button", { name: "Back to territories", exact: true })
      .click();
    await detail
      .getByRole("button", { name: "Acquire Ridge Electric", exact: true })
      .click();
    let review = page.getByRole("dialog", {
      name: "Acquire Ridge Electric?",
      exact: true,
    });
    await expectDialogToFit(review);
    await expect(review).toContainText("Inherited debt");
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(review).toHaveCount(0);
    await detail
      .getByRole("button", { name: "Acquire Ridge Electric", exact: true })
      .click();
    review = page.getByRole("dialog", {
      name: "Acquire Ridge Electric?",
      exact: true,
    });
    await reviewScreenshot(review, {
      path: testInfo.outputPath(`acquisition-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
    await review
      .getByRole("button", { name: "Take loan", exact: true })
      .click();
    await expect(review).toHaveCount(0);
    await expect(
      detail.getByRole("button", {
        name: "Build in Ridge Electric",
        exact: true,
      }),
    ).toBeEnabled();
    const saved = (await readSavedGame(page))!;
    expect(
      saved.utilityExpansion!.acquisitions.map((receipt) => receipt.targetId),
    ).toContain("ridge-electric");
    expect(
      saved.facilities.some(
        (facility) => facility.territoryId === "ridge-electric",
      ),
    ).toBe(true);
    expect(saved.transmission!.lines).toEqual([]);
    await openBuild(page);
    await expect(
      page.getByRole("tab", { name: "Interties", exact: true }),
    ).toHaveCount(0);
  });
}

test("normal valley play saves across the first year and resumes from IndexedDB", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.addInitScript(() => localStorage.setItem("audioEnabled", "false"));
  await page.goto("/?scenario=116");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  for (const close of await page
    .locator('.gameToolHeader button[aria-label^="Close "]')
    .all())
    if (await close.isVisible()) await close.click();
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await expect
    .poll(async () => (await readSavedGame(page))?.date.monthsElapsed ?? 0, {
      timeout: 60000,
    })
    .toBeGreaterThanOrEqual(13);
  await page.getByRole("button", { name: "pause", exact: true }).click();
  const before = (await readSavedGame(page))!;
  const state = page.locator("#appbar:visible [data-save-state]").first();
  await expect(state).toHaveAttribute("data-save-state", "saved");
  expect(before.monthlyHistory.length).toBeGreaterThanOrEqual(12);
  expect((await readSaveRecords(page))[0].metadata.status).toBe("inProgress");
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const after = (await readSavedGame(page))!;
  expect(after.date.minute).toBeGreaterThanOrEqual(before.date.minute);
  expect(after.monthlyHistory).toEqual(before.monthlyHistory);
  expect(after.transmission?.lines).toEqual(before.transmission?.lines);
  await expect(state).toHaveAttribute("data-save-state", "saved");
  await expect(page.getByText("Save failed", { exact: true })).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`open land cash purchase owns land immediately and reserves a shared site in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=116");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const facilities = page.locator(".facilities:visible");
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await facilities
      .getByRole("button", {
        name: `Inspect ${territoryMapLabel("green-uplands")} territory`,
        exact: true,
      })
      .click();
    const detail = facilities.getByRole("region", {
      name: "Selected territory",
    });
    const before = (await readSavedGame(page))!;
    await detail.getByRole("button", { name: /Buy territory/ }).click();
    const review = page.getByRole("dialog", {
      name: "Buy territory",
      exact: true,
    });
    await expectDialogToFit(review);
    await expect(review).toContainText("No customers or plants transfer");
    await expect(review.getByRole("button", { name: /loan/i })).toHaveCount(0);
    await reviewScreenshot(review, {
      path: testInfo.outputPath(`land-cash-review-${theme}.png`),
      scale: "css",
      animations: "disabled",
    });
    await review.getByRole("button", { name: /Buy territory/ }).click();
    await expect(review).toHaveCount(0);
    await expect(
      detail.getByRole("button", {
        name: `Build in ${territoryMapLabel("green-uplands")}`,
        exact: true,
      }),
    ).toBeEnabled();
    const owned = (await readSavedGame(page))!;
    const previous = before.timeline.find(
      (tick) => tick.minute === before.date.minute,
    )!;
    const current = owned.timeline.find(
      (tick) => tick.minute === owned.date.minute,
    )!;
    expect(current.cash).toBeCloseTo(previous.cash - 18e6, 1);
    expect(current.customers).toBe(previous.customers);
    expect(owned.facilities).toHaveLength(before.facilities.length);
    expect(owned.transmission!.lines).toEqual([]);
    expect(owned.territoryNetwork!.landPurchases).toEqual([
      { territoryId: "green-uplands", minute: owned.date.minute, price: 18e6 },
    ]);
    await reviewScreenshot(detail, {
      path: testInfo.outputPath(`land-owned-${theme}.png`),
      scale: "css",
      animations: "disabled",
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await facilities
      .getByRole("button", {
        name: `Inspect ${territoryMapLabel("green-uplands")} territory`,
        exact: true,
      })
      .click();
    await detail
      .getByRole("button", {
        name: `Build in ${territoryMapLabel("green-uplands")}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Build destination", exact: true }),
    ).toHaveText(territoryMapLabel("green-uplands"));
    const wind = page.getByRole("listitem").filter({
      has: page.getByRole("button", {
        name: "Review purchase of Wind",
        exact: true,
      }),
    });
    await expect(wind).toContainText("7 local sites left");
    await wind
      .getByRole("button", { name: "Review purchase of Wind", exact: true })
      .click();
    const buildReview = page.getByRole("dialog", { name: /^Build .* Wind\?/ });
    await expectDialogToFit(buildReview);
    await buildReview
      .getByRole("button", { name: "Pay cash", exact: true })
      .click();
    await expect(buildReview).toHaveCount(0);
    await openBuild(page);
    await expect(
      page.getByRole("combobox", { name: "Build destination", exact: true }),
    ).toHaveText(territoryMapLabel("green-uplands"));
    await expect(wind).toContainText("6 local sites left");
    const built = (await readSavedGame(page))!;
    expect(built.facilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fuel: "Wind",
          territoryId: "green-uplands",
          peakW: 20e6,
        }),
      ]),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const customer of [
    { id: "parcel-1", kind: "residential", count: 16000 },
    { id: "parcel-5", kind: "industrial", count: 400 },
  ] as const) {
    test(`${customer.kind} territory adds customers without plants in ${theme}`, async ({
      page,
    }) => {
      await page.addInitScript((mode) => {
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
      }, theme);
      await page.goto("/?scenario=116");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const facilities = page.locator(".facilities:visible");
      await openPane(
        facilities,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
      await facilities.locator(`[data-map-target="${customer.id}"]`).click();
      const before = (await readSavedGame(page))!,
        beforeTick = before.timeline.find(
          (tick) => tick.minute === before.date.minute,
        )!;
      const detail = facilities.getByRole("region", {
        name: "Selected territory",
      });
      await detail.getByRole("button", { name: /Buy territory/ }).click();
      const dialog = page.getByRole("dialog", {
        name: "Buy territory",
        exact: true,
      });
      await expectDialogToFit(dialog);
      await expect(dialog).toContainText(`${customer.kind} customers`);
      await dialog.getByRole("button", { name: /Buy territory/ }).click();
      await expect(dialog).toHaveCount(0);
      const saved = (await readSavedGame(page))!,
        now = saved.timeline.find((tick) => tick.minute === saved.date.minute)!;
      expect(now.customers - beforeTick.customers).toBe(customer.count);
      expect(saved.facilities).toHaveLength(before.facilities.length);
      expect(
        saved.territoryNetwork!.landPurchases.map(
          (receipt) => receipt.territoryId,
        ),
      ).toContain(customer.id);
      await expect(detail).toContainText("Customers added");
      await expect(detail.getByRole("button", { name: /Build/ })).toHaveCount(
        0,
      );
    });
  }
  for (const resource of [
    { id: "parcel-7", name: "Hydro", fuel: "Hydro" },
    { id: "parcel-3", name: "Geothermal", fuel: "Geothermal" },
  ] as const) {
    test(`${resource.name} territory unlocks a working plant purchase in ${theme}`, async ({
      page,
    }) => {
      await page.addInitScript((mode) => {
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
      }, theme);
      await page.goto("/?scenario=116");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const facilities = page.locator(".facilities:visible");
      await openPane(
        facilities,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
      await facilities.locator(`[data-map-target="${resource.id}"]`).click();
      const detail = facilities.getByRole("region", {
        name: "Selected territory",
      });
      await detail.getByRole("button", { name: /Buy territory/ }).click();
      const dialog = page.getByRole("dialog", {
        name: "Buy territory",
        exact: true,
      });
      await dialog.getByRole("button", { name: /Buy territory/ }).click();
      await detail
        .getByRole("button", {
          name: `Build ${resource.name.toLowerCase()}`,
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("combobox", { name: "Build destination", exact: true }),
      ).toHaveText(territoryMapLabel(resource.id));
      const review = page.getByRole("button", {
        name: `Review purchase of ${resource.name}`,
        exact: true,
      });
      await expect(review).toBeEnabled();
      await review.click();
      const plant = page.getByRole("dialog", { name: /^Build / });
      await expectDialogToFit(plant);
      await plant
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
      await expect(plant).toHaveCount(0);
      const saved = (await readSavedGame(page))!;
      expect(saved.facilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fuel: resource.fuel,
            territoryId: resource.id,
          }),
        ]),
      );
    });
  }
}
