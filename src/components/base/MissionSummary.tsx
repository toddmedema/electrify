import * as React from "react";
import { Button, IconButton, Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { EvidenceTargetType, GameType } from "../../Types";
import {
  getMissionStatus,
  selectMissionRisk,
} from "../../helpers/MissionStatus";
import type { MissionRisk } from "../../helpers/MissionStatus";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { UpcomingStoryEventType } from "../views/StoryEventSelectors";
import ConceptIcon from "./ConceptIcon";
import {
  projectionReady,
  requestProjection,
  subscribeProjection,
} from "./DeferredProjection";

// Risks selectMissionRisk returns before it reaches the cash runway, which is the only check that
// reads the long-range projection
function readsProjection(risk: MissionRisk | undefined): boolean {
  return !(
    risk &&
    (risk.id === "shortage" ||
      risk.id === "cash" ||
      risk.id === "reliability" ||
      risk.id.startsWith("projection:"))
  );
}

/**
 * selectMissionRisk, kept off the frame that invalidates the projection behind its runway check
 * (see DeferredProjection). While the projection is stale, the previous risk stays up and the
 * new projection is requested for after paint. The last risk predicts whether this one will read
 * the projection at all. A risk that returned early computes as usual, so a standing shortage
 * doesn't start a twenty-year simulation every month that nothing reads. The first render has
 * nothing to keep, so it computes synchronously.
 */
function useMissionRisk(
  game: GameType,
  upcoming: UpcomingStoryEventType[],
): MissionRisk | undefined {
  const last = React.useRef<{ risk: MissionRisk | undefined }>();
  const [, landed] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => subscribeProjection(landed), []);
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const defer =
    !!now &&
    !!last.current &&
    readsProjection(last.current.risk) &&
    !projectionReady(game);
  const risk = defer ? last.current?.risk : selectMissionRisk(game, upcoming);
  React.useEffect(() => {
    last.current = { risk };
    if (defer && now) requestProjection(game, now);
  });
  return risk;
}

export default function MissionSummary({
  game,
  upcoming = [],
  onDetails,
  onEvidence,
}: {
  game: GameType;
  upcoming?: UpcomingStoryEventType[];
  onDetails: () => void;
  onEvidence?: (target: EvidenceTargetType) => void;
}) {
  const mission = getMissionStatus(game);
  const risk = useMissionRisk(game, upcoming);
  // The grid readout beside this already reports a shortage happening right now.
  const shownRisk = risk && risk.id !== "shortage" ? risk : undefined;
  // Upcoming events are news to act on (blue); every other risk threatens the goal (amber).
  const warning = shownRisk && !shownRisk.id.startsWith("event:");
  // The stable risk identity, not changing tick values, owns the polite announcement.
  const announcement = React.useMemo(() => risk?.label || "", [risk?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      className={`missionSummary${warning ? " statusWarning" : ""}`}
      aria-label="Mission progress"
    >
      <div className="missionSummaryHeader">
        <div className="missionSummaryCopy">
          {/* A risk to the goal takes the goal's place so the bar stays one line; the goal
              itself is always one tap away in All requirements. */}
          {shownRisk ? (
            <Button
              className="missionRiskButton"
              color={warning ? "inherit" : "primary"}
              aria-label={`${shownRisk.shortLabel}. ${shownRisk.label}`}
              title={shownRisk.label}
              onClick={() => onEvidence?.(shownRisk.target)}
            >
              {/* Inline rather than startIcon, so it keeps the grid readout's exact size and inset. */}
              {warning && (
                <span className="statusIcon" aria-hidden="true">
                  <ConceptIcon concept="danger" fontSize="small" />
                </span>
              )}
              <span className="missionRiskText statusLabel">
                {shownRisk.shortLabel}
              </span>
            </Button>
          ) : (
            mission.headline && (
              <span
                className="missionSummaryHeadline"
                title={`${mission.headline.label}: ${mission.headline.current}. ${mission.headline.target}. ${mission.headline.timing}`}
              >
                {mission.headline.compact}
              </span>
            )
          )}
          {/* Leads with the goal or its risk, so a warning icon lines up with the grid readout's. */}
          <span className="missionSummaryMonths">
            {mission.monthsRemaining === 0
              ? "Term complete"
              : `${mission.monthsRemaining} ${mission.monthsRemaining === 1 ? "month" : "months"} left`}
          </span>
        </div>
        <Tooltip title="All requirements">
          <IconButton
            className="missionDetailsButton"
            aria-label="All requirements"
            onClick={onDetails}
          >
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </div>
      <span className="srOnly" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
