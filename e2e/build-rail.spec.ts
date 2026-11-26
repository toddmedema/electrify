import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import {
  openMapProjectCatalogue,
  returnToTerritoryMap,
  setMapProjectCapacity,
} from "./layout";
import { currentTick } from "../src/helpers/GameSelectors";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../src/helpers/DateTime";
import { editSavedGame, readSavedGame } from "./save-fixture";
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

test("wheeling over Power or Energy steps its size in both axes", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Uses the desktop rail");
  const network = await startMap(page, "dark");
  const rail = network.getByRole("complementary", { name: "Build facilities" });
  const technologies = rail.getByRole("group", {
    name: "Construction technology list",
  });

  for (const [label, initial] of [
    ["Power", 10],
    ["Energy", 18],
  ] as const) {
    const control = rail.getByRole("button", {
      name: new RegExp(`^${label}:`),
    });
    await control.hover();
    const slider = rail
      .getByRole("region", { name: `${label} sizing` })
      .getByRole("slider");
    await expect(slider).toHaveValue(String(initial));
    const scrollTop = await technologies.evaluate((list) => list.scrollTop);

    for (const [dx, dy, step] of [
      [0, -100, 1],
      [100, 0, 2],
      [0, 100, 1],
      [-100, 0, 0],
    ]) {
      await page.mouse.wheel(dx, dy);
      await expect(slider).toHaveValue(String(initial + step));
    }
    expect(await technologies.evaluate((list) => list.scrollTop)).toBe(
      scrollTop,
    );
    await expect(control).toHaveAttribute("aria-expanded", "true");
  }
  await page.mouse.wheel(0, -100);
  await expect(
    rail.getByRole("button", { name: "Energy: 200MWh" }),
  ).toBeVisible();
  await reviewScreenshot(page, {
    path: info.outputPath("map-build-sizing.png"),
  });
});

