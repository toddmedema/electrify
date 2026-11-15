import { expect, test } from "./fixtures";
import { openBuild, openPane } from "./layout";
import { reviewScreenshot } from "./review-screenshot";
import { expectDialogToFit } from "./dialog-layout";
import { readSavedGame, readSaveRecords } from "./save-fixture";

for (const theme of ["light", "dark"] as const) {
  test(`territory map has separate usable targets in ${theme}`, async ({
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
    const network = facilities.getByRole("region", {
      name: "Territories",
    });
    const nodes = network.locator(".territoryMapNode");
    await expect(nodes).toHaveCount(4);
    const rectangles = await nodes.evaluateAll((buttons) =>
      buttons.map((button) => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return { name: button.getAttribute("aria-label"), x, y, width, height };
      }),
    );
    for (const [index, rectangle] of rectangles.entries()) {
      expect(
        rectangle.height,
        `${rectangle.name} target height`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        rectangle.width,
        `${rectangle.name} target width`,
      ).toBeGreaterThanOrEqual(44);
      for (const other of rectangles.slice(index + 1)) {
        const intersects =
          rectangle.x < other.x + other.width &&
          rectangle.x + rectangle.width > other.x &&
          rectangle.y < other.y + other.height &&
          rectangle.y + rectangle.height > other.y;
        expect(intersects, `${rectangle.name} overlaps ${other.name}`).toBe(
          false,
        );
      }
    }
    for (const name of [
      "Champlain",
      "Ridge Electric",
      "Valley Electric",
      "Green Uplands",
    ]) {
      const node = network.getByRole("button", {
        name: `Inspect ${name} territory`,
        exact: true,
      });
      await node.click();
      await expect(node).toHaveAttribute("aria-pressed", "true");
      await expect(
        network
          .getByRole("region", { name: "Selected territory" })
          .getByRole("heading", { name, exact: true, level: 3 }),
      ).toBeVisible();
    }
    const uplandsTiles = network.locator(
      '.territoryHex[data-territory="green-uplands"]',
    );
    const terrain = await uplandsTiles.evaluateAll((tiles) =>
      tiles.map((tile) => tile.getAttribute("data-kind")),
    );
    expect(terrain).toEqual(expect.arrayContaining(["hills", "plains"]));
    expect(
      terrain.some((kind) => ["town", "industry", "lake"].includes(kind!)),
    ).toBe(false);
    await network
      .locator(
        '.territoryHex[data-territory="green-uplands"] .territoryHexFace',
      )
      .first()
      .click();
    await expect(
      network.getByRole("button", {
        name: "Inspect Green Uplands territory",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    const home = network.getByRole("button", {
      name: "Inspect Champlain territory",
      exact: true,
    });
    await home.focus();
    await home.press("Space");
    await expect(home).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
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
  test(`Green Uplands cash purchase owns land immediately and reserves a wind site in ${theme}`, async ({
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
        name: "Inspect Green Uplands territory",
        exact: true,
      })
      .click();
    const detail = facilities.getByRole("region", {
      name: "Selected territory",
    });
    const before = (await readSavedGame(page))!;
    await detail.getByRole("button", { name: /Buy Green Uplands/ }).click();
    const review = page.getByRole("dialog", {
      name: "Buy Green Uplands",
      exact: true,
    });
    await expectDialogToFit(review);
    await expect(review).toContainText(
      "No customers, plants or power transfer",
    );
    await expect(review.getByRole("button", { name: /loan/i })).toHaveCount(0);
    await reviewScreenshot(review, {
      path: testInfo.outputPath(`land-cash-review-${theme}.png`),
      scale: "css",
      animations: "disabled",
    });
    await review.getByRole("button", { name: /Buy land/ }).click();
    await expect(review).toHaveCount(0);
    await expect(
      detail.getByRole("button", {
        name: "Build in Green Uplands",
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
        name: "Inspect Green Uplands territory",
        exact: true,
      })
      .click();
    await detail
      .getByRole("button", { name: "Build in Green Uplands", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Build destination", exact: true }),
    ).toHaveText("Green Uplands");
    const wind = page.getByRole("listitem").filter({
      has: page.getByRole("button", {
        name: "Review purchase of Wind",
        exact: true,
      }),
    });
    await expect(wind).toContainText("4 local sites left");
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
    ).toHaveText("Green Uplands");
    await expect(wind).toContainText("3 local sites left");
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
