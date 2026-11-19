import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { readSavedGame } from "./save-fixture";
import {
  openMapProjectCatalogue,
  returnToTerritoryMap,
  selectTerritoryMapTile,
  setMapProjectCapacity,
} from "./layout";
import { getTerritoryTile } from "../src/helpers/TerritoryTiles";
import { currentTick } from "../src/helpers/GameSelectors";
import { reviewScreenshot } from "./review-screenshot";
import { loadSimData } from "../src/testing/SimData";
import {
  projectCatalogue,
  projectSiteCapitalCost,
  projectSiteQuote,
  selectProject,
} from "../src/helpers/ProjectBuild";
import { formatMoneyConcise } from "../src/helpers/Format";

async function start(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((mode) => {
    localStorage.setItem("theme", mode);
    localStorage.setItem("audioEnabled", "false");
  }, theme);
  await page.goto("/?scenario=116");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const pause = page.getByRole("button", { name: "pause", exact: true });
  await expect(pause).toBeVisible();
  if ((await pause.getAttribute("aria-pressed")) !== "true")
    await pause.click();
  const network = await returnToTerritoryMap(page);
  await expect(
    page.locator("#appbar:visible [data-save-state]").first(),
  ).toHaveAttribute("data-save-state", "saved");
  return network;
}

test("keeps project actions reachable on a short landscape display", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 320 });
  await start(page, "light");
  const catalogue = await openMapProjectCatalogue(page);
  await setMapProjectCapacity(catalogue, false, "10");
  await catalogue
    .getByRole("button", { name: "Choose sites for Wind" })
    .click();
  await selectTerritoryMapTile(page, getTerritoryTile("champlain:site-13")!);
  const surface = page.getByRole("dialog", { name: "Wind · 20MW" });
  const review = surface.getByRole("button", { name: "Review project" });
  await expect(review).toBeInViewport({ ratio: 1 });
  await review.click();
  await expect(
    page
      .getByRole("dialog", { name: "Build Wind?" })
      .getByRole("button", { name: "Build project" }),
  ).toBeInViewport({ ratio: 1 });
});

