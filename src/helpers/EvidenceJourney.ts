import type { AppThunk } from "../Store";
import type { InsightsOriginType } from "../Types";
import { getHistoryApi } from "../Globals";
import { navigate } from "../reducers/Card";
import { delta } from "../reducers/UI";

/** One marked history edge; no speed, simulation snapshot or saved preference writes. */
export const beginGeneratorJourney =
  (origin: InsightsOriginType): AppThunk =>
  (dispatch, getState) => {
    const state = getState();
    const runId = state.ui.evidenceRunId ?? 0;
    const id = (state.ui.evidenceJourneyMarker?.id ?? 0) + 1;
    // Desktop may name Facilities while displaying Insights alongside it. The origin is semantic.
    getHistoryApi().replaceState(
      { evidenceJourney: { id, runId, role: "origin" } },
      "",
      "#",
    );
    dispatch(
      delta({
        evidenceJourney: { id, runId, origin },
        evidenceJourneyMarker: { id, runId },
      }),
    );
    dispatch(
      navigate({
        name: "BUILD_GENERATORS",
        journeyMarker: { id, runId, role: "control" },
      }),
    );
  };

export const returnToEvidence = (): AppThunk => (_dispatch, getState) => {
  if (getState().ui.evidenceJourney) getHistoryApi().back();
};

/** Called by App's sole popstate listener before public scenario/default handling. */
export const traverseEvidenceJourney =
  (historyState: unknown): AppThunk<boolean> =>
  (dispatch, getState) => {
    const marker = (
      historyState as {
        evidenceJourney?: { id: number; runId: number; role: string };
      } | null
    )?.evidenceJourney;
    if (!marker || !["origin", "control"].includes(marker.role)) return false;
    const state = getState();
    if (
      marker.runId !== (state.ui.evidenceRunId ?? 0) ||
      marker.id !== state.ui.evidenceJourneyMarker?.id
    ) {
      dispatch(
        navigate({
          name: ["MAIN_MENU", "NEW_GAME", "LOADING"].includes(state.card.name)
            ? "MAIN_MENU"
            : "FACILITIES",
          skipBrowserHistory: true,
          replaceCurrentCard: true,
        }),
      );
      return true;
    }
    const origin =
      marker.role === "origin" ? state.ui.evidenceJourney?.origin : undefined;
    dispatch(
      navigate({
        name: marker.role === "origin" ? "INSIGHTS" : "BUILD_GENERATORS",
        skipBrowserHistory: true,
        replaceCurrentCard: marker.role === "origin",
        journeyTraversal: marker.role as "origin" | "control",
      }),
    );
    if (origin) dispatch(delta({ insightsRestore: origin }));
    return true;
  };
