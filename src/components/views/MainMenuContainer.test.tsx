import { UnknownAction } from "@reduxjs/toolkit";
import { getPlayedScenarioIds } from "../../LocalStorage";
import { resumableSave } from "../../SaveFile";
import type { AppDispatch } from "../../Store";
import { TUTORIALS } from "../../data/Scenarios";
import { navigate } from "../../reducers/Card";
import { start } from "../../reducers/Game";
import { mapDispatchToProps } from "./MainMenuContainer";

jest.mock("../../LocalStorage", () => ({
  ...jest.requireActual("../../LocalStorage"),
  getPlayedScenarioIds: jest.fn(),
}));
jest.mock("../../SaveFile", () => ({
  resumableSave: jest.fn(),
}));

const mockedPlayed = getPlayedScenarioIds as jest.MockedFunction<
  typeof getPlayedScenarioIds
>;
const mockedResumableSave = resumableSave as jest.MockedFunction<
  typeof resumableSave
>;

function startFromMenu(): UnknownAction[] {
  const actions: UnknownAction[] = [];
  const dispatch = ((action: UnknownAction) => {
    actions.push(action);
    return action;
  }) as AppDispatch;
  mapDispatchToProps(dispatch).onStart();
  return actions;
}

describe("MainMenuContainer onStart", () => {
  beforeEach(() => {
    mockedPlayed.mockReturnValue([]);
    mockedResumableSave.mockReturnValue(null);
  });

  it("starts Mission 1 immediately for a brand-new player", () => {
    expect(startFromMenu()).toEqual([start(TUTORIALS[0].id)]);
  });

  it("opens the mission list after any tutorial is complete", () => {
    mockedPlayed.mockReturnValue([TUTORIALS[0].id]);
    expect(startFromMenu()).toEqual([navigate("NEW_GAME")]);
  });

  it("opens the mission list when an unfinished save exists", () => {
    mockedResumableSave.mockReturnValue({} as ReturnType<typeof resumableSave>);
    expect(startFromMenu()).toEqual([navigate("NEW_GAME")]);
  });
});
