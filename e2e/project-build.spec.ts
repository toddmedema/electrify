import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { readSavedGame } from "./save-fixture";
import {
  readTerritoryMapCamera,
  openMapProjectCatalogue,
  returnToTerritoryMap,
  setMapProjectCapacity,
} from "./layout";
import { getTerritoryTile } from "../src/helpers/TerritoryTiles";
import { hexCenter } from "../src/components/base/TerritoryHexGeometry";
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
async function chooseSite(page: Page, id: string) {
  const tile = getTerritoryTile(id)!;
  const point = hexCenter(tile);
  const viewport = page.locator(".territoryMapViewport");
  for (let attempt = 0; attempt < 20; attempt++) {
    const camera = await readTerritoryMapCamera(viewport);
    const dx = (camera.x - point.x) * camera.scale;
    const dy = (camera.y - point.y) * camera.scale;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
    const box = (await viewport.boundingBox())!;
    const step = Math.min(
      1,
      (box.width * 0.25) / Math.max(1, Math.abs(dx)),
      (box.height * 0.2) / Math.max(1, Math.abs(dy)),
    );
    const x = box.x + box.width / 2,
      y = box.y + 40;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y);
    await page.mouse.move(x + dx * step, y + dy * step, { steps: 4 });
    await page.mouse.up();
  }
  const target = page.locator(`[data-map-target="${id}"]`);
  // The public focus handler brings the physical tile into the camera before activation.
  await target.focus();
  await target.press("Enter");
  await expect(target).toHaveAttribute("aria-pressed", "true");
  return target;
}
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
    const owned = await chooseSite(page, "champlain:site-13");
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
    const target = await chooseSite(page, "green-uplands:site-1");
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
