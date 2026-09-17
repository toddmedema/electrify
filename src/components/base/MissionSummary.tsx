import * as React from "react";
import { Button, IconButton, Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { EvidenceTargetType, GameType } from "../../Types";
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
  const risk = selectMissionRisk(game, upcoming);
  // The grid readout beside this already reports a shortage happening right now.
  const shownRisk = risk && risk.id !== "shortage" ? risk : undefined;
  // The stable risk identity, not changing tick values, owns the polite announcement.
  const announcement = React.useMemo(() => risk?.label || "", [risk?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="missionSummary" aria-label="Mission progress">
      <div className="missionSummaryHeader">
        <div className="missionSummaryCopy">
          {/* A risk to the goal takes the goal's place so the bar stays one line; the goal
              itself is always one tap away in All requirements. */}
          {shownRisk ? (
            <Button
              className="missionRiskButton"
              color={shownRisk.id.startsWith("event:") ? "primary" : "warning"}
              aria-label={`${shownRisk.shortLabel}. ${shownRisk.label}`}
              title={shownRisk.label}
              startIcon={
                shownRisk.id.startsWith("event:") ? undefined : (
                  <WarningAmberIcon fontSize="small" aria-hidden="true" />
                )
              }
              onClick={() => onEvidence?.(shownRisk.target)}
            >
              <span className="missionRiskText">{shownRisk.shortLabel}</span>
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
