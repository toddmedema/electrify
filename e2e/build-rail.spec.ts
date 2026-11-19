import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import {
  openMapProjectCatalogue,
  returnToTerritoryMap,
  setMapProjectCapacity,
} from "./layout";
import { currentTick } from "../src/helpers/GameSelectors";
import { readSavedGame } from "./save-fixture";
import { reviewScreenshot } from "./review-screenshot";

async function startMap(page: Page, theme: "light" | "dark") {
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

for (const theme of ["light", "dark"] as const) {
  test(`build catalogue preserves previews, sizing and responsive entry points · ${theme}`, async ({
    page,
  }, info) => {
    const network = await startMap(page, theme);
    const before = (await readSavedGame(page))!;
    const rail = network.getByRole("complementary", {
      name: "Build facilities",
      exact: true,
    });
    const desktop = page.viewportSize()!.width >= 1024;
    const surface = network.locator(".tileWorkspaceSurface");
    await expect(surface).toHaveCount(0);

    if (desktop) {
      // Every available technology is discoverable before opening Build.
      await expect(rail).toBeVisible();
      const icons = rail.getByRole("button", { name: /^Choose sites for / });
      const artwork = await icons.evaluateAll((buttons) =>
        buttons.map((button) => ({
          name: button
            .getAttribute("aria-label")!
            .replace("Choose sites for ", ""),
          source: button.querySelector("img")?.getAttribute("src"),
        })),
      );
      expect(artwork.length).toBeGreaterThan(5);
      for (const { name, source } of artwork)
        expect(source).toBe(`/images/${name.toLowerCase()}.svg`);
      const energy = rail.getByRole("button", { name: /^Energy:/ });
      await energy.hover();
      const energySizing = rail.getByRole("region", { name: "Energy sizing" });
      await expect(energySizing).toBeVisible();
      const anchor = (await energy.boundingBox())!;
      const sliderBounds = (await energySizing.boundingBox())!;
      expect(sliderBounds.x).toBeGreaterThanOrEqual(anchor.x + anchor.width);
      expect(
        Math.abs(
          sliderBounds.y +
            sliderBounds.height / 2 -
            anchor.y -
            anchor.height / 2,
        ),
      ).toBeLessThanOrEqual(32);
      await energySizing.hover();
      await expect(energySizing.getByRole("slider")).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(energySizing).toHaveCount(0);
      await energy.click();
      await page.mouse.move(0, 0);
      await expect(energySizing.getByRole("slider")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(energySizing).toHaveCount(0);
      const wind = rail.getByRole("button", {
        name: "Choose sites for Wind",
        exact: true,
      });
      await wind.hover();
      const preview = rail.getByRole("region", {
        name: "Wind technology preview",
        exact: true,
      });
      await expect(preview).toBeVisible();
      const previewBounds = (await preview.boundingBox())!;
      const dockBounds = (await page.locator(".gameActionDock").boundingBox())!;
      expect(previewBounds.y + previewBounds.height).toBeLessThanOrEqual(
        dockBounds.y - 8,
      );
      await expect(rail.locator(".desktopBuildPreview")).toHaveCount(1);
      for (const label of [
        "Build cost",
        "Build time",
        "Lifetime cost",
        "Expected capacity factor",
      ])
        await expect(preview.getByText(label, { exact: true })).toBeVisible();
      await expect(preview.locator(".buildOptionDescription")).not.toBeEmpty();
      await expect(page.getByRole("dialog", { name: /^Build / })).toHaveCount(
        0,
      );
      await reviewScreenshot(network, {
        path: info.outputPath(`build-rail-preview-${theme}.png`),
      });
      await wind.focus();
      await expect(wind).toHaveAttribute("aria-keyshortcuts", "ArrowRight");
      await wind.press("ArrowRight");
      await expect(preview).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0);
      await expect(wind).toBeFocused();
      await expect(surface).toHaveCount(0);
    } else {
      await expect(rail).toHaveCount(0);
    }

    const catalogue = await openMapProjectCatalogue(page);
    await setMapProjectCapacity(catalogue, false, "11");
    if (!desktop)
      await catalogue
        .getByRole("tab", { name: "Storage", exact: true })
        .click();
    await setMapProjectCapacity(catalogue, true, "14");
    if (desktop) {
      await expect(
        rail.getByRole("button", {
          name: "Power: 30MW",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        rail.getByRole("button", {
          name: "Energy: 60MWh",
          exact: true,
        }),
      ).toBeVisible();
    } else {
      await expect(catalogue.locator(".projectSize strong")).toHaveText(
        "60MWh",
      );
      await catalogue
        .getByRole("tab", { name: "Generators", exact: true })
        .click();
      await expect(
        catalogue.getByRole("slider", {
          name: "Generator capacity",
          exact: true,
        }),
      ).toHaveValue("11");
      await expect(catalogue.locator(".projectSize strong")).toHaveText("30MW");
    }
    await catalogue
      .getByRole("button", { name: "Choose sites for Wind", exact: true })
      .click();
    await expect(
      surface.getByRole("heading", { name: "Wind · 30MW", exact: true }),
    ).toBeVisible();
    await expect(surface.getByText("Choose a highlighted site.")).toBeVisible();
    await surface
      .getByRole("button", { name: "Change project", exact: true })
      .click();

    if (desktop) {
      await expect(rail).toBeFocused();
      await expect(surface).toHaveCount(0);
      await expect(
        rail.getByRole("button", {
          name: "Power: 30MW",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        rail.getByRole("button", {
          name: "Energy: 60MWh",
          exact: true,
        }),
      ).toBeVisible();
    } else {
      await expect(
        surface.getByRole("heading", { name: "Plan a project", exact: true }),
      ).toBeVisible();
      await expect(
        surface.getByRole("tab", { name: "Generators", exact: true }),
      ).toBeVisible();
      await expect(
        surface.getByRole("tab", { name: "Storage", exact: true }),
      ).toBeVisible();
      await expect(rail).toHaveCount(0);
    }
    const after = (await readSavedGame(page))!;
    expect(currentTick(after)!.cash).toBe(currentTick(before)!.cash);
    expect(after.territoryNetwork!.tilePurchases).toEqual(
      before.territoryNetwork!.tilePurchases,
    );
    expect(after.facilities).toEqual(before.facilities);
  });

  test(`short build rail keeps keyboard previews reachable while scrolling · ${theme}`, async ({
    page,
  }) => {
    const width = page.viewportSize()!.width;
    test.skip(width < 1024, "The short build rail is a desktop layout");
    await page.setViewportSize({ width, height: 560 });
    const network = await startMap(page, theme);
    const rail = network.getByRole("complementary", {
      name: "Build facilities",
      exact: true,
    });
    const technologies = rail.getByRole("group", {
      name: "Construction technology list",
      exact: true,
    });
    expect(
      await technologies.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    ).toBeGreaterThan(0);
    const last = technologies
      .getByRole("button", { name: /^Choose sites for /, disabled: false })
      .last();
    await technologies.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(last).not.toBeInViewport();
    await rail.focus();
    const stepsToLast = await last.evaluate((button) => {
      const buttons = Array.from(
        button.closest(".desktopBuildRail")!.querySelectorAll("button:enabled"),
      );
      return buttons.indexOf(button) + 1;
    });
    for (let index = 0; index < stepsToLast; index++)
      await page.keyboard.press("Tab");
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport({ ratio: 1 });
    const lastName = (await last.getAttribute("aria-label"))!.replace(
      "Choose sites for ",
      "",
    );
    const lastPreview = rail.getByRole("region", {
      name: `${lastName} technology preview`,
      exact: true,
    });
    await expect(lastPreview).toBeVisible();
    await last.press("ArrowRight");
    await expect(lastPreview).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(last).toBeFocused();
    await expect(lastPreview).toHaveCount(0);
    await last.press("ArrowRight");
    await expect(lastPreview).toBeVisible();
    const scrollBefore = await technologies.evaluate(
      (element) => element.scrollTop,
    );
    const listBounds = (await technologies.boundingBox())!;
    await page.mouse.move(listBounds.x + 2, listBounds.y + 8);
    await page.mouse.wheel(0, -100);
    await expect(rail.locator(".desktopBuildPreview")).toHaveCount(0);
    await expect
      .poll(() => technologies.evaluate((element) => element.scrollTop))
      .toBeLessThan(scrollBefore);
    const geometry = await rail.evaluate((element) => {
      const rail = element.getBoundingClientRect();
      const map = element
        .parentElement!.querySelector(".territoryMap")!
        .getBoundingClientRect();
      return {
        left: rail.left,
        right: rail.right,
        top: rail.top,
        bottom: rail.bottom,
        mapLeft: map.left,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.mapLeft + 1);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(560);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
  });
}
