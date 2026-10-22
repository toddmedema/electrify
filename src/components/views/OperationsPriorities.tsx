import * as React from "react";
import { IconButton, Menu, MenuItem } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import { EvidenceTargetType, GameType } from "../../Types";
import { getMissionStatus } from "../../helpers/MissionStatus";
import { getStorageJson, setStorageKeyValue } from "../../LocalStorage";
import ConceptIcon from "../base/ConceptIcon";
import EventCard from "../base/EventCard";
import StoryEventCard from "./StoryEventCard";
import { UpcomingStoryEventType } from "./StoryEventSelectors";
import "./OperationsPriorities.scss";

interface Props {
  game: GameType;
  upcoming: UpcomingStoryEventType[];
  onEvidence: (target: EvidenceTargetType) => void;
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

/**
 * An overview of decisions still in play. It reads the game's existing requirements and authored
 * announcements; it never generates another economic forecast. The grid's current state lives in
 * the top bar's status readout, so it is not repeated here.
 */
export default function OperationsPriorities({
  game,
  upcoming,
  onEvidence,
}: Props) {
  const mission = getMissionStatus(game);
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
  // A month rollover must not change the destination under a pointer or keyboard focus.
  const next = heldNext || upcoming[0];

  return (
    <div className="operationsPriorities" data-operations-priorities>
      <section
        aria-labelledby="operationsGoalsTitle"
        className="operationsSection"
      >
        <header className="operationsSectionHeader">
          <h3 id="operationsGoalsTitle">Goals</h3>
          <IconButton
            size="small"
            onClick={(event) => setGoalAnchor(event.currentTarget)}
            aria-label="Choose pinned goals"
            aria-haspopup="menu"
            aria-expanded={!!goalAnchor}
          >
            <PushPinOutlinedIcon fontSize="small" />
          </IconButton>
        </header>
        <Menu
          transitionDuration={0}
          anchorEl={goalAnchor}
          open={!!goalAnchor}
          onClose={() => setGoalAnchor(null)}
          slotProps={{
            list: {
              "aria-label": "Pinned goals",
              sx: {
                "& .MuiMenuItem-root": {
                  minHeight: "var(--control-size, 40px)",
                  "@media (pointer: coarse)": {
                    minHeight: "max(44px, var(--control-size, 44px))",
                  },
                },
              },
            },
          }}
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
              {goal.required === false ? " · Optional" : ""}
            </MenuItem>
          ))}
        </Menu>
        <ul className="eventLogList operationsGoals">
          {pinned.map((id) => {
            const goal = mission.requirements.find((item) => item.id === id);
            if (!goal) return null;
            return (
              <EventCard
                key={id}
                // A failed goal is harmful, so it takes the same red edge as a critical event.
                className={`status-${goal.status}${goal.status === "failed" ? " importance-CRITICAL" : ""}`}
                icon={<ConceptIcon concept="goal" fontSize="small" />}
                heading={`${goal.label}${goal.required === false ? " · Optional" : ""}`}
                meta={GOAL_STATUS[goal.status]}
                onActivate={() => onEvidence(goalEvidence(id))}
                tooltip={`${goal.target}. ${goal.timing}`}
              >
                {goal.definition && (
                  <span className="operationsGoalTarget">
                    {goal.definition}
                  </span>
                )}
                {goal.current}
                <span className="operationsGoalTarget">{goal.target}</span>
              </EventCard>
            );
          })}
        </ul>
        {pinned.length === 0 && (
          <p className="operationsEmpty">Pin a goal to keep it in view.</p>
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
          <ul className="eventLogList">
            <StoryEventCard
              event={{
                ...next,
                title: next.title || "Next announced event",
              }}
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
              onActivate={() =>
                onEvidence(next.actionTarget || { card: "EVENTS" })
              }
            />
          </ul>
        ) : (
          <p className="operationsEmpty">No announced events ahead.</p>
        )}
      </section>
    </div>
  );
}
