import { expect, test } from "./fixtures";
import {
  reachableTutorialTile,
  startTutorialMission,
  tutorialMap,
} from "./tutorial-fixture";

const missions = [
  { name: "Electricity", id: 0, actions: [] },
  { name: "Generators", id: 1, actions: ["Fleet", "Build"] },
  { name: "Storage", id: 2, actions: ["Fleet", "Build"] },
  { name: "Finances", id: 4, actions: ["Fleet", "Build", "Insights"] },
  {
    name: "Pricing",
    id: 3,
    actions: ["Fleet", "Build", "Programs", "Insights"],
  },
  {
    name: "Forecasting",
    id: 5,
    actions: ["Fleet", "Build", "Programs", "Insights"],
  },
  {
    name: "Trade",
    id: 112,
    actions: ["Fleet", "Trade", "Build", "Programs", "Insights", "Events"],
  },
];

for (const mission of missions) {
  test(`${mission.name} shows taught tools and a reachable tutorial target${mission.id === 0 ? " @phone" : mission.id === 112 ? " @minimum-phone" : ""}`, async ({
    page,
  }, info) => {
    await startTutorialMission(
      page,
      mission.id,
      info.project.use.hasTouch ? "dark" : "light",
    );
    const desktop =
      (await tutorialMap(page).getAttribute("data-desktop-build-rail")) ===
      "true";
    const dock = page.getByRole("navigation", { name: "Game actions" });
    const actions = mission.actions.filter(
      (name) => !(desktop && name === "Build"),
    );
    await expect(dock.getByRole("button")).toHaveCount(actions.length);
    for (const name of actions) {
      await expect(
        dock.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(page.locator("#scenarioNav")).toHaveCount(0);
    await expect(
      tutorialMap(page).getByRole("complementary", {
        name: "Build facilities",
      }),
    ).toHaveCount(Number(desktop && mission.actions.includes("Build")));

    for (const [name, key] of [
      ["Fleet", "q"],
      ["Fleet", "f"],
      ["Trade", "w"],
      ["Trade", "a"],
      ["Events", "e"],
      ["Programs", "r"],
      ["Programs", "p"],
      ["Insights", "t"],
      ["Insights", "i"],
      ["Scenario", "y"],
      ["Scenario", "s"],
      ["Build", "b"],
      ["Build", "g"],
      ["Build", "Shift+s"],
    ]) {
      if (mission.actions.includes(name)) continue;
      await page.keyboard.press(key);
      await expect(
        page.locator(".gameToolPanel:visible, .tileWorkspaceBuilding:visible"),
        `${key} should leave ${name} closed`,
      ).toHaveCount(0);
    }
    const target = page.locator(".tutorialTarget").first();
    await expect(target).toBeInViewport();
    await target.click({ trial: true });
    await expect(
      page.locator(".tutorialTargetRing:visible").first(),
    ).toBeVisible();
  });
}

test("matches the build hint to the actual workspace at large interface scale", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => localStorage.setItem("interfaceScale", "1.5"));
  await startTutorialMission(page, 1);
  const hint = page.locator(".tutorialHud");
  await expect(hint).toContainText("Open Build");
  const build = page.getByRole("button", { name: "Build", exact: true });
  await expect(build).toHaveClass(/tutorialTarget/);
  await build.click();
  await expect(
    page.getByRole("button", { name: "Pick site for Natural Gas Peaker" }),
  ).toHaveClass(/tutorialTarget/);
});

test("keeps the tutorial Build lock on both map entry points", async ({
  page,
}) => {
  await startTutorialMission(page, 0);
  const emptySites = tutorialMap(page).locator(
    '[data-map-target^="champlain:site-"][data-owned="true"][data-terrain="plains"]:not([data-map-facility])',
  );
  const site = await reachableTutorialTile(page, emptySites);
  await site.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await site.press("Enter");
  await expect(page.locator(".tileWorkspaceInspector")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Build here", exact: true }),
  ).toHaveCount(0);
});
