import * as React from "react";
import { Button, Menu, MenuItem } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import {
  EvidenceTargetType,
  FacilityOperatingType,
  GameType,
} from "../../Types";
import { currentTick } from "../../helpers/GameSelectors";
import {
  getMissionStatus,
  projectedShortfall,
} from "../../helpers/MissionStatus";
import { formatWatts } from "../../helpers/Format";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { getStorageJson, setStorageKeyValue } from "../../LocalStorage";
import { WildfireRiskNoticeType } from "../../helpers/Wildfire";
import ConceptIcon from "../base/ConceptIcon";
import { getGridHealth } from "../base/GameAppBar";
import { UpcomingStoryEventType } from "./StoryEventSelectors";
import "./OperationsPriorities.scss";

interface Props {
  game: GameType;
  ongoing: UpcomingStoryEventType[];
  upcoming: UpcomingStoryEventType[];
  selectedFacilityId?: number | null;
  riskNotice?: WildfireRiskNoticeType;
  onEvidence: (target: EvidenceTargetType) => void;
  onFacility: (id: number) => void;
}

const GOAL_STATUS = {
  pending: "Upcoming",
  "in-progress": "In progress",
  completed: "Met",
  failed: "Failed",
  unknown: "Not yet verified",
  waived: "Waived",
};

export function goalEvidence(id: string): EvidenceTargetType {
  if (id === "cash") return "finances";
  if (id === "reliability" || id === "survival") return "supply-demand";
  return "mission-details";
}

/** Keep project order tied to asset identity, never to changing time remaining or output. */
export function operationsProjects(game: GameType): FacilityOperatingType[] {
  return game.facilities
    .filter(
      (facility) =>
        facility.yearsToBuildLeft > 0 ||
        (facility.minuteOperational !== undefined &&
          facility.minuteOperational > 0 &&
          facility.minuteOperational <= game.date.minute &&
          game.date.minute - facility.minuteOperational < MINUTES_PER_MONTH),
    )
    .slice()
    .sort((a, b) => a.id - b.id);
}

/**
 * An overview of decisions still in play. It reads the game's existing requirements, sampled
 * day and authored announcements; it never generates another economic forecast.
 */
