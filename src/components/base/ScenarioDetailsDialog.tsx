import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { GameType } from "../../Types";
import { getScenario } from "../../data/Scenarios";
import { getScenarioLocation } from "../../helpers/Locations";
import { summarizeHistory } from "../../helpers/DateTime";
import { computeScoreBreakdown, totalScore } from "../../helpers/Scoring";
import VictoryConditions from "./VictoryConditions";
import { formatScore, SCORE_LABELS } from "./VictoryDialog";

export interface Props {
  open: boolean;
  game: GameType;
  onClose: () => void;
}

/**
 * The same rundown the scenario-select screen shows -- timeframe, location and victory
 * conditions -- reachable from the in-game menu, for whenever a player forgets what they signed
 * up for partway through a run. The score is figured from monthlyHistory, which only rolls up at
 * each month's end, so it reads as "through last month" rather than this exact instant.
 */
export default function ScenarioDetailsDialog(props: Props): React.JSX.Element {
  const { open, game, onClose } = props;
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (!scenario) {
    return <Dialog open={false} />;
  }
  const location = getScenarioLocation(scenario);
  const history = game.monthlyHistory;
  const breakdown =
    history.length > 0
      ? computeScoreBreakdown(scenario, summarizeHistory(history))
      : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="scenario-details-title"
    >
      <DialogTitle>
        <span id="scenario-details-title">{scenario.name}</span>
        <IconButton
          aria-label="close"
          onClick={onClose}
          className="top-right"
          size="large"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <p>
          Timeframe: {scenario.startingYear} to{" "}
          {scenario.startingYear + Math.ceil(scenario.durationMonths / 12) - 1}
        </p>
        {location && <p>Location: {location.name}</p>}
        <p>Difficulty: {game.difficulty}</p>
        <Typography variant="h6" gutterBottom>
          Victory Conditions: {scenario.ownership}-Owned
        </Typography>
        <VictoryConditions
          ownership={scenario.ownership}
          dollarsPerkWh={scenario.dollarsPerkWh}
          minimumCustomerRetention={scenario.minimumCustomerRetention}
          reliabilityObjective={scenario.reliabilityObjective}
        />
        {breakdown && (
          <>
            <Typography variant="h6" gutterBottom>
              Current score: {formatScore(totalScore(breakdown))}
            </Typography>
            <div style={{ margin: "8px 0" }}>
              {Object.keys(breakdown).map((category: string) => (
                <div key={category}>
                  {breakdown[category]} pts from{" "}
                  {SCORE_LABELS[category] || category}
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="primary" variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
