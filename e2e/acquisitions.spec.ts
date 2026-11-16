import type { Locator } from "@playwright/test";
import type { GameType } from "../src/Types";
import { TERRITORIES } from "../src/data/Territories";
import { TERRITORY_TILES } from "../src/data/TerritoryTiles";
import { TERRAIN_LABELS } from "../src/data/TerrainLabels";
import { getBuildFacilityQuote } from "../src/data/Facilities";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../src/helpers/DateTime";
import { loadSimData } from "../src/testing/SimData";
import { territoryTileViews } from "../src/helpers/TerritoryMapState";
import { territoryBuildTileName } from "../src/components/base/TerritoryBuildDestination";
import { territoryMapLabel } from "../src/components/base/TerritoryMapLayout";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { reviewScreenshot } from "./review-screenshot";
import { expectDialogToFit } from "./dialog-layout";
import { editSavedGame, readSavedGame, readSaveRecords } from "./save-fixture";

async function expectPhysicalMap(network: Locator, game: GameType) {
  const views = territoryTileViews(game);
  const targets = network.locator("button[data-map-target]");
  await expect(targets).toHaveCount(76);
  expect(
    await targets.evaluateAll((buttons) =>
      buttons.map((button) => ({
        id: button.getAttribute("data-map-target"),
        territoryId: button.getAttribute("data-territory"),
        terrain: button.getAttribute("data-terrain"),
      })),
    ),
  ).toEqual(
    TERRITORY_TILES.map((tile) => ({
      id: tile.id,
      territoryId: tile.territoryId,
      terrain: tile.terrain,
    })),
  );
  await expect(network.locator(".territoryTerrainArtwork")).toHaveCount(76);
  const occupants = await network
    .locator(".territoryTileOccupant")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        id: element.getAttribute("data-occupant-tile"),
        kind: element.getAttribute("data-occupant"),
      })),
    );
  expect(occupants.sort((a, b) => a.id!.localeCompare(b.id!))).toEqual(
    views
      .filter((view) => view.tile.city || view.developed)
      .map((view) => ({
        id: view.tile.id,
        kind: view.tile.city
          ? "city"
          : view.facility
            ? view.facility.peakWh !== undefined
              ? "storage"
              : "generator"
            : "tower",
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
  // Every adjacent developed pair within one company gets exactly one link.
  const expectedWires = views.flatMap((from, index) =>
    views.slice(index + 1).flatMap((to) => {
      const dq = from.tile.q - to.tile.q;
      const dr = from.tile.r - to.tile.r;
      return from.developed &&
        to.developed &&
        from.ownerKey === to.ownerKey &&
        Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) === 1
        ? [[from.tile.id, to.tile.id].sort().join("|")]
        : [];
    }),
  );
  const wires = await network
    .locator("[data-wire-from][data-wire-to]")
    .evaluateAll((elements) =>
      elements.map((element) =>
        [
          element.getAttribute("data-wire-from"),
          element.getAttribute("data-wire-to"),
        ]
          .sort()
          .join("|"),
      ),
    );
  expect(wires.sort()).toEqual(expectedWires.sort());
  expect(new Set(wires).size).toBe(wires.length);
}

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
    const saved = (await readSavedGame(page))!;
    await expectPhysicalMap(network, saved);
    await expect(
      network.locator(".territoryMapKey,.territoryHexHub,.territoryParcel"),
    ).toHaveCount(0);
    await expect(network.locator(".territoryUtilityLabel strong")).toHaveText([
      "You",
      "Valley Electric",
      "Ridge Electric",
    ]);
    await expect(network.locator(".territoryHexBoundary")).toHaveCount(3);
    const colors = await network
      .locator(".territoryHexBoundary")
      .evaluateAll((paths) =>
        paths.map((path) => getComputedStyle(path).stroke),
      );
    expect(new Set(colors).size).toBe(3);
    const targets = await network
      .locator("[data-map-target]")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute("data-map-target"),
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        })),
      );
    for (const target of targets) {
      expect(
        target.height,
        `${target.id} target height`,
      ).toBeGreaterThanOrEqual(44);
      expect(target.width, `${target.id} target width`).toBeGreaterThanOrEqual(
        44,
      );
    }
    const inspectTiles = new Map(
      TERRITORY_TILES.map((tile) => [tile.terrain, tile] as const).reverse(),
    );
    const occupied = territoryTileViews(saved).find(
      (view) => view.owned && view.facility,
    )!.tile;
    const representatives = new Map(
      [
        ...inspectTiles.values(),
        occupied,
        TERRITORY_TILES.find((tile) => tile.id === "champlain:city")!,
        TERRITORY_TILES.find((tile) => tile.territoryId === "green-uplands")!,
      ].map((tile) => [tile.id, tile]),
    );
    for (const tile of representatives.values()) {
      const territory = TERRITORIES.find(
        (territory) => territory.id === tile.territoryId,
      )!;
      const node = network.locator(`[data-map-target="${tile.id}"]`);
      await node.click();
      await expect(node).toHaveAttribute("aria-pressed", "true");
      const detail = network.getByRole("region", {
        name: "Selected territory",
      });
      const heading = detail.getByRole("heading", { level: 3 });
      await expect(detail).toContainText(territoryMapLabel(territory.id));
      await expect(heading).toContainText(TERRAIN_LABELS[tile.terrain]);
      // Inspection hands focus to the detail before another map navigation begins.
      await expect(heading).toBeFocused();
      if (tile.city) {
        await expect(detail).toContainText("No building slot");
        await expect(
          detail.getByRole("button", { name: /^Build/ }),
        ).toHaveCount(0);
      }
      if (tile.id === occupied.id) {
        await expect(detail).toContainText("Building slot occupied");
        await expect(
          detail.getByRole("button", { name: /^Build/ }),
        ).toHaveCount(0);
        await expect(
          detail.getByRole("button", { name: "Inspect plant", exact: true }),
        ).toBeEnabled();
      }
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
    expect(active).not.toBe("champlain:city");
    expect(TERRITORY_TILES.some((tile) => tile.id === active)).toBe(true);
    await expect(
      network.locator(`[data-map-target="${active}"]`),
    ).toHaveAttribute("data-territory", "champlain");
    await expect(
      network.locator(`[data-map-target="${active}"]`),
    ).toBeInViewport();
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
    await expect(detail.getByRole("button", { name: /^Build/ })).toHaveCount(0);
    await expect(detail).toContainText("No building slot");
    const saved = (await readSavedGame(page))!;
    expect(
      saved.utilityExpansion!.acquisitions.map((receipt) => receipt.targetId),
    ).toContain("ridge-electric");
    expect(
      saved.facilities.some(
        (facility) => facility.territoryId === "ridge-electric",
      ),
    ).toBe(true);
    expect(
      saved
        .utilityExpansion!.loans.filter(
          (loan) => loan.targetId === "ridge-electric",
        )
        .map((loan) => loan.kind)
        .sort(),
    ).toEqual(["assumed", "purchase"]);
    expect(saved.transmission!.lines).toEqual([]);
    await expectPhysicalMap(facilities, saved);
    const windTile = territoryTileViews(saved).find(
      (view) =>
        view.tile.territoryId === "ridge-electric" &&
        view.tile.siteKind === "wind" &&
        !view.facility,
    )!.tile;
    await facilities.locator(`[data-map-target="${windTile.id}"]`).click();
    await detail
      .getByRole("button", { name: "Build in Ridge Electric", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Build tile", exact: true }),
    ).toHaveText(territoryBuildTileName(windTile.id, saved));
    await expect(
      page.getByRole("button", {
        name: "Review purchase of Wind",
        exact: true,
      }),
    ).toBeEnabled();
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
  test(`open land cash purchase reserves one physical tile in ${theme}`, async ({
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
    const selectedTile = TERRITORY_TILES.find(
      (tile) =>
        tile.territoryId === "green-uplands" && tile.terrain === "hills",
    )!;
    await facilities.locator(`[data-map-target="${selectedTile.id}"]`).click();
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
      .getByRole("tab", { name: "Territories", exact: true })
      .click();
    await facilities.locator(`[data-map-target="${selectedTile.id}"]`).click();
    await detail
      .getByRole("button", {
        name: `Build in ${territoryMapLabel("green-uplands")}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Build destination", exact: true }),
    ).toHaveText(territoryMapLabel("green-uplands"));
    await expect(
      page.getByRole("combobox", { name: "Build tile", exact: true }),
    ).toHaveText(territoryBuildTileName(selectedTile.id, owned));
    const wind = page.getByRole("listitem").filter({
      has: page.getByRole("button", {
        name: "Review purchase of Wind",
        exact: true,
      }),
    });
    await expect(wind).toContainText("One building slot");
    await wind
      .getByRole("button", { name: "Review purchase of Wind", exact: true })
      .click();
    const buildReview = page.getByRole("dialog", { name: /^Build .* Wind\?/ });
    await expectDialogToFit(buildReview);
    await buildReview
      .getByRole("button", { name: "Pay cash", exact: true })
      .click();
    await expect(buildReview).toHaveCount(0);
    const built = (await readSavedGame(page))!;
    const plant = built.facilities.find(
      (facility) => facility.tileId === selectedTile.id,
    )!;
    expect(built.facilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fuel: "Wind",
          territoryId: "green-uplands",
          tileId: selectedTile.id,
          peakW: 20e6,
        }),
      ]),
    );
    loadSimData(owned.location);
    const quote = getBuildFacilityQuote(
      owned,
      plant,
      "green-uplands",
      selectedTile.id,
    )!;
    const builtTick = built.timeline.find(
      (tick) => tick.minute === built.date.minute,
    )!;
    expect(builtTick.cash).toBeCloseTo(current.cash - quote.buildCost, 1);
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await facilities
      .getByRole("tab", { name: "Territories", exact: true })
      .click();
    await facilities.locator(`[data-map-target="${selectedTile.id}"]`).click();
    await expect(detail).toContainText("Building slot occupied");
    await expect(detail.getByRole("button", { name: /^Build/ })).toHaveCount(0);
    await expect(
      detail.getByRole("button", { name: "Inspect plant", exact: true }),
    ).toBeEnabled();
    await expectPhysicalMap(facilities, built);
    const nextTile = TERRITORY_TILES.find(
      (tile) =>
        tile.territoryId === "green-uplands" &&
        tile.id !== selectedTile.id &&
        tile.siteKind === "general",
    )!;
    await facilities.locator(`[data-map-target="${nextTile.id}"]`).click();
    await detail.getByRole("button", { name: /^Build in / }).click();
    await expect(
      page.getByRole("combobox", { name: "Build tile", exact: true }),
    ).toHaveText(territoryBuildTileName(nextTile.id, built));
    await expect(wind).toContainText("One building slot");
    await expect(
      wind.getByRole("button", {
        name: "Review purchase of Wind",
        exact: true,
      }),
    ).toBeEnabled();
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const resumed = (await readSavedGame(page))!;
    expect(
      resumed.facilities.find((facility) => facility.id === plant.id),
    ).toEqual(plant);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`storage reserves and resumes its selected physical tile in ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=116");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    // Burlington has no pumped-storage sites; reach the battery era without changing geography.
    await editSavedGame(page, ({ game }) => {
      const minute = 60 * MINUTES_PER_MONTH;
      const offset = minute - game.date.minute;
      game.date = getDateFromMinute(minute, game.startingYear);
      game.objectiveProgress = undefined;
      for (const tick of game.timeline) tick.minute += offset;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const before = (await readSavedGame(page))!;
    const tile = territoryTileViews(before).find(
      (view) =>
        view.owned &&
        !view.facility &&
        view.tile.siteKind === "open-land" &&
        view.tile.terrain === "forest",
    )!.tile;
    const facilities = page.locator(".facilities:visible");
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await facilities.locator(`[data-map-target="${tile.id}"]`).click();
    const detail = facilities.getByRole("region", {
      name: "Selected territory",
    });
    await detail.getByRole("button", { name: "Storage", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Build tile", exact: true }),
    ).toHaveText(territoryBuildTileName(tile.id, before));
    await page.getByRole("slider", { name: /^Capacity/ }).press("Home");
    await page
      .getByRole("button", {
        name: "Review purchase of Lithium Battery",
        exact: true,
      })
      .click();
    const review = page.getByRole("dialog", {
      name: /^Build .* Lithium Battery\?/,
    });
    await expectDialogToFit(review);
    await review.getByRole("button", { name: "Pay cash", exact: true }).click();
    await expect(review).toHaveCount(0);
    const built = (await readSavedGame(page))!;
    const storage = built.facilities.find(
      (facility) => facility.tileId === tile.id,
    )!;
    expect(storage).toEqual(
      expect.objectContaining({
        name: "Battery",
        territoryId: "champlain",
        tileId: tile.id,
        peakWh: expect.any(Number),
      }),
    );
    loadSimData(before.location);
    const quote = getBuildFacilityQuote(before, storage, "champlain", tile.id)!;
    const cash = (game: GameType) =>
      game.timeline.find((tick) => tick.minute === game.date.minute)!.cash;
    expect(cash(built)).toBeCloseTo(cash(before) - quote.buildCost, 1);
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await facilities
      .getByRole("tab", { name: "Territories", exact: true })
      .click();
    await facilities.locator(`[data-map-target="${tile.id}"]`).click();
    await expect(detail).toContainText("Building slot occupied");
    await expect(
      detail.getByRole("button", { name: /^Build|^Storage$/ }),
    ).toHaveCount(0);
    await expect(
      detail.getByRole("button", { name: "Inspect plant", exact: true }),
    ).toBeEnabled();
    await expectPhysicalMap(facilities, built);
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    expect(
      (await readSavedGame(page))!.facilities.find(
        (facility) => facility.id === storage.id,
      ),
    ).toEqual(storage);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
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
      await facilities
        .locator(`[data-territory="${customer.id}"]`)
        .first()
        .click();
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
      await expect(detail).toContainText("Connected customers");
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
      const tile = TERRITORY_TILES.find(
        (tile) => tile.territoryId === resource.id,
      )!;
      await facilities.locator(`[data-map-target="${tile.id}"]`).click();
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
            tileId: tile.id,
          }),
        ]),
      );
    });
  }
}
