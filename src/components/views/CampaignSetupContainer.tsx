import { useUnlockedDifficulty } from "../../achievements/useAchievements";
import {
  playableDifficulty,
  unlockedDifficulty,
} from "../../achievements/DifficultyUnlocks";
import { achievementJournal } from "../../achievements/Journal";
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
  const unlockedThrough = useUnlockedDifficulty();
  const difficulty = playableDifficulty(
    useAppSelector(
      (state) => state.ui.previewDifficulty ?? state.game.difficulty,
    ),
    unlockedThrough,
  );
  const activeGeneration = useAppSelector((state) =>
    state.game.inGame ? state.game.campaign?.generationIndex : undefined,
  );
  const busy = useAppSelector((state) => !!state.saves.transitioning);
  return (
    <CampaignSetup
      difficulty={difficulty}
      unlockedThrough={unlockedThrough}
      activeGeneration={activeGeneration}
      busy={busy}
      onDifficulty={(value) => {
        if (playableDifficulty(value, unlockedThrough) === value)
          dispatch(uiDelta({ previewDifficulty: value }));
      }}
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
          startLegacyCampaign(
            dispatch,
            playableDifficulty(
              difficulty,
              unlockedDifficulty(achievementJournal.getSnapshot().progress),
            ),
          );
        });
      }}
    />
  );
}
