import { expect, Locator, test } from "./fixtures";
import { DIFFICULTY_STORAGE_KEY, unlockedJournal } from "./difficulty-fixture";
import { reviewScreenshot } from "./review-screenshot";
import { contrastRatio, foregroundContrast } from "./contrast";

async function expectContinuousBorder(button: Locator) {
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.scrollIntoViewIfNeeded();
  const border = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    const { left, right, top, height } = element.getBoundingClientRect();
    // Grouped buttons overlap by one pixel. Computed colors alone cannot detect
    // the following segment painting over the selected segment's right border.
    return {
      colors: [
        style.borderTopColor,
        style.borderRightColor,
        style.borderBottomColor,
        style.borderLeftColor,
      ],
      ownsEdges: [left + 0.5, right - 0.5].map((x) =>
        element.contains(document.elementFromPoint(x, top + height / 2)),
      ),
    };
  });
  expect(
    new Set(border.colors).size,
    "all selected borders use one color",
  ).toBe(1);
  expect(border.colors[0]).not.toBe("rgba(0, 0, 0, 0)");
  expect(
    border.ownsEdges,
    "neighboring segments must not cover selected borders",
  ).toEqual([true, true]);
}

/** The speed control marks its selection with a thumb under the pressed segment, not a border. */
async function expectThumbUnder(button: Locator, blue: string) {
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.scrollIntoViewIfNeeded();
  // The thumb glides and the label's colour eases in behind it, so read until both settle.
  await expect(async () => {
    const thumb = await button.evaluate((element) => {
      const group = element.closest(".speedToggles")!;
      const style = getComputedStyle(group, "::before");
      const box = element.getBoundingClientRect();
      const centre =
        group.getBoundingClientRect().left +
        parseFloat(style.left) +
        new DOMMatrix(style.transform).m41 +
        parseFloat(style.width) / 2;
      return {
        background: style.backgroundColor,
        label: getComputedStyle(element.querySelector("svg") ?? element).color,
        offCentre: Math.abs(centre - (box.left + box.width / 2)),
        // The thumb sits beneath the segment, so the label is what a tap lands on.
        labelOnTop: element.contains(
          document.elementFromPoint(box.left + box.width / 2, box.top + 8),
        ),
      };
    });
    expect(thumb.background, "the thumb uses the logo blue").toBe(blue);
    expect(
      thumb.offCentre,
      "the thumb is under the pressed speed",
    ).toBeLessThanOrEqual(1);
    expect(thumb.labelOnTop, "the thumb never covers its label").toBe(true);
    // Dark label ink keeps both variants of the logo-blue thumb readable.
    expect(
      contrastRatio(thumb.label, thumb.background),
      "the pressed label is readable on the thumb",
    ).toBeGreaterThanOrEqual(4.5);
  }).toPass({ timeout: 10000 });
}

async function expectGlyphContrast(
  button: Locator,
  supportsHover: boolean,
  blue?: string,
) {
  const glyph = button.locator("svg").first();
  const label = await button.getAttribute("aria-label");
  const settle = () =>
    button.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map(({ finished }) => finished),
      );
    });
  await settle();
  if (blue) await expect(glyph).toHaveCSS("fill", blue);
  expect
    .soft(await foregroundContrast(glyph), `${label} glyph at rest`)
    .toBeGreaterThanOrEqual(3);
  if (supportsHover) {
    await button.hover();
    await settle();
    if (blue) await expect(glyph).toHaveCSS("fill", blue);
    expect
      .soft(await foregroundContrast(glyph), `${label} glyph on hover`)
      .toBeGreaterThanOrEqual(3);
  }
}

for (const theme of ["light", "dark"]) {
  test(`difficulty keeps continuous selected borders and speed keeps its thumb in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    const difficulty = page.getByRole("group", {
      name: "Difficulty",
      exact: true,
    });
    // The opaque locked neighbor must not hide the beginner selection's edge.
    await expectContinuousBorder(
      difficulty.getByRole("button", { name: "Beginner", exact: true }),
    );
    await page.evaluate(
      ({ key, journal }) => {
        localStorage.setItem(key, JSON.stringify(journal));
        dispatchEvent(new StorageEvent("storage", { key }));
      },
      { key: DIFFICULTY_STORAGE_KEY, journal: unlockedJournal },
    );
    for (const name of ["Beginner", "Easy", "Medium", "Hard", "Expert"]) {
      const button = difficulty.getByRole("button", { name, exact: true });
      await button.click();
      await expectContinuousBorder(button);
    }
    await difficulty
      .getByRole("button", { name: "Medium", exact: true })
      .click();
    await page.mouse.move(0, 0);
    await reviewScreenshot(page.locator(".scenarioStartControls"), {
      path: info.outputPath(`difficulty-${theme}.png`),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator(".gameStage .facilities")).toBeVisible();
    await page.mouse.move(0, 0);
    const blue = theme === "light" ? "rgb(0, 132, 248)" : "rgb(98, 155, 225)";
    const supportsHover = await page.evaluate(
      () => matchMedia("(hover: hover) and (pointer: fine)").matches,
    );
    const build = page
      .getByRole("navigation", { name: "Game actions" })
      .getByRole("button", { name: "Build", exact: true });
    await expect(build).toHaveAttribute("aria-expanded", "false");
    await expectGlyphContrast(build, supportsHover, blue);
    const speeds = page.getByRole("group", { name: "game speed", exact: true });
    for (const name of [
      "pause",
      "slow speed",
      "normal speed",
      "fast speed",
      "pause",
    ]) {
      const button = speeds.getByRole("button", { name, exact: true });
      await button.click();
      await expectThumbUnder(button, blue);
      if (name === "slow speed") {
        const pause = speeds.getByRole("button", {
          name: "pause",
          exact: true,
        });
        await expect(pause).toHaveAttribute("aria-pressed", "false");
        await expectGlyphContrast(pause, supportsHover, blue);
      }
    }
    await page.mouse.move(0, 0);
    await reviewScreenshot(page, {
      path: info.outputPath(`speed-${theme}.png`),
      animations: "disabled",
    });
    await build.click();
    await expect(build).toHaveAttribute("aria-expanded", "true");
    await page.mouse.move(0, 0);
    await expectGlyphContrast(build, supportsHover);
  });

  test(`settings keep continuous selected borders in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const name of ["Appearance", "Units"]) {
      const group = page.getByRole("group", { name, exact: true });
      for (const button of await group.getByRole("button").all()) {
        await button.click();
        await expectContinuousBorder(button);
      }
      if (name === "Appearance") {
        await group
          .getByRole("button", {
            name: theme === "light" ? "Light" : "Dark",
            exact: true,
          })
          .click();
      }
    }
    // Keyboard focus must remain above a neighboring selected segment as well.
    const units = page.getByRole("group", { name: "Units", exact: true });
    await units.getByRole("button", { name: "Metric", exact: true }).click();
    await page.keyboard.press("ArrowRight");
    const imperial = units.getByRole("button", {
      name: "Imperial",
      exact: true,
    });
    await expect(imperial).toBeFocused();
    await expect(imperial).toHaveCSS("outline-style", "solid");
    expect(
      await imperial.evaluate((element) => {
        const { left, top, height } = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(left + 0.5, top + height / 2),
        );
      }),
      "keyboard focus stays above the selected neighbor",
    ).toBe(true);
    await page.locator(".screenHeaderTitle").click();
    await page.mouse.move(0, 0);
    await reviewScreenshot(page, {
      path: info.outputPath(`settings-${theme}.png`),
      animations: "disabled",
    });
  });
}
