import { beginGeneratorJourney } from "../../helpers/EvidenceJourney";
import { delta as uiDelta } from "../../reducers/UI";
import { connect } from "react-redux";
import type { AppDispatch } from "../../Store";
import { delta } from "../../reducers/Game";
import { AppStateType, GameType } from "../../Types";
import Insights, {
  DispatchProps,
  InsightLayerId,
  StateProps,
} from "./Insights";
import { selectUpcomingStoryEvents } from "./StoryEventSelectors";
import { focusEvidence } from "../../helpers/Evidence";

const STORY_INSIGHT_LAYERS: Record<string, InsightLayerId> = {
  FINANCES: "financeDetails",
  SUPPLY_DEMAND: "supplyDemand",
  FUEL_PRICES: "fuelPrices",
};

const mapStateToProps = (state: AppStateType): StateProps => ({
  evidenceRequest: state.ui.evidenceRequest,
  journeyRestore: state.ui.insightsRestore,
  configurationRevision: state.ui.insightsConfigurationRevision,
  evidenceRunId: state.ui.evidenceRunId,
  activeCard: state.card.name,
  game: state.game,
  selectedFacilityId: state.ui.selectedFacilityId,
  facilityDragActive: state.ui.facilityDragActive,
  upcomingEvents: selectUpcomingStoryEvents(state),
  focusLayer:
    state.card.storyTarget?.card === "INSIGHTS" && state.card.storyTarget.layer
      ? STORY_INSIGHT_LAYERS[state.card.storyTarget.layer]
      : undefined,
});

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => ({
  onGeneratorJourney: (origin) => {
    dispatch(beginGeneratorJourney(origin));
  },
  onJourneyRestored: (origin) =>
    dispatch((_dispatch, getState) => {
      if (getState().ui.insightsRestore !== origin) return false;
      _dispatch(uiDelta({ insightsRestore: undefined }));
      return true;
    }),
  onConfigurationEdit: () => {
    dispatch((_dispatch, getState) => {
      _dispatch(
        uiDelta({
          insightsConfigurationRevision:
            (getState().ui.insightsConfigurationRevision ?? 0) + 1,
        }),
      );
    });
  },
  onEvidenceReady: (request, element) => {
    dispatch(focusEvidence(request, element));
  },
  onDelta: (change: Partial<GameType>) => dispatch(delta(change)),
});

export default connect(mapStateToProps, mapDispatchToProps)(Insights);
