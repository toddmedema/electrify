import { expect, test } from "./fixtures";
import {
  openMapProjectCatalogue,
  returnToTerritoryMap,
  setMapProjectCapacity,
} from "./layout";
import { currentTick } from "../src/helpers/GameSelectors";
import { readSavedGame } from "./save-fixture";
import { reviewScreenshot } from "./review-screenshot";

for (const theme of ["light", "dark"] as const) {
  test(`build catalogue preserves previews, sizing and responsive entry points · ${theme}`, async ({
    page,
  }, info) => {
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
      expect(await icons.count()).toBeGreaterThan(5);
      for (const icon of await icons.all()) {
        const canonicalName = (await icon.getAttribute("aria-label"))!.replace(
          "Choose sites for ",
          "",
        );
        await expect(icon.locator("img")).toHaveAttribute(
          "src",
          `/images/${canonicalName.toLowerCase()}.svg`,
        );
      }
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
      await expect(
        preview.getByRole("button", {
          name: "Close technology preview",
          exact: true,
        }),
      ).toBeFocused();
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
          name: "Generator power: 30MW",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        rail.getByRole("button", {
          name: "Storage energy: 60MWh",
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
          name: "Generator power: 30MW",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        rail.getByRole("button", {
          name: "Storage energy: 60MWh",
          exact: true,
        }),
      ).toBeVisible();
      await page.setViewportSize({
        width: page.viewportSize()!.width,
        height: 560,
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
        .getByRole("button", { name: /^Choose sites for / })
        .last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport({ ratio: 1 });
      await expect(rail.locator(".desktopBuildPreview")).toHaveCount(0);
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
}
