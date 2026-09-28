import path from "path";
import { expect, Page, test } from "@playwright/test";
import { openPane } from "./layout";

/**
 * Recurring, location-aware wildfire hazards (issue #62) in a custom LA game.
 *
 * The seed is fixed so the run is deterministic: with it, a custom game in Los Angeles starting
 * January 2020 has no ignition from February through August, its first fire starts in September
 * 2020 (inside the August 2020 fire season), and it lasts one month. The seed was
 * verified against the real reducer (runSimulation) before being pinned here; if the hazard's
 * draws or weather data change, re-derive it rather than editing the flow.
 */
const SEED = 25;

// The plan's acceptance line covers desktop and mobile presentation in both themes.
const REVIEW_PROJECTS = new Set(["desktop-chromium", "mobile-390px"]);

async function startSeededLosAngelesGame(
  page: Page,
  theme?: "light" | "dark",
): Promise<void> {
  await page.addInitScript(
    ({ theme: mode }) => {
      window.localStorage.clear();
      if (mode) localStorage.setItem("theme", mode);
      // A prior play keeps the scenario list in its steady state for the assertions below.
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [
            { scenarioId: 0, timesPlayed: 1, date: new Date().toString() },
          ],
        }),
      );
    },
    { theme },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await page.getByRole("button", { name: "View Custom Game details" }).click();
  await expect(
    page.getByRole("heading", { name: "Custom setup" }),
  ).toBeVisible();

  // The default custom game is San Francisco; the hazard profile under test is Los Angeles.
  const search = page.getByRole("combobox", { name: "Search playable cities" });
  await search.click();
  await search.fill("Los Angeles");
  await page.getByRole("option", { name: "Los Angeles, CA" }).click();
  await expect(search).toHaveValue("Los Angeles, CA");

  // Pin the seed so the ignition month is known; the default start year (2020) stays as-is.
  await page.getByRole("textbox", { name: "Seed" }).fill(String(SEED));

  // The default custom fleet (one 500MW gas plant) cannot cover LA's summer peak, so the run
  // would spend its first months in blackout noise. Add a matching plant to keep the grid stable;
  // ignition timing is fleet-independent, so the pinned seed still holds.
  await page.getByRole("combobox", { name: "Facility type" }).click();
  await page.getByRole("option", { name: "Natural Gas" }).click();
  await page.getByRole("button", { name: "Add facility" }).click();
  const outlook = page.getByRole("region", { name: "Year 1 outlook" });
  await expect(outlook).toContainText("Demand covered", { timeout: 20_000 });

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible({
    timeout: 30_000,
  });
}

async function setFastSpeed(page: Page): Promise<void> {
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "fast speed" })
    .first()
    .click();
}

async function openInsightsPane(page: Page): Promise<void> {
  await openPane(
    page.locator(".insights:visible"),
    page.getByRole("button", { name: "Insights", exact: true }),
  );
}

async function openEventsPane(page: Page): Promise<void> {
  await openPane(
    page.locator(".eventLog:visible"),
    page.getByRole("button", { name: "Events", exact: true }),
  );
}

/** The status rows whose height an active event must not change. */
async function statusBarHeights(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    ["#topbar", ".gameStatusBar"].map(
      (selector) =>
        document.querySelector(selector)!.getBoundingClientRect().height,
    ),
  );
}

async function captureReviewScreenshot(
  page: Page,
  testInfo: { project: { name: string }; outputPath: (name: string) => string },
  name: string,
): Promise<void> {
  const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
  if (reviewDir) {
    await page.screenshot({ path: path.join(reviewDir, name), fullPage: true });
  } else {
    await page.screenshot({ path: testInfo.outputPath(name) });
  }
}