test("dragging a facility selects a compatible site and waits for confirmation", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Uses the desktop rail");
  const network = await startMap(page, "dark");
  const before = (await readSavedGame(page))!;
  const wind = network.getByRole("button", {
    name: "Choose sites for Wind",
    exact: true,
  });
  const project = network.getByRole("dialog", { name: /^Wind ·/ });
  const city = network.locator(
    '[data-map-target="champlain:city"] .territoryTileHitArea',
  );
  const site = network.locator('[data-map-target="champlain:site-13"]');

  await expect(wind).toHaveAttribute("draggable", "true");
  await wind.dragTo(city);
  await expect(wind).toHaveAttribute("aria-pressed", "false");
  await expect(project).toHaveCount(0);

  await wind.dragTo(site.locator(".territoryTileHitArea"));
  await expect(wind).toHaveAttribute("aria-pressed", "true");
  await expect(site).toHaveAttribute("aria-pressed", "true");
  await expect(
    project.getByRole("button", { name: "Cash", exact: true }),
  ).toBeVisible();
  await expect(
    project.getByRole("button", { name: "Loan", exact: true }),
  ).toBeVisible();
  await reviewScreenshot(page, {
    path: info.outputPath("dragged-project-review.png"),
    scale: "css",
  });
  const after = (await readSavedGame(page))!;
  expect(after.facilities).toEqual(before.facilities);
  expect(after.territoryNetwork!.tilePurchases).toEqual(
    before.territoryNetwork!.tilePurchases,
  );
  expect(currentTick(after)!.cash).toBe(currentTick(before)!.cash);
});

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
    const tileSurfaces = page.locator(".tileWorkspaceSurface");
    await expect(tileSurfaces).toHaveCount(0);

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
      for (const [category, label] of [
        ["Generators", "Power"],
        ["Storage", "Energy"],
      ]) {
        const heading = rail.getByRole("heading", {
          name: category,
          exact: true,
        });
        const sizing = rail.getByRole("button", {
          name: new RegExp(`^${label}:`),
        });
        expect((await heading.boundingBox())!.y).toBeLessThan(
          (await sizing.boundingBox())!.y,
        );
      }
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
      const generator = preview.getByRole("table", {
        name: "generator properties",
      });
      await expect(generator.getByRole("rowheader")).toHaveText([
        "Build cost",
        "Build time",
        "Lifetime cost",
        "Expected capacity factor",
        "Direct emissions",
      ]);
      await expect(
        preview.getByText(/Compared with typical buildable generators/),
      ).toHaveCount(0);
      const advanced = preview.getByRole("button", { name: "Advanced" });
      await expect(advanced).toHaveAttribute("aria-expanded", "false");
      const advancedGenerator = preview.getByRole("table", {
        name: "advanced generator properties",
      });
      await expect(advancedGenerator).toHaveCount(0);
      const readouts = await generator.getByRole("row").evaluateAll((rows) =>
        rows.slice(0, 4).map((row) => {
          const label = row.children[0];
          const value = row.children[1];
          return {
            labelLeft: label.getBoundingClientRect().left,
            valueRight: value.getBoundingClientRect().right,
            divider: getComputedStyle(value).borderBottom,
            height: row.getBoundingClientRect().height,
          };
        }),
      );
      expect(readouts).toEqual(Array(4).fill(readouts[0]));
      await expect(preview.locator(".buildOptionDescription")).not.toBeEmpty();
      await expect(page.getByRole("dialog", { name: /^Build / })).toHaveCount(
        0,
      );
      await reviewScreenshot(preview, {
        path: info.outputPath(`build-rail-preview-${theme}.png`),
      });
      await wind.focus();
      await expect(wind).toHaveAttribute("aria-keyshortcuts", "ArrowRight");
      await wind.press("ArrowRight");
      await expect(preview).toBeFocused();
      await advanced.focus();
      await page.keyboard.press("Enter");
      await expect(advanced).toHaveAttribute("aria-expanded", "true");
      await expect(
        advancedGenerator.getByRole("rowheader", {
          name: "Typical monthly output",
        }),
      ).toBeVisible();
      await page.keyboard.press("Space");
      await expect(advancedGenerator).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0);
      await expect(wind).toBeFocused();
      await expect(tileSurfaces).toHaveCount(0);

      await wind.click();
      await expect(wind).toHaveAttribute("aria-pressed", "true");
      await expect(
        surface.getByText("Choose a highlighted site."),
      ).toBeVisible();
      await expect(
        network.locator("[data-project-site]").first(),
      ).toBeVisible();
      await wind.click();
      await expect(wind).toHaveAttribute("aria-pressed", "false");
      await expect(tileSurfaces).toHaveCount(0);
      await expect(network.locator("[data-project-site]")).toHaveCount(0);
    } else {
      await expect(rail).toHaveCount(0);
    }

    const build = page.getByRole("button", { name: "Build", exact: true });
    if (!desktop) {
      await build.click();
      await expect(build).toHaveAttribute("aria-expanded", "true");
      await expect(build).toHaveClass(/gameDockActionOpen/);
      await build.click();
      await expect(build).toHaveAttribute("aria-expanded", "false");
      await expect(tileSurfaces).toHaveCount(0);
    }
    const months = page.getByRole("button", { name: /months left$/ });
    const scenario = page.getByRole("region", {
      name: "Scenario",
      exact: true,
    });
    await months.click();
    await expect(scenario).toBeVisible();
    await months.click();
    await expect(scenario).toHaveCount(0);
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
      await expect(
        catalogue.locator(".constructionCapacity strong"),
      ).toHaveText("60MWh");
      await catalogue
        .getByRole("tab", { name: "Generators", exact: true })
        .click();
      await expect(
        catalogue.getByRole("slider", {
          name: "Generator capacity",
          exact: true,
        }),
      ).toHaveValue("11");
      await expect(
        catalogue.locator(".constructionCapacity strong"),
      ).toHaveText("30MW");
    }
    if (!desktop) {
      const windCard = catalogue.locator('[data-build-option="Wind"]');
      await expect(windCard.getByRole("img", { name: "Wind" })).toBeVisible();
      await expect(
        windCard.getByText("Build time", { exact: true }),
      ).toBeVisible();
      await expect(
        windCard.getByRole("button", { name: "Show Wind details" }),
      ).toBeVisible();
      const screenshotDir = process.env.REVIEW_SCREENSHOT_DIR;
      if (screenshotDir && info.project.name === "mobile-390px")
        await catalogue.screenshot({
          path: `${screenshotDir}/valley-project-${theme}.png`,
        });
    }
    await catalogue
      .getByRole("button", {
        name: desktop ? "Choose sites for Wind" : "Pick site for Wind",
        exact: true,
      })
      .click();
    await expect(
      surface.getByRole("heading", { name: "Wind · 30MW", exact: true }),
    ).toBeVisible();
    await expect(surface.getByText("Choose a highlighted site.")).toBeVisible();
    if (!desktop) {
      await expect(build).toHaveAttribute("aria-expanded", "true");
      await reviewScreenshot(page, {
        path: info.outputPath("pick-project-site.png"),
        scale: "css",
      });
    }
    await expect(
      surface.getByRole("button", { name: "Change project", exact: true }),
    ).toHaveCount(0);
    await expect(surface.getByText(/total project .*cost/)).toHaveCount(0);
    await surface
      .getByRole("button", { name: "Close project", exact: true })
      .click();

    if (desktop) {
      await expect(rail).toBeFocused();
      await expect(tileSurfaces).toHaveCount(0);
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
      await openMapProjectCatalogue(page);
      await expect(
        surface.getByRole("heading", { name: "Build", exact: true }),
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

  test(`storage hover shows five readouts with advanced details on demand · ${theme}`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== "desktop-chromium",
      "Hover rail uses the desktop project",
    );
    await startMap(page, theme);
    await editSavedGame(page, ({ game }) => {
      // Compare lithium and iron-air batteries after both enter the catalogue.
      const minute = (2031 - game.startingYear) * 12 * MINUTES_PER_MONTH;
      const offset = minute - game.date.minute;
      game.date = getDateFromMinute(minute, game.startingYear);
      game.objectiveProgress = undefined;
      for (const tick of game.timeline) tick.minute += offset;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const network = await returnToTerritoryMap(page);
    const rail = network.getByRole("complementary", {
      name: "Build facilities",
      exact: true,
    });
    await rail
      .getByRole("button", { name: "Choose sites for Battery", exact: true })
      .hover();
    const battery = rail.getByRole("region", {
      name: "Battery technology preview",
      exact: true,
    });
    const storage = battery.getByRole("table", { name: "storage properties" });
    await expect(storage.getByRole("rowheader")).toHaveText([
      "Build cost",
      "Build time",
      "Discharge power",
      "Duration at full power",
      "Round-trip efficiency",
    ]);
    await expect(
      battery.getByText("Compared with typical buildable storage"),
    ).toBeVisible();
    await expect(
      storage
        .getByRole("row", { name: /^Round-trip efficiency/ })
        .getByText("Better"),
    ).toHaveAttribute("data-tone", "good");
    await expect(
      storage.getByRole("row", { name: /^Build cost/ }).getByText("Worse"),
    ).toHaveAttribute("data-tone", "bad");
    const advanced = battery.getByRole("button", { name: "Advanced" });
    await expect(advanced).toHaveAttribute("aria-expanded", "false");
    await reviewScreenshot(battery, {
      path: info.outputPath(`build-rail-battery-${theme}.png`),
    });
    await advanced.click();
    await expect(advanced).toHaveAttribute("aria-expanded", "true");
    await expect(
      battery
        .getByRole("table", { name: "advanced storage properties" })
        .getByRole("rowheader"),
    ).toHaveText([
      "Fixed operating cost",
      "Ramp up/down time",
      "Accounting lifetime",
      "Stored energy lost per hour",
      "Construction emissions",
    ]);
    await reviewScreenshot(battery, {
      path: info.outputPath(`build-rail-battery-advanced-${theme}.png`),
    });
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
