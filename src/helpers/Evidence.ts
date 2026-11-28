import type { AppThunk } from "../Store";
import type {
  CardNameType,
  EvidenceRequestType,
  EvidenceTargetType,
} from "../Types";
import { navigate } from "../reducers/Card";
import { acknowledgeEvidence, requestEvidence } from "../reducers/UI";

export function evidenceCard(
  target: EvidenceTargetType,
): CardNameType | undefined {
  if (target === "mission-details") return "SCENARIO";
  if (target === "supply-demand" || target === "interties") return "FLEET";
  if (target === "finances") return "INSIGHTS";
  if (target.card === "FACILITIES")
    return target.view === "BUILD_GENERATORS" ? "BUILD_GENERATORS" : "FLEET";
  return target.card;
}

/** Presentation only: deliberate controls retain their own existing game actions. */
export const openEvidence =
  (target: EvidenceTargetType): AppThunk =>
  (dispatch, getState) => {
    const { card } = getState();
    const name = evidenceCard(target);
    if (name && (name !== card.name || typeof target === "object")) {
      dispatch(
        navigate({
          name,
          skipBrowserHistory: name === card.name,
          storyTarget: typeof target === "object" ? target : undefined,
        }),
      );
    }
    dispatch(requestEvidence(target));
  };

/** Claim before focus: a second mounted effect (including StrictMode) cannot resolve twice. */
export const focusEvidence =
  (
    request: EvidenceRequestType,
    element: HTMLElement | null,
  ): AppThunk<boolean> =>
  (dispatch, getState) => {
    const state = getState();
    if (
      !element ||
      state.ui.facilityDragActive ||
      state.ui.evidenceRequest?.id !== request.id ||
      state.ui.evidenceRequest.runId !== request.runId ||
      (state.ui.evidenceRunId ?? 0) !== request.runId
    )
      return false;
    dispatch(acknowledgeEvidence(request));
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    element.focus({ preventScroll: true });
    return true;
  };
