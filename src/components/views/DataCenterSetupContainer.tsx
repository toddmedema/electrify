import * as React from "react";
import { getHistoryApi } from "../../Globals";
import { CUSTOM_SCENARIO_ID } from "../../data/Scenarios";
import { DATA_CENTER_DIFFICULTY } from "../../helpers/DataCenterScenario";
import { scenarioListUrl } from "../../ScenarioUrl";
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate } from "../../reducers/Card";
import { delta, quit, start } from "../../reducers/Game";
import { selectContinueSave } from "../../SaveModel";
import { resumeSavedGame } from "../../SaveSession";
import { delta as uiDelta } from "../../reducers/UI";
import { ScenarioType } from "../../Types";
import { startWithSaveGuard } from "./StartGame";
import DataCenterSetup from "./DataCenterSetup";

export default function DataCenterSetupContainer() {
  const dispatch = useAppDispatch();
  const inGame = useAppSelector((state) => state.game.inGame);
  const saved = useAppSelector((state) =>
    selectContinueSave(state.saves.entries),
  );
  const canResume = inGame || !!saved;
  const onResume = () => {
    if (!inGame && !saved) return;
    getHistoryApi().replaceState(null, "", scenarioListUrl());
    if (inGame) dispatch(navigate("FACILITIES"));
    else if (saved) void resumeSavedGame(saved.id);
  };
  const onStart = (scenario: ScenarioType) => {
    startWithSaveGuard(dispatch, () => {
      getHistoryApi().replaceState(null, "", scenarioListUrl());
      dispatch(quit());
      dispatch(
        delta({
          difficulty: DATA_CENTER_DIFFICULTY,
          scenarioId: CUSTOM_SCENARIO_ID,
          customScenario: scenario,
        }),
      );
      dispatch(start(CUSTOM_SCENARIO_ID));
      dispatch(uiDelta({ dataCenterGuideRequested: true }));
    });
  };
  return (
    <DataCenterSetup
      onBack={() => window.location.assign("/data-centers.html")}
      onStart={onStart}
      onResume={canResume ? onResume : undefined}
    />
  );
}
