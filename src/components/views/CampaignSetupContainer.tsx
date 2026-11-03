import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate } from "../../reducers/Card";
import { startLegacyCampaign } from "../../reducers/Game";
import { delta as uiDelta } from "../../reducers/UI";
import { runSaveTransition } from "../../SaveSession";
import CampaignSetup from "./CampaignSetup";
import { getHistoryApi } from "../../Globals";
import { scenarioListUrl } from "../../ScenarioUrl";

export default function CampaignSetupContainer(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const difficulty = useAppSelector(
    (state) => state.ui.previewDifficulty ?? state.game.difficulty,
  );
  const activeGeneration = useAppSelector((state) =>
    state.game.inGame ? state.game.campaign?.generationIndex : undefined,
  );
  const busy = useAppSelector((state) => !!state.saves.transitioning);
  return (
    <CampaignSetup
      difficulty={difficulty}
      activeGeneration={activeGeneration}
      busy={busy}
      onDifficulty={(value) => dispatch(uiDelta({ previewDifficulty: value }))}
      onBack={() => getHistoryApi().back()}
      onResume={
        activeGeneration === undefined
          ? undefined
          : () => {
              getHistoryApi().replaceState(null, "", scenarioListUrl());
              dispatch(navigate("FACILITIES"));
            }
      }
      onStart={() => {
        void runSaveTransition(() => {
          getHistoryApi().replaceState(null, "", scenarioListUrl());
          startLegacyCampaign(dispatch, difficulty);
        });
      }}
    />
  );
}