export default function OperationsPriorities({
  game,
  ongoing,
  upcoming,
  selectedFacilityId,
  riskNotice,
  onEvidence,
  onFacility,
}: Props) {
  const mission = getMissionStatus(game);
  const now = currentTick(game);
  const preferenceKey = `operationsGoals:${game.scenarioId}`;
  const [pinned, setPinned] = React.useState<string[]>(() => {
    const initial = Array.from(
      new Set([
        mission.headline?.id === "cash"
          ? "survival"
          : mission.headline?.id || "survival",
        "cash",
      ]),
    );
    const stored = getStorageJson<unknown[]>(preferenceKey, initial);
    return Array.isArray(stored)
      ? mission.requirements
          .filter((goal) => stored.includes(goal.id))
          .map((goal) => goal.id)
      : initial;
  });
  React.useEffect(() => {
    setStorageKeyValue(preferenceKey, pinned);
  }, [preferenceKey, pinned]);
  const [goalAnchor, setGoalAnchor] = React.useState<HTMLElement | null>(null);
  const [heldNext, setHeldNext] = React.useState<UpcomingStoryEventType>();
  const projects = operationsProjects(game);
  // These slots are deliberately separate: a new incident cannot replace a pinned goal.
  const health = now ? getGridHealth(game, now) : undefined;
  const shortfall = projectedShortfall(game.timeline, game.date.minute);
  const warning = health && health.state !== "stable";
  // A month rollover must not change the destination under a pointer or keyboard focus.
  const next = heldNext || upcoming[0];

  return (
    <div className="operationsPriorities" data-operations-priorities>
      <section
        aria-labelledby="operationsGoalsTitle"
        className="operationsSection"
      >
        <header className="operationsSectionHeader">
          <h3 id="operationsGoalsTitle">Pinned goals</h3>
          <Button
            size="small"
            onClick={(event) => setGoalAnchor(event.currentTarget)}
            aria-label="Choose pinned goals"
            aria-haspopup="menu"
            aria-expanded={!!goalAnchor}
            startIcon={<PushPinOutlinedIcon fontSize="small" />}
          >
            Pin
          </Button>
        </header>
        <Menu
          anchorEl={goalAnchor}
          open={!!goalAnchor}
          onClose={() => setGoalAnchor(null)}
          slotProps={{ list: { "aria-label": "Pinned goals" } }}
        >
          {mission.requirements.map((goal) => (
            <MenuItem
              key={goal.id}
              role="menuitemcheckbox"
              aria-checked={pinned.includes(goal.id)}
              onClick={() =>
                setPinned((previous) =>
                  previous.includes(goal.id)
                    ? previous.filter((id) => id !== goal.id)
                    : [...previous, goal.id],
                )
              }
            >
              <span className="operationsPinCheck">
                {pinned.includes(goal.id) && <CheckIcon fontSize="small" />}
              </span>
              {goal.label}
            </MenuItem>
          ))}
          <MenuItem onClick={() => setGoalAnchor(null)}>Done</MenuItem>
        </Menu>
        <div className="operationsGoals">
          {pinned.map((id) => {
            const goal = mission.requirements.find((item) => item.id === id);
            if (!goal) return null;
            return (
              <Button
                color="inherit"
                key={id}
                className={`operationsGoal status-${goal.status}`}
                onClick={() => onEvidence(goalEvidence(id))}
                title={`${goal.target}. ${goal.timing}`}
              >
                <span className="operationsRowTitle">
                  <ConceptIcon concept="goal" fontSize="small" />
                  <strong>{goal.label}</strong>
                </span>
                <span className="operationsDetail">{goal.current}</span>
                <span className="operationsGoalTarget">{goal.target}</span>
                <span className="operationsMeta">
                  {GOAL_STATUS[goal.status]}
                </span>
              </Button>
            );
          })}
          {pinned.length === 0 && (
            <p className="operationsEmpty">Pin a goal to keep it in view.</p>
          )}
        </div>
        <Button
          className="operationsTextAction"
          size="small"
          onClick={() => onEvidence("mission-details")}
        >
          All requirements · {mission.monthsRemaining} months left
        </Button>
      </section>

      <section
        aria-labelledby="operationsNowTitle"
        className="operationsSection"
      >
        <header className="operationsSectionHeader">
          <h3 id="operationsNowTitle">Right now</h3>
        </header>
        <Button
          color="inherit"
          className={`operationsRow operationsGrid${warning ? " warning" : ""}${health?.state === "blackout" ? " danger" : ""}`}
          onClick={() => onEvidence("supply-demand")}
        >
          <span className="operationsRowTitle">
            <ConceptIcon
              concept={warning ? "danger" : "supply"}
              fontSize="small"
            />
            <strong>{health?.label || "Grid status unavailable"}</strong>
          </span>
          <span className="operationsDetail">
            {health?.metric || "No operating sample"}
          </span>
          <span className="operationsMeta">
            Inspect supply & demand <ArrowForwardIcon />
          </span>
        </Button>
        {shortfall && health?.state !== "blackout" && (
          <Button
            color="inherit"
            className="operationsRow warning"
            onClick={() => onEvidence("supply-demand")}
          >
            <strong>Shortfall in the sampled day</strong>
            <span className="operationsDetail">
              Check the demand peak before advancing time.
            </span>
          </Button>
        )}
        {ongoing.map((event) => (
          <Button
            color="inherit"
            key={event.key}
            className="operationsRow operationsIncident"
            onClick={() => onEvidence(event.actionTarget || { card: "EVENTS" })}
          >
            <span className="operationsRowTitle">
              <ConceptIcon
                concept={event.concept || "forecast"}
                fontSize="small"
              />
              <strong>{event.title || "Active event"}</strong>
            </span>
            <span className="operationsDetail">{event.message}</span>
            <span className="operationsMeta">{event.label}</span>
          </Button>
        ))}
        {riskNotice && (
          <Button
            color="inherit"
            className="operationsRow warning"
            onClick={() => onEvidence({ card: "FACILITIES", view: "FLEET" })}
          >
            <strong>{riskNotice.title}</strong>
            <span className="operationsDetail">{riskNotice.message}</span>
          </Button>
        )}
      </section>

      <section
        aria-labelledby="operationsNextTitle"
        className="operationsSection"
      >
        <header className="operationsSectionHeader">
          <h3 id="operationsNextTitle">Coming up</h3>
        </header>
        {next ? (
          <Button
            color="inherit"
            className="operationsRow"
            onPointerEnter={() => setHeldNext(next)}
            onPointerLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement))
                setHeldNext(undefined);
            }}
            onFocus={() => setHeldNext(next)}
            onBlur={(event) => {
              if (!event.currentTarget.matches(":hover"))
                setHeldNext(undefined);
            }}
            onClick={() => onEvidence(next.actionTarget || { card: "EVENTS" })}
          >
            <span className="operationsRowTitle">
              <ConceptIcon
                concept={next.concept || "forecast"}
                fontSize="small"
              />
              <strong>{next.title || "Next announced event"}</strong>
            </span>
            <span className="operationsDetail">{next.message}</span>
            <span className="operationsMeta">{next.label}</span>
          </Button>
        ) : (
          <p className="operationsEmpty">No announced events ahead.</p>
        )}
      </section>

      <section
        aria-labelledby="operationsProjectsTitle"
        className="operationsSection"
      >
        <header className="operationsSectionHeader">
          <h3 id="operationsProjectsTitle">Projects & outcomes</h3>
        </header>
        {projects.map((facility) => {
          const building = facility.yearsToBuildLeft > 0;
          return (
            <Button
              color="inherit"
              key={facility.id}
              className={`operationsRow operationsProject${selectedFacilityId === facility.id ? " selected" : ""}`}
              aria-pressed={selectedFacilityId === facility.id}
              onClick={() => onFacility(facility.id)}
              aria-label={`Inspect ${facility.name} project and grid output`}
              aria-describedby={`operationsProject${facility.id}Outcome`}
            >
              <span className="operationsRowTitle">
                <ConceptIcon
                  concept={building ? "construction" : "supply"}
                  fontSize="small"
                />
                <strong>{facility.name}</strong>
                <span className="operationsAssetId">#{facility.id}</span>
              </span>
              <span
                className="operationsDecisionTrail"
                id={`operationsProject${facility.id}Outcome`}
              >
                <span>Committed</span>
                <ArrowForwardIcon />
                <span>
                  {building
                    ? `${Math.ceil(facility.yearsToBuildLeft * 12)} mo to online`
                    : "Online"}
                </span>
                <ArrowForwardIcon />
                <span>
                  {building
                    ? "No output yet"
                    : `${formatWatts(facility.currentW)} now`}
                </span>
              </span>
              <span className="operationsMeta">
                {formatWatts(facility.peakW)} capacity · Inspect asset & grid{" "}
                <ArrowForwardIcon />
              </span>
            </Button>
          );
        })}
        {projects.length === 0 && (
          <p className="operationsEmpty">
            New projects stay here through their first operating month.
          </p>
        )}
      </section>
    </div>
  );
}
