import type { Page } from "@playwright/test";
import type { GameType } from "../src/Types";

/** Exercise populated standings through the real native-score adapter, without a native window. */
export async function installLeaderboardFixture(
  page: Page,
  currentRank: number,
) {
  await page.addInitScript((rank) => {
    const display = {
      fullscreen: false,
      width: 1280,
      height: 800,
      resolutions: [],
    };
    const steamId = "76561198000000001";
    let submitted:
      | {
          scenarioId: number;
          difficulty: GameType["difficulty"];
          score: number;
        }
      | undefined;
    const noop = () => () => {};
    window.electrifyDesktop = {
      apiVersion: 1,
      getState: async () => ({
        display,
        steam: {
          available: true,
          online: true,
          cloudEnabled: false,
          steamId,
          displayName: "Current operator",
        },
      }),
      setDisplay: async () => display,
      onStateChanged: noop,
      onGameFocusChanged: noop,
      onBeforeQuit: noop,
      readyToQuit: () => {},
      quit: async () => {},
      openFriends: async () => {},
      readSaveLibrary: async () => ({
        local: null,
        cloud: null,
        cloudState: "disabled",
      }),
      writeSaveLibrary: async () => ({ cloudState: "disabled" }),
      submitScore: async ({ scenarioId, difficulty, score }) => {
        submitted = { scenarioId, difficulty, score: Math.round(score) };
      },
      getLeaderboard: async (selection) =>
        selection.scope === "player"
          ? submitted
            ? [
                {
                  ...submitted,
                  steamId,
                  displayName: "Current operator",
                  rank,
                },
              ]
            : []
          : [
              "Lakeside Municipal Electricity Cooperative",
              "Northern Wind",
              "Solar operator",
            ].map((displayName, i) => ({
              steamId: `7656119800000000${i + 2}`,
              displayName,
              score: 1000 - i * 100,
              rank: i + 1,
              scenarioId: selection.scenarioId,
              difficulty: selection.difficulty || "VP",
            })),
    };
  }, currentRank);
}
