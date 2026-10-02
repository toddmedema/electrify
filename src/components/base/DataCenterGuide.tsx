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
    title: "Keep the lights on",
    text: "Keep electricity flowing without running out of cash. Pause whenever you want to inspect the grid or plan a build.",
  },
  {
    title: "Watch supply and demand",
    text: "In Facilities, supply must meet demand or blackouts begin. Data centers add demand when they open. Leave spare supply for demand peaks and weather changes.",
  },
  {
    title: "Build ahead",
    text: "Choose Build in Facilities to add generators or storage before data centers open. Plants supply no power until construction finishes. Wind and solar output varies with weather; storage saves energy for later but can run empty.",
  },
  {
    title: "Watch costs and emissions",
    text: "Supplying more demand can raise costs and emissions, depending on what you build. Use Insights to track expenses, electricity rates and emissions together.",
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
            ? "Would you like four quick tips on keeping the lights on, building ahead, and understanding costs and emissions?"
            : STEPS[step].text}
        </Typography>
        {(intro || last) && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {last
              ? "Choose 1× at the top to start time when you’re ready."
              : "The game is paused. Choose 1× at the top to start time after closing these tips."}
          </Typography>
        )}
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
