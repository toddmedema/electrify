import fs from "node:fs/promises";
import path from "node:path";
import { expect, Page, test } from "./fixtures";
import { openBuild, openPane } from "./layout";
import { readShotRequest, ShotRequest } from "./shot-request";

// Runner for `npm run shot`; see scripts/dev/shot.js. It starts the game and opens panes with
// the same helpers the specs use, then writes one small PNG per viewport and theme.
const request = readShotRequest();

const TOOL_LABELS = {
  programs: "Programs",
  insights: "Insights",
  events: "Events",
  scenario: "Scenario",
} as const;

async function openView(page: Page, view: ShotRequest["view"]) {
  if (view === "facilities")
    await openPane(
      page.locator(".facilities:visible"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
  else if (view === "build") await openBuild(page);
  else {
    const label = TOOL_LABELS[view];
    await openPane(
      page.getByRole("region", { name: label, exact: true }),
      page.getByRole("button", { name: label, exact: true }),
    );
  }
}

test("capture", async ({ page, colorScheme }, info) => {
  await page.addInitScript((mode) => {
    // The same preferences the specs set: a fixed theme and no audio.
    localStorage.setItem("theme", mode);
    localStorage.setItem("audioEnabled", "false");
  }, colorScheme ?? "light");
  await page.goto(request.route);
  if (request.game) {
    const start = page.getByRole("button", { name: "Start game", exact: true });
    // An unknown scenario id loads a page without this button; say so instead of letting the
    // click run into the two-minute test timeout.
    await expect(
      start,
      `${request.route} shows no "Start game" button (is the scenario id valid?)`,
    ).toBeVisible();
    await start.click();
    await expect(
      page.getByText("Starting your mission…", { exact: true }),
    ).toBeHidden();
    // A new game starts paused already; make sure, so the capture cannot change mid-delay.
    const running = page
      .getByRole("button", { name: "pause", exact: true })
      .and(page.locator('[aria-pressed="false"]'));
    if (await running.count()) await running.first().click();
    await openView(page, request.view);
  }
  if (request.delay) await page.waitForTimeout(request.delay);

  const file = path.join(
    request.outDir,
    `${request.name}-${info.project.name}.png`,
  );
  await fs.mkdir(request.outDir, { recursive: true });
  const options = { path: file, animations: "disabled" as const };
  let note = "";
  if (request.clip) {
    const matches = page.locator(request.clip);
    await expect(
      matches.first(),
      `--clip ${request.clip} should match a visible element`,
    ).toBeVisible();
    const count = await matches.count();
    if (count > 1) note = `  (first of ${count} matches)`;
    await matches.first().screenshot(options);
  } else await page.screenshot({ ...options, fullPage: request.fullPage });

  const png = await fs.readFile(file);
  // PNG header: width and height are the first two big-endian words after the signature.
  console.log(
    `${file}  ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}  ${Math.max(1, Math.round(png.length / 1024))} KB${note}`,
  );
});
