import { readFile } from "fs/promises";
import { expect, test } from "@playwright/test";
import { decodeSave } from "../src/SaveEncoding";
import type { GameType } from "../src/Types";

test("exports compact JSON and imports it into the same paused game", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("audioEnabled", "false"));
  await page.goto("/?scenario=101");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await page.getByRole("button", { name: "menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export save", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^electrify-.*\.json$/);
  const file = (await download.path())!;
  const wire = JSON.parse(await readFile(file, "utf8"));
  expect(wire.game.timeline.shapes.length).toBeGreaterThan(0);
  expect(wire.game.timeline.rows).toHaveLength(96);
  const exported = decodeSave(wire) as { game: GameType };

  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Save game file").setInputFiles(file);
  await page
    .getByRole("dialog", { name: "Load this save?" })
    .getByRole("button", { name: "Load game", exact: true })
    .click();
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const restoredWire = await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    return JSON.parse(localStorage.getItem("savedGame")!);
  });
  const restored = decodeSave(restoredWire) as { game: GameType };
  expect(restored.game.date).toEqual(exported.game.date);
  expect(restored.game.facilities).toEqual(exported.game.facilities);
  expect(restored.game.timeline).toEqual(exported.game.timeline);
  expect(restored.game.monthlyHistory).toEqual(exported.game.monthlyHistory);
});
