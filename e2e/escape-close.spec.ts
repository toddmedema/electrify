import path from "path";
import { expect, Locator, Page, test } from "./fixtures";

test.setTimeout(90_000);
test.use({ actionTimeout: 12_000 });

// Observe the outgoing card before closing it, so even a fast browser cannot miss the
// animation. Keep the result on the persistent transition group after the card unmounts.
async function observeExit(screen: Locator): Promise<void> {
  await screen.evaluate((element) => {
    const card = element.closest("main")!;
    const group = card.parentElement!;
    delete group.dataset.exitProperty;
    delete group.dataset.exitTransform;
    const observer = new MutationObserver(() => {
      if (
        !Array.from(card.classList).some((name) =>
          name.endsWith("-exit-active"),
        )
      )
        return;
      const style = getComputedStyle(card);
      group.dataset.exitProperty = style.transitionProperty;
      group.dataset.exitTransform = style.transform;
      observer.disconnect();
    });
    observer.observe(card, { attributes: true, attributeFilter: ["class"] });
  });
}

async function expectFade(page: Page): Promise<void> {
  const group = page.locator(".cardTransitions");
  await expect(group).toHaveAttribute("data-exit-property", "opacity");
  await expect(group).toHaveAttribute("data-exit-transform", "none");
  await expect(page.locator(".buildFacilities")).toHaveCount(0);
  await expect(page.locator(".facilities")).toBeVisible();
  await expect(page.locator("main.base_main")).toHaveCount(1);
}

for (const theme of ["light", "dark"] as const) {
  test(`Escape matches Close across every build category in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator(".facilities")).toBeVisible();
    await expect(page.locator("main.base_main")).toHaveCount(1);
    await page.keyboard.press("0");

    for (const { category, from, open } of [
      { category: "Generators", from: "w", open: "g" },
      { category: "Storage", from: "r", open: "s" },
      { category: "Interties", from: "q", open: "g" },
    ]) {
      for (const close of ["button", "Escape"]) {
        await page.keyboard.press(from);
        await expect(page.locator("main.base_main")).toHaveCount(1);
        await page.keyboard.press(open);
        const catalog = page.locator(".buildFacilities");
        await expect(catalog).toBeVisible();
        await expect(page.locator("main.base_main")).toHaveCount(1);
        // Exercise replacement history as well as opening the category directly.
        await catalog
          .getByRole("tab", { name: "Storage", exact: true })
          .click();
        await catalog.getByRole("tab", { name: category, exact: true }).click();
        await expect(
          catalog.getByRole("tab", { name: category, exact: true }),
        ).toHaveAttribute("aria-selected", "true");

        const shots = process.env.REVIEW_SCREENSHOT_DIR;
        if (
          shots &&
          category === "Generators" &&
          close === "Escape" &&
          ((theme === "light" &&
            testInfo.project.name === "desktop-chromium") ||
            (theme === "dark" && testInfo.project.name === "mobile-390px"))
        ) {
          await page.screenshot({
            animations: "disabled",
            path: path.join(
              shots,
              `build-${testInfo.project.name}-${theme}.png`,
            ),
          });
        }

        await observeExit(catalog);
        if (close === "button") {
          await catalog
            .getByRole("button", { name: "close", exact: true })
            .click();
        } else {
          // Escape also works when a capacity slider has retained keyboard focus.
          await catalog.getByRole("slider").first().focus();
          await page.keyboard.press("Escape");
        }
        await expectFade(page);
      }
    }
  });
}

test("Escape dismisses nested build dialogs before fading the catalog", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=111");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".facilities")).toBeVisible();
  await expect(page.locator("main.base_main")).toHaveCount(1);
  await page.keyboard.press("g");
  const catalog = page.locator(".buildFacilities");
  await expect(catalog).toBeVisible();
  await expect(page.locator("main.base_main")).toHaveCount(1);
  await catalog
    .locator('button[aria-label^="Review purchase of"]:enabled')
    .first()
    .click();
  const purchase = page.getByRole("dialog");
  await expect(purchase).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(purchase).toHaveCount(0);
  await expect(catalog).toBeVisible();

  const firstOption = catalog.locator(".buildOption").first();
  await firstOption.getByRole("button", { name: /^Show .* details$/ }).click();
  await firstOption
    .getByRole("button", { name: /^What is / })
    .first()
    .click();
  const help = page.getByRole("dialog", { name: "Manual help" });
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  // The hotkey guard remains active until the popover's exit transition unmounts it.
  await expect(page.locator('[data-manual-help="true"]')).toHaveCount(0);
  await expect(catalog).toBeVisible();

  await observeExit(catalog);
  await page.keyboard.press("Escape");
  await expectFade(page);
});

test("Escape matches Back for Manual, Settings, and Saved games", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=111");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".facilities")).toBeVisible();
  await expect(page.locator("main.base_main")).toHaveCount(1);
  await page.keyboard.press("0");

  for (const title of ["Manual", "Settings", "Saved games"]) {
    for (const close of ["Back", "Escape"]) {
      await page.keyboard.press("r");
      await expect(page.locator("main.base_main")).toHaveCount(1);
      await page.locator(".gameMenuButton").click();
      await page.getByRole("menuitem", { name: title, exact: true }).click();
      const heading = page.getByRole("heading", { name: title, exact: true });
      await expect(heading).toBeVisible();
      await expect(page.locator("main.base_main")).toHaveCount(1);
      await observeExit(heading);
      if (close === "Back")
        await page.getByRole("button", { name: "Back", exact: true }).click();
      else {
        if (title === "Manual")
          await page
            .getByRole("textbox", { name: "Search the manual" })
            .focus();
        await page.keyboard.press("Escape");
      }
      await expect(page.locator(".cardTransitions")).toHaveAttribute(
        "data-exit-property",
        "transform",
      );
      await expect(heading).toHaveCount(0);
      await expect(page.locator("main.base_main")).toHaveCount(1);
      await expect(page.locator(".gameMenuButton")).toBeVisible();
    }
  }
});
