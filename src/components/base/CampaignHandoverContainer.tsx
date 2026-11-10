import { createSelector } from "@reduxjs/toolkit";
import { RootState, useAppDispatch, useAppSelector } from "../../Store";
import gameReducer, { continueLegacyCampaign } from "../../reducers/Game";
import { quitSavedGame } from "../../SaveSession";
import { NAV_CARDS } from "../../Constants";
import { getScenario } from "../../data/Scenarios";
import { scenarioObjectiveDefinitions } from "../../helpers/ObjectiveRules";
import CampaignHandover from "./CampaignHandover";

/** Use the real transition to preview exactly the next CEO's frozen company-specific goals. */
export const selectNextTermObjectives = createSelector(
  [(state: RootState) => state.game],
  (game) => {
    // Cold Continue restores the saved company before Loading initializes simulation data.
    if (!game.inGame || !game.campaign?.pendingHandover) return [];
    const next = gameReducer(game, continueLegacyCampaign());
    if (next.campaign?.generationIndex === game.campaign.generationIndex)
      return [];
    return scenarioObjectiveDefinitions(getScenario(next.scenarioId), next);
  },
);

export default function CampaignHandoverContainer(): React.JSX.Element | null {
  const dispatch = useAppDispatch();
  const campaign = useAppSelector((state) => state.game.campaign);
  const visible = useAppSelector(
    (state) =>
      state.game.inGame &&
      !state.saves.transitioning &&
      !state.ui.dialog.open &&
      (NAV_CARDS.includes(state.card.name) ||
        state.card.name.startsWith("BUILD_")),
  );
  const term = campaign?.completedTerms.at(-1);
  const nextObjectives = useAppSelector(selectNextTermObjectives);
  if (!visible || !campaign?.pendingHandover || !term) return null;
  return (
    <CampaignHandover
      term={term}
      nextObjectives={nextObjectives}
      onContinue={() => dispatch(continueLegacyCampaign())}
      onExit={() => {
        void quitSavedGame();
      }}
    />
  );
}
