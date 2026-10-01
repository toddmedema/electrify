import * as React from "react";
import { getHistoryApi } from "../../Globals";
import { CUSTOM_SCENARIO_ID } from "../../data/Scenarios";
import { DATA_CENTER_DIFFICULTY } from "../../helpers/DataCenterScenario";
import { scenarioListUrl } from "../../ScenarioUrl";
import { useAppDispatch } from "../../Store";
import { delta, quit, start } from "../../reducers/Game";
import { ScenarioType } from "../../Types";
import { startWithSaveGuard } from "./StartGame";
import DataCenterSetup from "./DataCenterSetup";

export default function DataCenterSetupContainer() {
  const dispatch = useAppDispatch();
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
    });
  };
  return (
    <DataCenterSetup
      onBack={() => window.location.assign("/data-centers.html")}
      onStart={onStart}
    />
  );
}
