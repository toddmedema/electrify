import * as React from "react";
import { Button } from "@mui/material";
import { EvidenceTargetType, GameType } from "../../Types";
import { getScenario } from "../../data/Scenarios";
import {
  getMissionStatus,
  selectMissionRisk,
} from "../../helpers/MissionStatus";
import { UpcomingStoryEventType } from "../views/StoryEventSelectors";

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
  const tutorial = !!getScenario(game.scenarioId, game.customScenario)
    ?.tutorialSteps;
  const risk = selectMissionRisk(game, upcoming);
  // The stable risk identity, not changing tick values, owns the polite announcement.
  const announcement = React.useMemo(() => risk?.label || "", [risk?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      className={`missionSummary${tutorial ? " missionSummaryTutorial" : ""}`}
      aria-label="Mission progress"
    >
      {!tutorial && (
        <div className="missionSummaryCopy">
          <strong>{mission.label}</strong>
          <span>{mission.monthsRemaining} simulation months remaining</span>
          {mission.prominent && (
            <span>
              {mission.prominent.label}: {mission.prominent.current}.{" "}
              {mission.prominent.target}
            </span>
          )}
        </div>
      )}
      <Button className="missionDetailsButton" onClick={onDetails}>
        All requirements
      </Button>
      {!tutorial && risk && (
        <Button
          className="missionRiskButton"
          onClick={() => onEvidence?.(risk.target)}
        >
          {risk.label}
        </Button>
      )}
      {!tutorial && (
        <span className="srOnly" aria-live="polite">
          {announcement}
        </span>
      )}
    </div>
  );
}
