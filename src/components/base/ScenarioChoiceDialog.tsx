import { currentCash } from "../../helpers/GameSelectors";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../Store";
import {
  pendingScenarioChoice,
  scenarioChoiceDescription,
} from "../../helpers/ScenarioChoices";
import { chooseScenarioResponse } from "../../reducers/GameActions";
import { formatMoneyConcise } from "../../helpers/Format";
import ConceptIcon from "./ConceptIcon";

export default function ScenarioChoiceDialog() {
  const game = useAppSelector((state) => state.game);
  const dispatch = useAppDispatch();
  const decision =
    game.inGame && !game.replayPlayback
      ? pendingScenarioChoice(game)
      : undefined;
  if (!decision) return null;
  const company = game.multiplayer?.clock?.players.find(
    (player) => player.id === game.multiplayer?.seat,
  )?.name;
  const deciding =
    game.multiplayer?.clock?.players
      .filter((player) => player.pauseReason === "Choosing a response")
      .map((player) => player.name) ?? [];
  const cash = currentCash(game);
  const options = decision.options.map((option) => {
    const cost = option.cost(game.difficulty);
    return {
      option,
      cost,
      grant: option.upfrontGrant?.(game.difficulty) ?? 0,
      affordable: cost === 0 || cash >= cost,
    };
  });
  const primaryOption = options.find(({ affordable }) => affordable)?.option.id;
  return (
    <Dialog
      key={decision.id}
      open
      fullWidth
      maxWidth="sm"
      aria-labelledby="scenarioChoiceTitle"
      aria-describedby="scenarioChoiceDescription"
      data-scenario-choice="true"
      slotProps={{
        paper: {
          sx: {
            m: { xs: 1.5, sm: 4 },
            width: { xs: "calc(100% - 24px)", sm: "calc(100% - 64px)" },
            maxHeight: {
              xs: "calc(100dvh - 24px)",
              sm: "calc(100dvh - 64px)",
            },
          },
        },
      }}
    >
      <DialogTitle
        id="scenarioChoiceTitle"
        sx={{
          "&&": {
            px: { xs: 2, sm: 3 },
            pt: 2,
            pb: 1,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
          },
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
          {decision.title}
        </span>
        <span className="pausedChip">
          <span aria-hidden="true">
            <ConceptIcon concept="pause" fontSize="small" />
          </span>
          Paused
        </span>
      </DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 }, pb: 3 }}>
        {company && (
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Your company: {company}
          </Typography>
        )}
        {!!deciding.length && (
          <Typography
            role="status"
            variant="body2"
            color="text.secondary"
            sx={{ mb: 2 }}
          >
            Still deciding: {deciding.join(", ")}. Each company chooses for its
            own grid.
          </Typography>
        )}
        <Typography
          id="scenarioChoiceDescription"
          sx={{ mb: 2, overflowWrap: "anywhere" }}
        >
          {decision.message}
        </Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
            gap: 2,
          }}
        >
          {options.map(({ option, cost, grant, affordable }) => {
            return (
              <Box key={option.id}>
                <Button
                  fullWidth
                  autoFocus={option.id === primaryOption}
                  variant={
                    option.id === primaryOption ? "contained" : "outlined"
                  }
                  disabled={!affordable}
                  aria-describedby={[
                    `scenarioChoiceOption-${option.id}`,
                    ...(grant > 0 ? [`scenarioChoiceGrant-${option.id}`] : []),
                  ].join(" ")}
                  sx={{
                    minHeight: 44,
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                  }}
                  onClick={() =>
                    dispatch(
                      chooseScenarioResponse({
                        decisionId: decision.id,
                        optionId: option.id,
                      }),
                    )
                  }
                >
                  {cost > 0
                    ? `${option.label} (${formatMoneyConcise(cost)})`
                    : option.label}
                </Button>
                <Typography
                  id={`scenarioChoiceOption-${option.id}`}
                  variant="body2"
                  sx={{
                    color: "text.secondary",
                    mt: 0.5,
                    overflowWrap: "anywhere",
                  }}
                >
                  {scenarioChoiceDescription(option, game.difficulty)}
                  {!affordable && " · Insufficient cash"}
                </Typography>
                {grant > 0 && (
                  <Typography
                    id={`scenarioChoiceGrant-${option.id}`}
                    variant="body2"
                    sx={{ mt: 0.5 }}
                  >
                    One-time grant: {formatMoneyConcise(grant)}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
