import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { getPlayedScenarioIds, recordScenarioPlayed } from "../../LocalStorage";
import { TUTORIALS } from "../../data/Scenarios";
import { useAppDispatch, useAppSelector } from "../../Store";
import { setSpeed } from "../../reducers/Game";
import { delta as uiDelta } from "../../reducers/UI";

const STEPS = [
  {
    title: "You run an example grid",
    text: "Keep electricity flowing without running out of cash. Cash, date and speed controls are at the top. Choose 1× to run time; pause whenever you want to inspect or build. On phones, the bottom tabs switch between Facilities, Insights and Events.",
  },
  {
    title: "Watch the new demand",
    text: "Facilities shows supply against demand. A shortage causes blackouts. In Insights, open Layers and select Supply & Demand and Demand by use to look ahead to the data centers’ opening year. Leave spare supply for demand peaks and weather changes.",
  },
  {
    title: "Build before it is needed",
    text: "In Facilities, choose Build to add generators or storage. Check cost, output and construction time: unfinished plants supply no power. Solar and wind output varies with weather; storage holds energy for later and can run empty. Plan additions before the data centers open.",
  },
  {
    title: "Compare community tradeoffs",
    text: "In Insights → Layers, add Expenses, Cash and Emissions (CO2e). Check the electricity rate at the top of Insights. Compare with a 0 MW run using the same city, years and other settings. This example explores tradeoffs, not your utility’s actual plans. The game menu has a Manual for more help.",
  },
];

/** A reading-only introduction: never changes the chosen grid, scenario or screen. */
export default function DataCenterGuide() {
  const dispatch = useAppDispatch();
  const requested = useAppSelector(
    (state) => state.ui.dataCenterGuideRequested,
  );
  const inGame = useAppSelector((state) => state.game.inGame);
  const replaying = useAppSelector((state) => !!state.game.replayPlayback);
  const blocked = useAppSelector(
    (state) =>
      !!(
        state.ui.dialog.open ||
        state.ui.manualHelpEntry ||
        state.ui.victory ||
        state.user.needsDisplayName
      ),
  );
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(-1);

  React.useEffect(() => {
    if (!inGame) setOpen(false);
    if (!requested || !inGame || blocked) return;
    dispatch(uiDelta({ dataCenterGuideRequested: false }));
    if (replaying || getPlayedScenarioIds().includes(TUTORIALS[0].id)) return;
    // Count the offer itself, including ignoring it or reloading, exactly once.
    recordScenarioPlayed(TUTORIALS[0].id);
    dispatch(setSpeed("PAUSED"));
    setStep(-1);
    setOpen(true);
  }, [requested, inGame, replaying, blocked, dispatch]);

  const close = () => {
    dispatch(setSpeed("PAUSED"));
    setOpen(false);
  };
  const intro = step < 0;
  const last = step === STEPS.length - 1;

  return (
    <Dialog
      open={open && inGame && !blocked}
      onClose={close}
      aria-labelledby="data-center-guide-title"
      data-data-center-guide="true"
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { backgroundImage: "none" } } }}
    >
      <DialogTitle id="data-center-guide-title">
        {intro ? "New to Electrify?" : STEPS[step].title}
      </DialogTitle>
      <DialogContent>
        {!intro && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {step + 1} of {STEPS.length}
          </Typography>
        )}
        <Typography>
          {intro
            ? "Would you like a quick tutorial? Four short tips cover keeping the lights on, building ahead, and comparing costs and emissions. Your chosen grid stays as it is."
            : STEPS[step].text}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {last
            ? "Ready to explore? Close these tips, then choose 1× at the top to start time."
            : "Your game is paused. When you close these tips, choose 1× at the top to start time."}
        </Typography>
      </DialogContent>
      <DialogActions
        sx={{
          p: 2,
          flexWrap: "wrap",
          gap: 1,
          "& .MuiButton-root": {
            minHeight: 40,
            "@media (pointer: coarse)": { minHeight: 44 },
          },
        }}
      >
        <Button onClick={close}>
          {intro ? "Skip tutorial" : "Close tips"}
        </Button>
        {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
        <Button
          variant="contained"
          onClick={last ? close : () => setStep(step + 1)}
        >
          {intro ? "Show me the basics" : last ? "Ready to explore" : "Next"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
