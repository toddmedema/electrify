import { UnknownAction } from "@reduxjs/toolkit";
import { getPlayedScenarioIds } from "../../LocalStorage";
import { SaveMetadata } from "../../Types";
import type { AppDispatch } from "../../Store";
import { TUTORIALS } from "../../data/Scenarios";
import { navigate } from "../../reducers/Card";
import { start } from "../../reducers/Game";
import { mapDispatchToProps } from "./MainMenuContainer";

jest.mock("../../LocalStorage", () => ({
  ...jest.requireActual("../../LocalStorage"),
  getPlayedScenarioIds: jest.fn(),
}));
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

const mockedPlayed = getPlayedScenarioIds as jest.MockedFunction<
  typeof getPlayedScenarioIds
>;
let entries: SaveMetadata[] = [];

function startFromMenu(): UnknownAction[] {
  const actions: UnknownAction[] = [];
  const dispatch = ((action: UnknownAction) => {
    actions.push(action);
    return action;
  }) as AppDispatch;
  mapDispatchToProps(dispatch, () => entries).onStart();
  return actions;
}

describe("MainMenuContainer onStart", () => {
  beforeEach(() => {
    mockedPlayed.mockReturnValue([]);
    entries = [];
  });

  it("starts Mission 1 immediately for a brand-new player", () => {
    expect(startFromMenu()).toEqual([start(TUTORIALS[0].id)]);
  });

  it("opens the mission list after any tutorial is complete", () => {
    mockedPlayed.mockReturnValue([TUTORIALS[0].id]);
    expect(startFromMenu()).toEqual([navigate("NEW_GAME")]);
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
    expect(startFromMenu()).toEqual([navigate("NEW_GAME")]);
  });
});
