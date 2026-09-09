import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../Store";
import { pendingScenarioChoice } from "../../helpers/ScenarioChoices";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { chooseScenarioResponse } from "../../reducers/GameActions";

export default function ScenarioChoiceDialog() {
  const game = useAppSelector((state) => state.game);
  const dispatch = useAppDispatch();
  const decision =
    game.inGame && !game.replayPlayback
      ? pendingScenarioChoice(game)
      : undefined;
  if (!decision) return null;
  const cash = getTimeFromTimeline(game.date.minute, game.timeline)?.cash ?? 0;
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      aria-labelledby="scenarioChoiceTitle"
      aria-describedby="scenarioChoiceDescription"
      data-scenario-choice="true"
    >
      <DialogTitle id="scenarioChoiceTitle">{decision.title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Game paused — choose a response to continue.
        </Typography>
        <Typography id="scenarioChoiceDescription">
          {decision.message}
        </Typography>
        <Typography sx={{ my: 2 }}>
          Cash available: ${(cash / 1000000).toFixed(1)}M
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          {decision.options.map((option, index) => {
            const cost = option.cost(game.difficulty);
            const affordable = cost === 0 || cash >= cost;
            return (
              <Box key={option.id} sx={{ flex: "1 1 180px" }}>
                <Button
                  fullWidth
                  autoFocus={index === 0 && affordable}
                  variant={index === 0 ? "contained" : "outlined"}
                  disabled={!affordable}
                  sx={{ minHeight: 44, whiteSpace: "normal" }}
                  onClick={() =>
                    dispatch(
                      chooseScenarioResponse({
                        decisionId: decision.id,
                        optionId: option.id,
                      }),
                    )
                  }
                >
                  {option.label}
                </Button>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {cost > 0
                    ? `One-time cost: $${(cost / 1000000).toFixed(1)}M`
                    : "No upfront cost"}
                  {!affordable && " · Insufficient cash"}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