for (const theme of ["light", "dark"] as const) {
  test(`plans before connecting, retains size across sites, and builds the exact site · ${theme}`, async ({
    page,
  }, testInfo) => {
    const network = await start(page, theme);
    const before = (await readSavedGame(page))!;
    await expect(
      network.getByRole("button", { name: "Build", exact: true }),
    ).toHaveCount(0);
    await network
      .getByRole("button", { name: "Rapid connection mode", exact: true })
      .click();
    await expect(network.locator(".territoryMap")).toHaveAttribute(
      "data-buy-mode",
      "true",
    );
    const catalogue = await openMapProjectCatalogue(page);
    const surface = page.locator(".tileWorkspaceSurface");
    await setMapProjectCapacity(catalogue, false, "10");
    await catalogue
      .getByRole("button", { name: "Choose sites for Wind", exact: true })
      .click();
    await expect(network.locator(".territoryMap")).toHaveAttribute(
      "data-buy-mode",
      "false",
    );
    await expect(
      surface.getByText("Choose a highlighted site.", { exact: true }),
    ).toBeVisible();
    await expect(
      network.locator('[data-project-site="owned"]').first(),
    ).toBeVisible();
    await expect(
      network.locator('[data-project-site="connection"]').first(),
    ).toBeVisible();
    loadSimData(before.location);
    const project = selectProject(
      projectCatalogue(before, 20e6, false).find(
        ({ name }) => name === "Wind",
      )!,
    );
    const owned = await selectTerritoryMapTile(
      page,
      getTerritoryTile("champlain:site-13")!,
    );
    const ownedQuote = projectSiteQuote(before, project, "champlain:site-13");
    expect(ownedQuote.facility).toBeDefined();
    if (!ownedQuote.facility)
      throw new Error("Owned site has no project quote");
    await expect(owned.locator(".territoryTilePrice")).toHaveAttribute(
      "title",
      `Total project cost ${formatMoneyConcise(projectSiteCapitalCost(ownedQuote))} · Already connected`,
    );
    await expect(
      surface.getByRole("heading", { name: "Wind · 20MW", exact: true }),
    ).toBeVisible();
    await expect(surface.getByText("Already connected · $0")).toBeVisible();
    const target = await selectTerritoryMapTile(
      page,
      getTerritoryTile("green-uplands:site-1")!,
    );
    const connectionQuote = projectSiteQuote(
      before,
      project,
      "green-uplands:site-1",
    );
    expect(connectionQuote.facility).toBeDefined();
    if (!connectionQuote.facility)
      throw new Error("Adjacent site has no project quote");
    expect(connectionQuote.connectionCost).toBeGreaterThan(0);
    expect(connectionQuote.facility.buildCost).not.toBe(
      ownedQuote.facility.buildCost,
    );
    await expect(target.locator(".territoryTilePrice")).toHaveAttribute(
      "title",
      `Total project cost ${formatMoneyConcise(projectSiteCapitalCost(connectionQuote))} · Connection included`,
    );
    await expect(
      surface.getByRole("heading", { name: "Wind · 20MW", exact: true }),
    ).toBeVisible();
    for (const label of [
      "Connection cost",
      "Project cost",
      "Cash required now",
      "Cash remaining",
      "Expected output",
      "Estimated online",
    ])
      await expect(surface.getByText(label, { exact: true })).toBeVisible();
    const initialCosts = await surface
      .locator(".projectFacts > div")
      .evaluateAll((facts) => {
        const scroll = facts[0].closest(".projectCandidateScroll")!;
        const bounds = scroll.getBoundingClientRect();
        return facts.slice(0, 2).map((fact) => {
          const value = fact.querySelector("dd")!.getBoundingClientRect();
          return {
            valueTop: value.top,
            valueBottom: value.bottom,
            visibleTop: bounds.top,
            visibleBottom: bounds.bottom,
          };
        });
      });
    for (const cost of initialCosts) {
      expect(cost.valueTop).toBeGreaterThanOrEqual(cost.visibleTop);
      expect(cost.valueBottom).toBeLessThanOrEqual(cost.visibleBottom + 1);
    }
    const explored = (await readSavedGame(page))!;
    expect(currentTick(explored)!.cash).toBe(currentTick(before)!.cash);
    expect(explored.territoryNetwork!.tilePurchases).toEqual(
      before.territoryNetwork!.tilePurchases,
    );
    if (page.viewportSize()!.width < 741) {
      const sheet = (await surface.boundingBox())!;
      const map = (await network.locator(".territoryMap").boundingBox())!;
      const tile = (await target.boundingBox())!;
      expect(sheet.height).toBeLessThanOrEqual(map.height * 0.55 + 1);
      expect(sheet.y - map.y).toBeGreaterThanOrEqual(160);
      expect(tile.y + tile.height).toBeLessThanOrEqual(sheet.y + 1);
    }
    await reviewScreenshot(network, {
      path: testInfo.outputPath(`project-candidate-${theme}.png`),
    });
    await surface
      .getByRole("button", { name: "Review project", exact: true })
      .click();
    await expect(
      surface.getByRole("heading", {
        name: "Connect and build Wind?",
        exact: true,
      }),
    ).toBeVisible();
    await surface
      .getByRole("radio", {
        name: "Loan · connection paid in cash",
        exact: true,
      })
      .check();
    const loanTerms = surface.getByText(/Down payment/);
    await expect(loanTerms).toBeVisible();
    await loanTerms.scrollIntoViewIfNeeded();
    const confirm = surface.getByRole("button", {
      name: "Connect & build",
      exact: true,
    });
    await expect(confirm).toBeEnabled();
    await expect(confirm).toBeInViewport();
    await reviewScreenshot(network, {
      path: testInfo.outputPath(`project-review-loan-${theme}.png`),
    });
    await confirm.click();
    await expect(surface).toHaveCount(0);
    const built = (await readSavedGame(page))!;
    expect(
      built.facilities.find(
        (facility) => facility.tileId === "green-uplands:site-1",
      ),
    ).toMatchObject({ name: "Wind", peakW: 20e6 });
    expect(built.territoryNetwork!.tilePurchases).toHaveLength(
      before.territoryNetwork!.tilePurchases!.length + 1,
    );
  });
}
