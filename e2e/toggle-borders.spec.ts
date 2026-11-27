import { expect, Locator, test, type Page } from "./fixtures";
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

// Pause uses a filled path. The speed chevrons are drawn with a stroke and no fill.
async function speedGlyphPaint(button: Locator): Promise<"fill" | "stroke"> {
  return (await button.getAttribute("aria-label")) === "pause"
    ? "fill"
    : "stroke";
}

/** The speed control marks its selection with a thumb under the pressed segment, not a border. */
async function expectThumbUnder(button: Locator, blue: string) {
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.scrollIntoViewIfNeeded();
  const paint = await speedGlyphPaint(button);
  // The thumb glides and the label's colour eases in behind it, so read until both settle.
  await expect(async () => {
    const thumb = await button.evaluate((element, property) => {
      const group = element.closest(".speedToggles")!;
      const style = getComputedStyle(group, "::before");
      const box = element.getBoundingClientRect();
      const centre =
        group.getBoundingClientRect().left +
        parseFloat(style.left) +
        new DOMMatrix(style.transform).m41 +
        parseFloat(style.width) / 2;
      const glyph = element.querySelector(".speedLabel svg path");
      return {
        background: style.backgroundColor,
        label: glyph
          ? getComputedStyle(glyph)[property]
          : getComputedStyle(element).color,
        offCentre: Math.abs(centre - (box.left + box.width / 2)),
        // The thumb sits beneath the segment, so the label is what a tap lands on.
        labelOnTop: element.contains(
          document.elementFromPoint(box.left + box.width / 2, box.top + 8),
        ),
      };
    }, paint);
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

async function expectHeldSpeedContrast(button: Locator) {
  const page = button.page();
  await button.hover();
  await page.mouse.down();
  try {
    const paint = await button.evaluate(
      (element, property) => {
        const group = element.parentElement!;
        const glyph = element.querySelector(".speedLabel svg path");
        const style = getComputedStyle(element);
        return {
          active: element.matches(":active"),
          ink: glyph ? getComputedStyle(glyph)[property] : style.color,
          floor: glyph ? 3 : 4.5,
          surface: style.backgroundColor,
          underlay: getComputedStyle(
            group,
            element.getAttribute("data-thumb") === "true" ? "::before" : null,
          ).backgroundColor,
          opacity: Number(style.opacity),
        };
      },
      await speedGlyphPaint(button),
    );
    expect(paint.active).toBe(true);
    expect
      .soft(
        contrastRatio(paint.ink, paint.surface, paint.underlay, paint.opacity),
        `held ${await button.getAttribute("aria-label")}`,
      )
      .toBeGreaterThanOrEqual(paint.floor);
  } finally {
    // Release outside so sampling the held control doesn't change the game speed.
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
}

async function expectGlyphContrast(
  button: Locator,
  supportsHover: boolean,
  expectedFill?: string,
) {
  const glyph = button.locator("svg path").first();
  const label = await button.getAttribute("aria-label");
  const settle = () =>
    button.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map(({ finished }) => finished),
      );
    });
  await settle();
  if (expectedFill) await expect(glyph).toHaveCSS("fill", expectedFill);
  expect
    .soft(await foregroundContrast(glyph), `${label} glyph at rest`)
    .toBeGreaterThanOrEqual(3);
  if (supportsHover) {
    await button.hover();
    await settle();
    if (expectedFill) await expect(glyph).toHaveCSS("fill", expectedFill);
    expect
      .soft(await foregroundContrast(glyph), `${label} glyph on hover`)
      .toBeGreaterThanOrEqual(3);
  }
}

async function openDifficulty(page: Page, theme: "light" | "dark") {
  await page.addInitScript((mode) => {
    localStorage.clear();
    localStorage.setItem("theme", mode);
    localStorage.setItem("audioEnabled", "false");
  }, theme);
  await page.goto("/?scenario=111");
  return page.getByRole("group", {
    name: "Difficulty",
    exact: true,
  });
}

async function unlockDifficulty(page: Page) {
  await page.evaluate(
    ({ key, journal }) => {
      localStorage.setItem(key, JSON.stringify(journal));
      dispatchEvent(new StorageEvent("storage", { key }));
    },
    { key: DIFFICULTY_STORAGE_KEY, journal: unlockedJournal },
  );
}

async function startToolbarGame(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const difficulty = await openDifficulty(page, theme);
  await expect(difficulty).toBeVisible();
  await unlockDifficulty(page);
  await difficulty.getByRole("button", { name: "Medium", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".gameStage .facilities")).toBeVisible();
  await page.mouse.move(0, 0);
}

for (const theme of ["light", "dark"] as const) {
  test(`difficulty keeps continuous selected borders in ${theme}`, async ({
    page,
  }, info) => {
    const difficulty = await openDifficulty(page, theme);
    // The opaque locked neighbor must not hide the beginner selection's edge.
    await expectContinuousBorder(
      difficulty.getByRole("button", { name: "Beginner", exact: true }),
    );
    await unlockDifficulty(page);
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
  });

  test(`speed keeps its thumb centred and readable in ${theme}`, async ({
    page,
  }, info) => {
    await startToolbarGame(page, theme);
    const blue = theme === "light" ? "rgb(0, 132, 248)" : "rgb(98, 155, 225)";
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
    }
    await page.mouse.move(0, 0);
    await reviewScreenshot(page, {
      path: info.outputPath(`speed-${theme}.png`),
      animations: "disabled",
    });
  });

  test(`toolbar glyphs maintain contrast at rest, while hovered and while held in ${theme}`, async ({
    page,
  }) => {
    await startToolbarGame(page, theme);
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
    const slow = speeds.getByRole("button", {
      name: "slow speed",
      exact: true,
    });
    await slow.click();
    await expectThumbUnder(slow, blue);
    const pause = speeds.getByRole("button", {
      name: "pause",
      exact: true,
    });
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    const otherGlyph = speeds
      .getByRole("button", { name: "fast speed", exact: true })
      .locator("svg path")
      .first();
    const inactiveInk = await otherGlyph.evaluate(
      (path) => getComputedStyle(path).stroke,
    );
    await expectGlyphContrast(pause, supportsHover, inactiveInk);
    if (supportsHover) {
      await expectHeldSpeedContrast(slow);
      await expectHeldSpeedContrast(pause);
    }
    await pause.click();
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

async function systemPalette(group: Locator) {
  return group.evaluate((element) => {
    // Resolve system colors inside the same document and color scheme as the controls.
    const probe = document.createElement("span");
    probe.style.cssText =
      "forced-color-adjust:none;color:ButtonText;background:ButtonFace;border-color:Highlight;outline-color:HighlightText";
    element.append(probe);
    const style = getComputedStyle(probe);
    const palette = {
      ink: style.color,
      face: style.backgroundColor,
      highlight: style.borderTopColor,
      highlightText: style.outlineColor,
      hover: matchMedia("(hover: hover) and (pointer: fine)").matches,
      forced: matchMedia("(forced-colors: active)").matches,
      dark: matchMedia("(prefers-color-scheme: dark)").matches,
    };
    probe.remove();
    return palette;
  });
}

async function clickAndCheckFirstSpeedFrame(
  button: Locator,
  palette: Awaited<ReturnType<typeof systemPalette>>,
) {
  // Arm the observer before the real click. A Playwright round trip after the
  // click can miss the first frame and read the settled foreground instead.
  const capture = await button.evaluateHandle(
    (element, property) => {
      const label = element.querySelector(".speedLabel")!;
      const glyph = label.querySelector("svg path");
      const sample = () => ({
        button: getComputedStyle(element).color,
        label: getComputedStyle(label).color,
        glyphInk: glyph ? getComputedStyle(glyph)[property] : null,
        thumb: getComputedStyle(element.parentElement!, "::before")
          .backgroundColor,
        track: getComputedStyle(element.parentElement!).backgroundColor,
      });
      const frames = new Promise<ReturnType<typeof sample>[]>((resolve) => {
        const observer = new MutationObserver(() => {
          if (element.getAttribute("data-thumb") !== "true") return;
          observer.disconnect();
          const selected = sample();
          requestAnimationFrame(() => resolve([selected, sample()]));
        });
        observer.observe(element, {
          attributes: true,
          attributeFilter: ["data-thumb"],
        });
      });
      return { frames };
    },
    await speedGlyphPaint(button),
  );
  try {
    await button.click();
    const frames = await capture.evaluate(({ frames }) => frames);
    for (const [index, paint] of frames.entries()) {
      const phase = index === 0 ? "selection" : "first frame";
      expect.soft(paint.thumb, phase).toBe(palette.highlight);
      expect.soft(paint.button, phase).toBe(palette.highlightText);
      expect.soft(paint.label, phase).toBe(palette.highlightText);
      if (paint.glyphInk !== null)
        expect.soft(paint.glyphInk, phase).toBe(palette.highlightText);
      expect
        .soft(
          contrastRatio(
            paint.glyphInk ?? paint.label,
            paint.thumb,
            paint.track,
          ),
          phase,
        )
        .toBeGreaterThanOrEqual(paint.glyphInk === null ? 4.5 : 3);
    }
  } finally {
    await capture.dispose();
  }
}

async function expectSpeedPaint(
  button: Locator,
  palette: Awaited<ReturnType<typeof systemPalette>>,
  state: "selected" | "rest" | "hover" | "focus",
) {
  const paint = await button.evaluate(
    (element, property) => {
      const group = element.parentElement!;
      const glyph = element.querySelector(".speedLabel svg path");
      const style = getComputedStyle(element);
      return {
        ink: glyph ? getComputedStyle(glyph)[property] : style.color,
        floor: glyph ? 3 : 4.5,
        segment: style.backgroundColor,
        track: getComputedStyle(group).backgroundColor,
        thumb: getComputedStyle(group, "::before").backgroundColor,
        outline: style.outlineColor,
      };
    },
    await speedGlyphPaint(button),
  );
  const selected = state === "selected";
  const background = selected ? paint.thumb : paint.segment;
  expect
    .soft(contrastRatio(paint.ink, background, paint.track), state)
    .toBeGreaterThanOrEqual(paint.floor);
  expect
    .soft(paint.ink, state)
    .toBe(selected ? palette.highlightText : palette.ink);
  if (selected) {
    expect(paint.thumb).toBe(palette.highlight);
    expect(paint.segment).toBe("rgba(0, 0, 0, 0)");
  }
  if (state === "hover") expect.soft(paint.segment, state).toBe(palette.face);
  if (state === "focus") {
    await expect(button).toHaveCSS("outline-style", "solid");
    expect
      .soft(contrastRatio(paint.outline, paint.track), "focus ring")
      .toBeGreaterThanOrEqual(3);
  }
}

for (const app of ["light", "dark"] as const) {
  for (const system of ["light", "dark"] as const) {
    test(`forced colors keep speed controls readable with ${app} app and ${system} system`, async ({
      page,
    }) => {
      await page.emulateMedia({
        forcedColors: "active",
        colorScheme: system,
        reducedMotion: "reduce",
      });
      await page.addInitScript(
        (theme) => localStorage.setItem("theme", theme),
        app,
      );
      await page.goto("/?scenario=111");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const speeds = page.getByRole("group", {
        name: "game speed",
        exact: true,
      });
      await expect(speeds).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", app);
      const palette = await systemPalette(speeds);
      expect(palette.forced).toBe(true);
      expect(palette.dark).toBe(system === "dark");

      const pause = speeds.getByRole("button", { name: "pause", exact: true });
      const slow = speeds.getByRole("button", {
        name: "slow speed",
        exact: true,
      });
      for (const [selected, other] of [
        [slow, pause],
        [pause, slow],
      ]) {
        await clickAndCheckFirstSpeedFrame(selected, palette);
        await expect(selected).toHaveAttribute("data-thumb", "true");
        await expect(other).toHaveAttribute("aria-pressed", "false");
        // A pointer click leaves the selected control hovered on desktop.
        await expectSpeedPaint(selected, palette, "selected");
        await page.mouse.move(0, 0);
        await expectSpeedPaint(other, palette, "rest");
        if (palette.hover) {
          await expectHeldSpeedContrast(selected);
          await expectHeldSpeedContrast(other);
          await other.hover();
          await expectSpeedPaint(other, palette, "hover");
          await page.mouse.move(0, 0);
        }
        await selected.press(selected === pause ? "ArrowRight" : "ArrowLeft");
        await expect(other).toBeFocused();
        await expectSpeedPaint(other, palette, "focus");
        await other.press(selected === pause ? "ArrowLeft" : "ArrowRight");
        await expect(selected).toBeFocused();
        await expectSpeedPaint(selected, palette, "selected");
      }
      const build = page
        .getByRole("navigation", { name: "Game actions" })
        .getByRole("button", { name: "Build", exact: true });
      await expect(build).toHaveAttribute("aria-expanded", "false");
      await expectGlyphContrast(build, palette.hover);
      await build.click();
      await expect(build).toHaveAttribute("aria-expanded", "true");
      await page.mouse.move(0, 0);
      await expectGlyphContrast(build, palette.hover);
    });
  }
}
