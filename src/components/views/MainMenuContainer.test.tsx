import { UnknownAction } from "@reduxjs/toolkit";
import { achievementJournal } from "../../achievements/Journal";
import { emptyRecord } from "../../achievements/Progress";
import { SaveMetadata } from "../../Types";
import type { AppDispatch } from "../../Store";
import { TUTORIALS } from "../../data/Scenarios";
import { navigate } from "../../reducers/Card";
import { quit, start } from "../../reducers/GameActions";
import { mapDispatchToProps } from "./MainMenuContainer";

jest.mock("../../SaveSession", () => ({
  saveSessionMiddleware:
    () => (next: (action: unknown) => unknown) => (action: unknown) =>
      next(action),
  runSaveTransition: (proceed: () => void) => {
    proceed();
    return Promise.resolve(true);
  },
  resumeSavedGame: jest.fn(),
}));

let entries: SaveMetadata[] = [];

function selectMenuAction(action: "onStart" | "onTutorials"): UnknownAction[] {
  const actions: UnknownAction[] = [];
  const dispatch = ((action: UnknownAction) => {
    actions.push(action);
    return action;
  }) as AppDispatch;
  mapDispatchToProps(dispatch, () => entries)[action]();
  return actions;
}

describe("MainMenuContainer", () => {
  beforeEach(() => {
    localStorage.clear();
    achievementJournal.refresh();
    entries = [];
  });

  it("opens the game selection for a brand-new player", () => {
    expect(selectMenuAction("onStart")).toEqual([navigate("NEW_GAME")]);
  });

  it("starts the next tutorial after a lesson is restored from the account", () => {
    achievementJournal.merge({
      ...emptyRecord(),
      tutorials: [TUTORIALS[0].id],
    });
    expect(selectMenuAction("onTutorials")).toEqual([
      quit(),
      start(TUTORIALS[1].id),
    ]);
  });

  it("opens the mission list when an unfinished save exists", () => {
    entries = [
      {
        id: "saved",
        status: "inProgress",
        createdAt: "2026-10-01",
        lastPlayedAt: "2026-10-01",
      } as SaveMetadata,
    ];
    expect(selectMenuAction("onStart")).toEqual([navigate("NEW_GAME")]);
  });
});
