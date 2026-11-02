import { useAppDispatch, useAppSelector } from "../../Store";
import { continueLegacyCampaign } from "../../reducers/Game";
import { quitSavedGame } from "../../SaveSession";
import { NAV_CARDS } from "../../Constants";
import CampaignHandover from "./CampaignHandover";

export default function CampaignHandoverContainer(): React.JSX.Element | null {
  const dispatch = useAppDispatch();
  const campaign = useAppSelector((state) => state.game.campaign);
  const facilityCount = useAppSelector((state) => state.game.facilities.length);
  const visible = useAppSelector(
    (state) =>
      state.game.inGame &&
      !state.saves.transitioning &&
      !state.ui.dialog.open &&
      (NAV_CARDS.includes(state.card.name) ||
        state.card.name.startsWith("BUILD_")),
  );
  const term = campaign?.completedTerms.at(-1);
  if (!visible || !campaign?.pendingHandover || !term) return null;
  return (
    <CampaignHandover
      term={term}
      facilityCount={facilityCount}
      onContinue={() => dispatch(continueLegacyCampaign())}
      onExit={() => {
        void quitSavedGame();
      }}
    />
  );
}
