import * as React from "react";
import { Button, IconButton, Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { EvidenceTargetType, GameType } from "../../Types";
import {
  getMissionStatus,
  projectedShortfall,
  selectMissionRisk,
} from "../../helpers/MissionStatus";
import type { MissionRisk } from "../../helpers/MissionStatus";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { TICK_MINUTES } from "../../Constants";
import { UpcomingStoryEventType } from "../views/StoryEventSelectors";
import ConceptIcon from "./ConceptIcon";
import {
  projectionReady,
  requestProjection,
  subscribeProjection,
} from "./DeferredProjection";

type MissionStatus = ReturnType<typeof getMissionStatus>;

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
 * Whether selectMissionRisk will return one of those early risks for this state: the same cheap
 * conditions it checks before the runway. When one holds, it returns without reading the
 * projection, so calling it costs nothing even while the projection is stale.
 */
function earlyRiskDue(game: GameType, mission: MissionStatus): boolean {
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  if (
    now &&
    now.minute <= game.date.minute &&
    game.date.minute - now.minute < TICK_MINUTES &&
    (now.supplyW < now.demandW || now.cash < 0)
  ) {
    return true;
  }
  return (
    mission.requirements.some(
      (row) => row.id === "reliability" && row.status === "failed",
    ) || !!projectedShortfall(game.timeline, game.date.minute)
  );
}

/**
 * selectMissionRisk, kept off the frame that invalidates the projection behind its runway check
 * (see DeferredProjection).
 *
 * The early risks (a shortage or negative cash now, a missed reliability window, a shortfall
 * expected later today) are always judged against the current state: when one is due,
 * selectMissionRisk runs as usual, since it returns before the runway check. Only when none is
 * due and the projection is stale does the previous risk stay up while the new projection is
 * computed after paint. So for about a frame after a rollover or a rate change, only what comes
 * after the early checks can be stale: the runway warning, and the upcoming-event notice it would
 * otherwise give way to. A previous early risk that has since cleared is not kept, since it is no
 * longer true, so that case computes now, as does the first render.
 *
 * earlyRiskDue mirrors selectMissionRisk's early checks. If those ever change without it, the
 * cost is a stale frame or a synchronous projection, never a wrong settled result.
 */
function useMissionRisk(
  game: GameType,
  mission: MissionStatus,
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
    !projectionReady(game) &&
    !earlyRiskDue(game, mission);
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
  const risk = useMissionRisk(game, mission, upcoming);
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