for (const theme of ["light", "dark"] as const) {
  // Light starts ongoing preparedness; dark leaves it off, so both branches and both
  // palettes' Events presentation are exercised.
  const fund = theme === "light";

  test(`recurring wildfire: preparedness, onset and recovery (${theme})`, async ({
    page,
  }, testInfo) => {
    test.skip(!REVIEW_PROJECTS.has(testInfo.project.name));
    // Nine simulated months at fast speed plus the setup flow; keep a wide margin.
    test.setTimeout(180_000);

    await startSeededLosAngelesGame(page, theme);
    const heightsBeforeEvents = await statusBarHeights(page);
    await openEventsPane(page);

    // January 2020 is an above-average-risk month for the LA profile, so the seasonal notice is
    // up before anything happens. It explains the risk without revealing a seeded ignition date.
    const notice = page.locator(".wildfireRiskNotice:visible");
    await expect(notice).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Elevated wildfire risk" }),
    ).toBeVisible();
    await expect(notice).toContainText(
      "raise the chance of a wildfire emergency",
    );

    // Preparedness is an optional customer program, never a prompt the clock waits on. The run
    // advances to spring so the next wildfire season is the August 2020 illustration.
    await setFastSpeed(page);
    await expect(page.locator("#appbar:visible").first()).toContainText(
      /(Mar|Apr|May|Jun) 2020/,
      { timeout: 60_000 },
    );
    await openInsightsPane(page);
    // Opening the programs screen pauses the clock, like the build screen.
    await page
      .locator(".insights:visible")
      .getByRole("button", { name: "Customer programs", exact: true })
      .click();
    const programs = page.getByRole("dialog");
    await expect(
      programs.getByRole("button", { name: "Close customer programs" }),
    ).toBeVisible();
    await expect(
      programs.getByRole("button", { name: "pause" }),
    ).toHaveAttribute("aria-pressed", "true");
    await programs
      .getByRole("button", {
        name: /^Wildfire preparedness · Off · .*\/yr$/,
      })
      .click();
    await expect(programs).toContainText("Annual budget");
    await expect(programs).toContainText("no upfront payment");
    await expect(programs).toContainText("Next wildfire season");
    await expect(programs).not.toContainText("One-time cost");
    await expect(programs).not.toContainText("If funded now");
    // The page simulates a typical fire with and without funded crews.
    await expect(
      programs.getByText(/^Customer load disconnected:/),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      programs.getByText(/^Utility cash if this fire strikes:/),
    ).toBeVisible();
    if (fund) {
      await programs
        .getByRole("button", { name: /^Start preparedness \(/ })
        .click();
      await expect(
        programs.getByRole("button", {
          name: /^Wildfire preparedness · On · .*\/yr$/,
        }),
      ).toBeVisible();
    }
    if (fund) {
      await programs
        .getByRole("button", { name: /^Wildfire preparedness · On/ })
        .click();
      await expect(programs).toContainText("On · stays on until turned off");
      await expect(
        programs.getByRole("progressbar", {
          name: "Wildfire preparedness effectiveness",
        }),
      ).toHaveAttribute("aria-valuenow", "0");
      await expect(programs).toContainText(
        "Ramping up · 12 months to full effectiveness",
      );
      await programs
        .getByRole("button", { name: "Turn off preparedness" })
        .click();
      await programs
        .getByRole("button", { name: /^Wildfire preparedness · Off/ })
        .click();
      await programs
        .getByRole("button", { name: /^Start preparedness/ })
        .click();
      await programs
        .getByRole("button", { name: /^Wildfire preparedness · On/ })
        .click();
      await expect(
        programs.getByRole("button", { name: "Turn off preparedness" }),
      ).toBeEnabled();
      await expect(
        programs.getByText(/^Customer load disconnected:/),
      ).toBeVisible({ timeout: 30000 });
    }
    await captureReviewScreenshot(
      page,
      testInfo,
      `wildfire-hazard-preparedness-${theme}-${testInfo.project.name}.png`,
    );
    await programs
      .getByRole("button", { name: "Close customer programs" })
      .click();
    await expect(programs).toHaveCount(0);
    await openEventsPane(page);

    // September 2020: the seeded ignition. A critical event pauses the game and pins an ongoing
    // card in Events with the disconnected share, constrained generators and restoration cost.
    await setFastSpeed(page);
    const ongoing = page.locator(".ongoingEvents:visible");
    await expect(
      page.getByRole("heading", { name: "Ongoing events" }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      ongoing.getByText("Wildfire emergency", { exact: true }),
    ).toBeVisible();
    await expect(ongoing).toContainText(
      /% of customer load is disconnected by safety shutoffs/,
    );
    await expect(ongoing).toContainText(/limited to \d+% output/);
    await expect(ongoing).toContainText(
      /restoration costing \$[\d.,]+[MKmk]? per month/,
    );
    await expect(ongoing).toContainText("Through Sep 2020");
    if (fund) {
      await expect(ongoing).toContainText("Prepared crews are in place");
    } else {
      await expect(ongoing).not.toContainText("Prepared crews are in place");
    }
    // The status bar names the incident beside the grid readout. Desktop keeps its height; on a
    // phone the grid readout and mission share one 44px row until an event chip needs the room,
    // then the mission wraps onto its own 44px row by design.
    const activeEvents = page.locator(".activeEventsChip:visible");
    await expect(activeEvents).toHaveAccessibleName(
      /Active events: Wildfire emergency \(critical\), through Sep 2020/,
    );
    await expect(activeEvents).toHaveClass(/activeEventsChip-critical/);
    if (testInfo.project.name.startsWith("mobile")) {
      const heights = await page.evaluate(() =>
        ["#topbar", ".gridHealth", ".missionSummary"].map(
          (selector) =>
            document.querySelector(selector)!.getBoundingClientRect().height,
        ),
      );
      // The wrapped mission row adds a 1px hairline above its 44px row
      expect(heights).toEqual([heightsBeforeEvents[0], 44, 45]);
    } else {
      expect(await statusBarHeights(page)).toEqual(heightsBeforeEvents);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);

    // The risk notice stays up alongside the incident: September is a peak-risk month.
    await expect(page.locator(".wildfireRiskNotice:visible")).toBeVisible();
    await captureReviewScreenshot(
      page,
      testInfo,
      `wildfire-hazard-events-${theme}-${testInfo.project.name}.png`,
    );

    if (fund) {
      await openInsightsPane(page);
      await page
        .locator(".insights:visible")
        .getByRole("button", { name: "Customer programs", exact: true })
        .click();
      await programs
        .getByRole("button", { name: /^Wildfire preparedness · On/ })
        .click();
      const protection = programs.getByRole("progressbar", {
        name: "Wildfire preparedness effectiveness",
      });
      const effectiveness = Number(
        await protection.getAttribute("aria-valuenow"),
      );
      expect(effectiveness).toBeGreaterThan(0);
      expect(effectiveness).toBeLessThan(100);
      await programs
        .getByRole("button", { name: "Turn off preparedness" })
        .click();
      await programs
        .getByRole("button", { name: /^Wildfire preparedness · Off/ })
        .click();
      await expect(protection).toHaveAttribute(
        "aria-valuenow",
        String(effectiveness),
      );
      await expect(programs).toContainText(
        "Fading · 12 months of protection remaining",
      );
      await expect(
        programs.getByText(/^Customer load disconnected:/),
      ).toBeVisible({ timeout: 30000 });
      await captureReviewScreenshot(
        page,
        testInfo,
        `wildfire-decay-${theme}-${testInfo.project.name}.png`,
      );
      await programs
        .getByRole("button", { name: "Close customer programs" })
        .click();
      await openEventsPane(page);
    }

    // October 2020: the one-month incident expires. Restoration is reported once and the ongoing
    // card clears; the ignition row returns to history.
    await setFastSpeed(page);
    await expect(
      page.getByRole("heading", { name: "Ongoing events" }),
    ).toBeHidden({ timeout: 60_000 });
    await expect(page.locator(".activeEventsChip:visible")).toHaveCount(0);
    await expect(
      page.getByText("Wildfire restoration complete", { exact: true }),
    ).toBeVisible();
  });
}
