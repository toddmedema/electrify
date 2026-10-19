import { currentTick } from "../../helpers/GameSelectors";
import * as React from "react";
import { Button } from "@mui/material";
import { EvidenceTargetType, GameType } from "../../Types";
import {
  getMissionStatus,
  selectMissionRisk,
} from "../../helpers/MissionStatus";
import type { MissionRisk } from "../../helpers/MissionStatus";
import { TICK_MINUTES } from "../../Constants";
import {
  ActiveEventGroupType,
  UpcomingStoryEventType,
} from "../views/StoryEventSelectors";
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
    (risk.id === "shortage" || risk.id === "cash" || risk.id === "reliability")
  );
}

/**
 * Whether selectMissionRisk will return one of those early risks for this state: the same cheap
 * conditions it checks before the runway. When one holds, it returns without reading the
 * projection, so calling it costs nothing even while the projection is stale.
 */
function earlyRiskDue(game: GameType, mission: MissionStatus): boolean {
  const now = currentTick(game);
  if (
    now &&
    now.minute <= game.date.minute &&
    game.date.minute - now.minute < TICK_MINUTES &&
    (now.supplyW < now.demandW || now.cash < 0)
  ) {
    return true;
  }
  return mission.requirements.some(
    (row) => row.id === "reliability" && row.status === "failed",
  );
}

/**
 * selectMissionRisk, kept off the frame that invalidates the projection behind its runway check
 * (see DeferredProjection).
 *
 * The early risks (a shortage or negative cash now, a missed reliability window) are always
 * judged against the current state: when one is due,
 * selectMissionRisk runs as usual, since it returns before the runway check. Only when none is
 * due and the projection is stale does the previous risk stay up while the new projection is
 * computed in a worker. Until it arrives after a rollover or a rate change, only what comes
 * after the early checks can be stale: the runway warning, and the upcoming-event notice it would
 * otherwise give way to. A previous early risk that has since cleared is not kept, since it is no
 * longer true; it clears while the worker computes its replacement. On first render the
 * headline remains visible while the worker prepares the runway forecast.
 *
 * earlyRiskDue mirrors selectMissionRisk's early checks. If those ever change without it, the
 * cost is a stale frame or a synchronous projection, never a wrong settled result.
 */
function useMissionRisk(
  game: GameType,
  mission: MissionStatus,
  upcoming: UpcomingStoryEventType[],
): MissionRisk | undefined {
  const scope = game.runIdentity ?? game.location ?? game.monthlyHistory;
  const last = React.useRef<{
    risk: MissionRisk | undefined;
    scope: unknown;
    month: number;
  }>();
  const [, landed] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => subscribeProjection(landed), []);
  const now = currentTick(game);
  const defer =
    !!now &&
    (!!last.current || typeof Worker !== "undefined") &&
    !projectionReady(game) &&
    !earlyRiskDue(game, mission);
  const previousRisk =
    last.current?.scope === scope &&
    last.current.month <= game.date.monthsElapsed &&
    readsProjection(last.current?.risk)
      ? last.current?.risk
      : undefined;
  const risk = defer ? previousRisk : selectMissionRisk(game, upcoming);
  React.useEffect(() => {
    last.current = { risk, scope, month: game.date.monthsElapsed };
    if (defer && now) requestProjection(game, now);
  });
  return risk;
}

export default function MissionSummary({
  game,
  upcoming = [],
  activeEvents = [],
  onActiveEvents,
  onEvidence,
}: {
  game: GameType;
  upcoming?: UpcomingStoryEventType[];
  activeEvents?: ActiveEventGroupType[];
  onActiveEvents?: () => void;
  onEvidence?: (target: EvidenceTargetType) => void;
}) {
  const mission = getMissionStatus(game);
  const risk = useMissionRisk(game, mission, upcoming);
  // The grid readout beside this already reports a shortage happening right now.
  const active = activeEvents[0];
  const shownRisk =
    active && (!risk || risk.id.startsWith("event:") || risk.id === "shortage")
      ? {
          id: `active:${active.key}`,
          shortLabel: `Active: ${active.title}${activeEvents.length > 1 ? ` +${activeEvents.length - 1}` : ""}`,
          label: activeEvents
            .map((event) => `${event.title}, ${event.throughLabel}`)
            .join("; "),
          target: { card: "EVENTS" as const },
        }
      : risk && risk.id !== "shortage"
        ? risk
        : undefined;
  // Upcoming events are news to act on (a blue calendar beside body-contrast text); every
  // other risk threatens the goal (amber).
  const warning =
    shownRisk &&
    !shownRisk.id.startsWith("event:") &&
    !shownRisk.id.startsWith("active:");
  // The stable risk identity, not changing tick values, owns the polite announcement.
  const announcement = React.useMemo(
    () => shownRisk?.label || "",
    [shownRisk?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div
      className={`missionSummary${warning ? " statusWarning" : ""}`}
      aria-label="Mission progress"
    >
      <div className="missionSummaryHeader">
        <div className="missionSummaryCopy">
          {/* A risk to the goal takes the goal's place so the bar stays one line; the goal
              itself is always one tap away in the dock's Scenario action. */}
          {shownRisk ? (
            <Button
              className={`missionRiskButton${warning ? "" : " missionRiskEvent"}`}
              color="inherit"
              aria-label={`${shownRisk.shortLabel}. ${shownRisk.label}`}
              title={shownRisk.label}
              onClick={() =>
                shownRisk.id.startsWith("active:")
                  ? onActiveEvents?.()
                  : onEvidence?.(shownRisk.target)
              }
            >
              {/* Inline rather than startIcon, so it keeps the grid readout's exact size and inset. */}
              <span className="statusIcon" aria-hidden="true">
                <ConceptIcon
                  concept={warning ? "danger" : "forecast"}
                  fontSize="small"
                />
              </span>
              <span className="missionRiskText statusLabel">
                {shownRisk.shortLabel}
              </span>
            </Button>
          ) : (
            mission.headline &&
            mission.headline.id !== "decisions" && (
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
            {/* A crowded single-row bar hides the tail to read "144 mo left"; the full text
                stays in the DOM, so it reads the same everywhere else. */}
            {mission.monthsRemaining === 0 ? (
              "Term complete"
            ) : (
              <>
                {mission.monthsRemaining} mo
                <span className="missionSummaryMonthsTail">
                  {mission.monthsRemaining === 1 ? "nth" : "nths"}
                </span>{" "}
                left
              </>
            )}
          </span>
        </div>
      </div>
      <span className="srOnly" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
