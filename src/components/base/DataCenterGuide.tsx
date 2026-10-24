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
import { CardNameType } from "../../Types";
import { formatWatts } from "../../helpers/Format";
import { navigate } from "../../reducers/Card";
import { setSpeed } from "../../reducers/Game";
import { delta as uiDelta } from "../../reducers/UI";
import "./DataCenterGuide.scss";

const STEPS: {
  card: CardNameType;
  enter: string;
  title: string;
  text: string;
}[] = [
  {
    card: "FACILITIES",
    enter: "Start tour",
    title: "Your goal: keep the lights on",
    text: "Keep supply ahead of demand without running out of cash. Open Build to see how to prepare.",
  },
  {
    card: "BUILD_GENERATORS",
    enter: "Open Build",
    title: "Plan a generator",
    text: "Set Capacity, compare Build cost and Build time, then choose Review to check a project before confirming it. New plants supply no power until construction finishes. You can open Build from anywhere in the grid.",
  },
  {
    card: "BUILD_STORAGE",
    enter: "Open Storage",
    title: "Store spare electricity",
    text: "Storage charges from spare supply and releases it later. Compare power and storage duration: a battery can run empty. Leave enough generation to recharge it.",
  },
  {
    card: "PROGRAMS",
    enter: "Open Programs",
    title: "Set the electricity price",
    text: "In Electricity pricing, move the rate slider to change what customers pay. Higher rates can fund expansion, but raise bills and can drive customers away. Check your cash before funding a build.",
  },
  {
    card: "PROGRAMS",
    enter: "Explore programs",
    title: "Reduce or shift demand",
    text: "Open a program below pricing to review its cost and demand estimate. Efficiency rebates cut home and business use; Peak curtailment contracts reduce factory, mine and data-center use during a daily window.",
  },
  {
    card: "INSIGHTS",
    enter: "Open Insights",
    title: "Check the results",
    text: "Use the Overview preset to compare supply, demand, cash and emissions. Choose Profitability to see where money goes. If supply falls short, build or reduce demand; if cash keeps falling, review rates and spending.",
  },
  {
    card: "EVENTS",
    enter: "Open Events",
    title: "Prepare for what’s next",
    text: "Check Upcoming events for scheduled changes. Start construction early enough to cover added demand, and leave spare supply for demand peaks and changing weather.",
  },
  {
    card: "SCENARIO",
    enter: "Open Scenario",
    title: "Know the finish line",
    text: "Scenario shows your timeframe, victory conditions and score rules. Finish the tour, then choose 1× at the top to start time. Pause whenever you need to plan.",
  },
];

/** A paused tour of the actual workspace; no purchases or policy changes are required. */
export default function DataCenterGuide() {
  const dispatch = useAppDispatch();
  const requested = useAppSelector(
    (state) => state.ui.dataCenterGuideRequested,
  );
  const inGame = useAppSelector((state) => state.game.inGame);
  const speed = useAppSelector((state) => state.game.speed);
  const card = useAppSelector((state) => state.card.name);
  const load = useAppSelector((state) =>
    state.game.customScenario?.loadAdditions?.find(
      (item) => item.id === "community-data-centers",
    ),
  );
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
  const heading = React.useRef<HTMLHeadingElement>(null);

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

  React.useLayoutEffect(() => {
    if (open && inGame && speed !== "PAUSED") dispatch(setSpeed("PAUSED"));
  }, [open, inGame, speed, dispatch]);

  // Dock buttons and Build tabs teach the same route as the tour's labeled actions.
  React.useEffect(() => {
    if (!open || step < 0 || STEPS[step].card === card) return;
    const destination = STEPS.findIndex((item) => item.card === card);
    if (destination >= 0) setStep(destination);
  }, [open, step, card]);

  React.useEffect(() => {
    if (open && !blocked && step >= 0) heading.current?.focus();
    if (open && !blocked && step === 4)
      document
        .querySelector(".customerProgramList")
        ?.scrollIntoView({ block: "nearest" });
  }, [open, step, blocked]);

  const close = React.useCallback(() => {
    dispatch(setSpeed("PAUSED"));
    setOpen(false);
  }, [dispatch]);

  React.useEffect(() => {
    if (!open || blocked || step < 0) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector(".MuiModal-root:not(.MuiModal-hidden)") ||
        (event.target instanceof Element &&
          event.target.closest('[data-program-decision="true"]'))
      )
        return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, blocked, step, close]);

  const goTo = (index: number) => {
    dispatch(
      navigate({
        name: STEPS[index].card,
        replaceCurrentCard: true,
        skipBrowserHistory: true,
      }),
    );
    setStep(index);
  };
  const finish = () => {
    goTo(0);
    close();
  };

  if (!open || !inGame || blocked) return null;

  if (step < 0)
    return (
      <Dialog
        open
        onClose={close}
        aria-labelledby="data-center-guide-title"
        data-data-center-guide="true"
        fullWidth
        maxWidth="sm"
        slotProps={{ paper: { sx: { backgroundImage: "none" } } }}
      >
        <DialogTitle id="data-center-guide-title">
          New to Electrify?
        </DialogTitle>
        <DialogContent>
          <Typography>
            Take a short tour of your grid, building tools and customer
            programs. Time will stay paused while you explore.
          </Typography>
        </DialogContent>
        <DialogActions className="dataCenterGuideActions" sx={{ p: 2 }}>
          <Button onClick={close}>Skip tutorial</Button>
          <Button variant="contained" onClick={() => goTo(0)}>
            Start tour
          </Button>
        </DialogActions>
      </Dialog>
    );

  const last = step === STEPS.length - 1;
  return (
    <section
      className="dataCenterGuide"
      aria-label="Data center tour"
      data-data-center-guide="true"
    >
      <div className="dataCenterGuideBody" aria-live="polite">
        <div className="dataCenterGuideHeading">
          <h2 tabIndex={-1} ref={heading}>
            {STEPS[step].title}
          </h2>
          <span>
            {step + 1} of {STEPS.length} · Paused
          </span>
        </div>
        <p>
          {step === 0 &&
            load &&
            (load.peakW > 0
              ? `New data centers add ${formatWatts(load.peakW)} of demand in ${load.startsYear}. `
              : "This run has no added data-center demand. ")}
          {STEPS[step].text}
        </p>
      </div>
      <div className="dataCenterGuideActions">
        <Button onClick={close}>Exit tour</Button>
        {step > 0 && <Button onClick={() => goTo(step - 1)}>Back</Button>}
        <Button
          variant="contained"
          onClick={last ? finish : () => goTo(step + 1)}
        >
          {last ? "Finish tour" : STEPS[step + 1].enter}
        </Button>
      </div>
    </section>
  );
}
