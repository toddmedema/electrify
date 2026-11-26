import type { Locator } from "@playwright/test";
import { openMapProjectCatalogue, setMapProjectCapacity } from "./layout";
import { TUTORIALS } from "../src/data/Scenarios";
import { expect, type Page } from "./fixtures";

export async function startTutorialMission(
  page: Page,
  id: number,
  theme?: "light" | "dark",
) {
  const ids = TUTORIALS.map((mission) => mission.id);
  await page.addInitScript(
    ({ completed, theme }) => {
      localStorage.setItem("audioEnabled", "false");
      if (theme) localStorage.setItem("theme", theme);
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: completed.map((scenarioId) => ({
            scenarioId,
            timesPlayed: 1,
            date: "2026-11-26",
          })),
        }),
      );
    },
    { completed: ids.slice(0, ids.indexOf(id)), theme },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Tutorials", exact: true }).click();
  await expect(page.locator(".tutorialHud")).toBeVisible();
}

export const tutorialMap = (page: Page) =>
  page.getByRole("region", { name: "Territory map workspace", exact: true });

export const tutorialCoal = (page: Page) =>
  tutorialMap(page).locator('[data-map-facility="Coal"][data-owned="true"]');

export async function openTutorialFleet(page: Page) {
  await tutorialCoal(page).click();
  await expect(
    page.getByRole("dialog", { name: "Coal", exact: true }),
  ).toBeVisible();
  const fleet = page.getByRole("button", { name: "Fleet", exact: true });
  await expect(fleet).toHaveAttribute("aria-expanded", "false");
  await fleet.click();
  await expect(page.locator("#chartSupplyDemand")).toBeVisible();
}

export async function readTutorialSupplyChart(page: Page) {
  await openTutorialFleet(page);
  await page.locator("#chartSupplyDemand").click();
  await expect(
    page.getByRole("button", { name: "slow speed", exact: true }),
  ).toBeVisible();
}

export async function reachableTutorialTile(page: Page, tiles: Locator) {
  const reachableSite = () =>
    tiles.evaluateAll((elements) => {
      const reachable = elements.filter((node) => {
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return node.contains(hit);
      });
      const preferred = reachable.find(
        (node) => node.getAttribute("data-terrain") === "plains",
      );
      return (preferred ?? reachable[0])?.getAttribute("data-map-target") ?? "";
    });
  await expect.poll(reachableSite).not.toBe("");
  return tutorialMap(page).locator(
    `[data-map-target="${await reachableSite()}"]`,
  );
}

async function reviewTutorialProject(
  page: Page,
  name: string,
  storage = false,
  size?: string,
) {
  const catalogue = await openMapProjectCatalogue(page);
  const desktop = await catalogue.evaluate((node) =>
    node.classList.contains("desktopBuildRail"),
  );
  if (!desktop && storage) {
    await catalogue.getByRole("tab", { name: "Storage", exact: true }).click();
  }
  if (size) await setMapProjectCapacity(catalogue, storage, size);
  const choose = catalogue.getByRole("button", {
    name: `${desktop ? "Choose sites" : "Pick site"} for ${desktop && name === "Lithium Battery" ? "Battery" : name}`,
    exact: true,
  });
  await choose.click();
  const sites = tutorialMap(page).locator(
    '[data-project-site="owned"]:visible',
  );
  await expect(sites.first()).toBeVisible();
  const touch = await page.evaluate(
    () => matchMedia("(pointer: coarse)").matches,
  );
  if (!touch) {
    await sites.first().press("Enter");
    return;
  }
  await (await reachableTutorialTile(page, sites)).tap();
}

export async function buildTutorialProject(
  page: Page,
  name: string,
  storage = false,
  size?: string,
) {
  await reviewTutorialProject(page, name, storage, size);
  await tutorialMap(page)
    .getByRole("button", { name: "Loan", exact: true })
    .click();
}
