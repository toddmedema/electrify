import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { editSavedGame } from "./save-fixture";

for (const theme of ["light", "dark"]) {
  test(`facility motion preserves facts and layout in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("theme", theme);
      localStorage.setItem("audioEnabled", "false");
      // Observe real CSS starts: a brief effect can finish before a locator polls it.
      document.addEventListener("animationstart", (event) => {
        const name = (event as AnimationEvent).animationName;
        document.documentElement.dataset.motionSeen = `${document.documentElement.dataset.motionSeen || ""} ${name}`;
      });
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await pane.getByRole("button", { name: "Build", exact: true }).click();
    await page
      .getByRole("button", { name: /^Review purchase of / })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Pay cash" })
      .click();
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-motion-seen",
      /facilityArrival/,
    );
    // The new row is highlighted but left collapsed
    await expect(pane.locator(".facilityRow.selected")).toHaveCount(0);

    // Resume a real saved run just before commissioning; loading must not celebrate it.
    const commissionedId = await editSavedGame(page, (save) => {
      const plant = save.game.facilities.reduce((latest, candidate) =>
        candidate.id > latest.id ? candidate : latest,
      );
      plant.yearsToBuildLeft = 0.00005;
      plant.paused = true;
      return plant.id;
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await expect(pane.locator(".facilityReadyLabel")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-motion-seen",
      /facilityArrival/,
    );
    const row = pane.locator(`[data-rfd-draggable-id="f${commissionedId}"]`);
    await row.locator(".facilityDisclosure").click();
    await row
      .locator(".facilityRowHeader")
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.evaluate(() => document.fonts.ready);
    await page
      .getByRole("button", { name: "normal speed", exact: true })
      .click();
    await expect(row.locator(".facilityReadyLabel")).toHaveText("Ready");
    await page.screenshot({
      path: info.outputPath(`commissioned-${theme}.png`),
    });
    await page.getByRole("button", { name: "pause", exact: true }).click();
    await expect(row.locator(".facilityStatus")).toContainText("paused");
    expect(
      await row.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await expect(row.locator(".facilityReadyLabel")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await row.locator(".facilityDisclosure").click();
    await row.locator(".facilityDisclosure").click();
    await expect(row.locator(".facilityDetails")).toHaveCSS(
      "animation-name",
      "none",
    );
  });
}

test("exchange direction stays readable on narrow screens and with reduced motion", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem("insightsLayers", JSON.stringify(["powerExchange"]));
  });
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const fleet = page.locator(".facilities:visible");
  await openPane(
    fleet,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  await fleet.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("tab", { name: "Interties", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Review purchase of Pacific Northwest intertie",
    })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Pay cash" })
    .click();
  await editSavedGame(page, (save) => {
    save.game.transmission!.lines[0].yearsToBuildLeft = 0;
    // Guarantee a local shortfall: a gas plant can cover demand even with coal paused.
    // This test exercises import presentation, not the scenario's generation balance.
    for (const plant of save.game.facilities) {
      plant.paused = true;
      plant.currentW = 0;
    }
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const insights = page.locator(".insights:visible");
  await openPane(
    insights,
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  const exchange = page.locator(".powerExchangeSummary");
  await exchange.scrollIntoViewIfNeeded();
  // Loading restores the saved timeline. Let dispatch refresh the edited fleet and line.
  await expect(page.getByRole("group", { name: "game speed" })).toHaveCount(1);
  await page.getByRole("button", { name: "normal speed", exact: true }).click();
  await expect(
    exchange.getByRole("heading", { name: "Importing" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "pause", exact: true }).click();
  await expect(
    exchange.getByRole("heading", { name: "Importing" }),
  ).toBeVisible();
  await expect(exchange.locator(".powerExchangeArrow")).not.toHaveAttribute(
    "data-moving",
  );
  // Phone navigation briefly keeps both cards mounted during the existing slide.
  await expect(page.getByRole("group", { name: "game speed" })).toHaveCount(1);
  await page.getByRole("button", { name: "normal speed", exact: true }).click();
  await expect(
    exchange.getByRole("heading", { name: "Importing" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "pause", exact: true }).click();
  await expect(exchange.locator(".powerExchangeArrow")).not.toHaveAttribute(
    "data-moving",
  );
  expect(
    await exchange.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("exchange-dark.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(exchange.locator(".powerExchangeArrow svg")).toHaveCSS(
    "animation-name",
    "none",
  );
});
