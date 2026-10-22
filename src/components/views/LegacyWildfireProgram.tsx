import { Box, Button, LinearProgress, Typography } from "@mui/material";
import type { GameType } from "../../Types";
import { useAppDispatch } from "../../Store";
import { chooseScenarioResponse } from "../../reducers/GameActions";
import { legacyWildfirePreparedness } from "../../helpers/LegacyWildfirePreparedness";
import { formatMoneyConcise, formatPercent } from "../../helpers/Format";

/** Existing saved scenario programs keep an explicit stop control and their original terms. */
export default function LegacyWildfireProgram({ game }: { game: GameType }) {
  const dispatch = useAppDispatch();
  const program = legacyWildfirePreparedness(game);
  if (!program) return null;
  const option = program.choice.options[0];
  return (
    <Box
      component="section"
      aria-label="Wildfire preparedness"
      sx={{ mt: 2, display: "grid", gap: 1.5 }}
    >
      <Typography component="h3" variant="subtitle1">
        Wildfire preparedness
      </Typography>
      <Typography variant="body2">
        {program.active ? "On" : "Off"} ·{" "}
        {formatMoneyConcise(program.annualCost)}/yr ·{" "}
        {formatPercent(program.effectiveness)} effective
      </Typography>
      <LinearProgress
        variant="determinate"
        value={program.effectiveness * 100}
        aria-label="Wildfire preparedness effectiveness"
        aria-valuetext={`${formatPercent(program.effectiveness)} effective`}
      />
      <Typography variant="body2">
        Protection builds and fades over 12 months. At full protection, customer
        disconnections and generator losses are halved. Restoration costs
        remain.
      </Typography>
      <Typography variant="body2">{option.description}</Typography>
      <Button
        variant="outlined"
        sx={{ minHeight: 44, justifySelf: "start" }}
        disabled={
          !!game.replayPlayback ||
          game.date.monthsElapsed >= (game.customScenario?.durationMonths ?? 0)
        }
        onClick={() =>
          dispatch(
            chooseScenarioResponse({
              decisionId: program.choice.id,
              optionId: option.id,
            }),
          )
        }
      >
        {program.active
          ? "Turn off preparedness"
          : `Start preparedness (${formatMoneyConcise(program.annualCost)}/yr)`}
      </Button>
    </Box>
  );
}
