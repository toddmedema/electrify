import { expect, test } from "./fixtures";
import path from "node:path";
import { createCouchFixture } from "./couch-fixture";

test("TV couch companies keep independent dialogs and purchases through atomic save and resume", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Two seat renderer journey at 1080p in each palette",
  );
  const couch = await createCouchFixture(context, page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play with friends", exact: true })
    .click();
  await page.getByRole("button", { name: "On this TV", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "On this TV · Two players" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose a game", exact: true }),
  ).toBeDisabled();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect(
    page.getByText("Controller joined", { exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Choose a game", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View Carbon Fee details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start for everyone", exact: true })
    .click();
  const start = page
    .getByRole("dialog")
    .getByRole("button", { name: "Start for everyone", exact: true });
  await expect(start).toBeDisabled();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect.poll(() => couch.seats.size).toBe(2);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  for (const seat of [p1, p2]) {
    await expect(seat.locator("#appbar:visible")).toBeVisible();
    await expect(seat.locator(".gameStage")).toHaveAttribute(
      "data-layout",
      "tv",
    );
  }
  await expect.poll(() => couch.checkpoint()?.grids.length).toBe(2);
  const originalCounts = couch
    .checkpoint()!
    .grids.map((grid) => grid.facilities.length);
  await couch.input({ "101": ["build"], "202": ["build"] });
  const build1 = p1.getByRole("region", { name: "Build", exact: true });
  const build2 = p2.getByRole("region", { name: "Build", exact: true });
  await expect(build1).toBeVisible();
  await expect(build2).toBeVisible();
  const review1 = build1.getByRole("button", {
    name: "Review purchase of Solar",
    exact: true,
  });
  const review2 = build2.getByRole("button", {
    name: "Review purchase of Solar",
    exact: true,
  });
  // Each document retains its own real focus; both devices confirm in the same sample.
  await review1.focus();
  await review2.focus();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  const purchase1 = p1.getByRole("dialog");
  const purchase2 = p2.getByRole("dialog");
  await expect(purchase1).toBeVisible();
  await expect(purchase2).toBeVisible();
  await purchase1
    .getByRole("button", { name: "Take loan", exact: true })
    .focus();
  await purchase2
    .getByRole("button", { name: "Take loan", exact: true })
    .focus();
  await couch.input({ "101": ["confirm"] });
  await expect(purchase1).toHaveCount(0);
  await expect(purchase2).toBeVisible();
  await expect(
    purchase2.getByRole("button", { name: "Take loan", exact: true }),
  ).toBeFocused();
  await couch.input({ "202": ["confirm"] });
  await expect(purchase2).toHaveCount(0);
  await expect(build1).toHaveCount(0);
  await expect(build2).toHaveCount(0);
  await p2.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(
    p2.getByRole("region", { name: "Insights", exact: true }),
  ).toBeVisible();
  await p1.evaluate(() =>
    window.electrifyCouch!.post({
      kind: "global-settings",
      requestId: "p1-settings",
    }),
  );
  const globalSettings = page.getByRole("dialog", {
    name: "P1 Utility: TV session settings",
    exact: true,
  });
  await expect(
    globalSettings.getByRole("heading", {
      name: "P1 Utility: TV session settings",
      exact: true,
    }),
  ).toBeVisible();
  await p2.evaluate(() =>
    window.electrifyCouch!.post({
      kind: "global-settings",
      requestId: "p2-settings",
    }),
  );
  // A competing request keeps the first named owner. The partner's controls are gated.
  await couch.input({ "202": ["build"] });
  await expect(
    globalSettings.getByRole("heading", {
      name: "P1 Utility: TV session settings",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    p2.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await globalSettings
    .getByRole("button", { name: "Return to all companies", exact: true })
    .click();
  await expect(globalSettings).toHaveCount(0);
  await expect(purchase1).toHaveCount(0);
  await expect(
    p2.getByRole("region", { name: "Insights", exact: true }),
  ).toBeVisible();
  await expect(
    p1.getByRole("region", { name: "Insights", exact: true }),
  ).toHaveCount(0);
  await expect(p2.locator(".insights:visible .uplot").first()).toBeVisible();
  // A purchase review remains usable while the partner's real forecast/chart is open.
  await couch.input({ "101": ["build"] });
  await build1
    .getByRole("button", { name: "Review purchase of Solar", exact: true })
    .focus();
  await couch.input({ "101": ["confirm"] });
  await expect(purchase1).toBeVisible();
  await expect(
    p2.getByRole("region", { name: "Insights", exact: true }),
  ).toBeVisible();
  for (const seat of [p1, p2]) {
    const dismiss = seat.getByRole("button", {
      name: "Dismiss notification",
      exact: true,
    });
    if (await dismiss.isVisible()) await dismiss.click();
    await expect(dismiss).toHaveCount(0);
  }
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await p1.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-p1-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
    await p2.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-p2-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
  }
  await couch.input({ "101": ["back"] });
  await expect(purchase1).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save & Quit for everyone", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save & Quit", exact: true })
    .click();
  await expect.poll(() => couch.seats.size).toBe(0);
  const complete = couch.checkpoint()!;
  expect(complete.grids.map((grid) => grid.facilities.length)).toEqual(
    originalCounts.map((count) => count + 1),
  );
  expect(complete.edges).toHaveLength(1);
  expect(Object.keys(complete.receipts)).toEqual(
    expect.arrayContaining(["local-p1", "local-p2"]),
  );
  await page
    .getByRole("button", { name: "Play with friends", exact: true })
    .click();
  await page.getByRole("button", { name: "On this TV", exact: true }).click();
  await page.getByRole("button", { name: /^Resume Local campaign/ }).click();
  await expect(
    page.getByRole("button", { name: "Review saved game", exact: true }),
  ).toBeDisabled();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect(
    page.getByText("Controller joined", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Review saved game", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review saved game", exact: true })
    .click();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect.poll(() => couch.seats.size).toBe(2);
  await expect.poll(() => couch.checkpoint()?.epoch).not.toBe(complete.epoch);
  expect(
    couch.checkpoint()!.grids.map((grid) => grid.facilities.length),
  ).toEqual(complete.grids.map((grid) => grid.facilities.length));
});
