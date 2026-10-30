import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { NAV_CARDS } from "../../Constants";
import { getPlayedScenarioIds, recordScenarioPlayed } from "../../LocalStorage";
import { TUTORIALS } from "../../data/Scenarios";
import { useAppDispatch, useAppSelector } from "../../Store";
import { CardNameType, TutorialStepType } from "../../Types";
import { formatWatts } from "../../helpers/Format";
import { navigate } from "../../reducers/Card";
import { setSpeed } from "../../reducers/Game";
import { delta as uiDelta } from "../../reducers/UI";
import { isSideToolLayout } from "../../Globals";
import TutorialHud from "./TutorialHud";
import TutorialPrompt from "./TutorialPrompt";

/** The standard tutorial HUD guides the chosen grid without changing its scenario. */
export default function DataCenterGuide() {
  const dispatch = useAppDispatch();
  const requested = useAppSelector(
    (state) => state.ui.dataCenterGuideRequested,
  );
  const inGame = useAppSelector((state) => state.game.inGame);
  const speed = useAppSelector((state) => state.game.speed);
  const card = useAppSelector((state) => state.card.name);
  const ready = NAV_CARDS.includes(card) || card.startsWith("BUILD_");
  const load = useAppSelector((state) =>
    state.game.customScenario?.loadAdditions?.find(
      (item) => item.id === "community-data-centers",
    ),
  );
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
  const steps = React.useMemo<
    (TutorialStepType & { card: CardNameType })[]
  >(() => {
    const goal = load
      ? load.peakW > 0
        ? `New data centers add ${formatWatts(load.peakW)} of demand in ${load.startsYear}. `
        : "This run has no added data-center demand. "
      : "";
    return [
      {
        card: "FACILITIES",
        target: "#buildNav",
        continueOnClick: "#buildNav",
        action: "Tap Build to plan new supply",
        content: (
          <TutorialPrompt
            text={`${goal}Keep supply ahead of demand without running out of cash.`}
          />
        ),
      },
      {
        card: "BUILD_GENERATORS",
        target: "#tab-BUILD_STORAGE",
        continueOnClick: "#tab-BUILD_STORAGE",
        action: "Compare generators, then tap Storage",
        content: (
          <TutorialPrompt text="Set Capacity, compare Build cost and Build time, then use Review before buying. Construction must finish before a plant supplies power." />
        ),
      },
      {
        card: "BUILD_STORAGE",
        target: "#programsNav",
        continueOnClick: "#programsNav",
        action: "Compare storage, then tap Programs",
        content: (
          <TutorialPrompt text="Storage saves spare electricity for later. Compare power and storage duration: a battery can run empty. Leave enough generation to recharge it." />
        ),
      },
      {
        card: "PROGRAMS",
        target: '[aria-label^="Efficiency rebates"]',
        continueOnClick: '[aria-label^="Efficiency rebates"]',
        action: "Check your electricity rate, then open Efficiency rebates",
        content: (
          <TutorialPrompt text="The rate slider changes what customers pay. Higher rates can fund expansion, but raise bills and can drive customers away. Programs offer another way to manage demand." />
        ),
      },
      {
        card: "PROGRAMS",
        target: "#insightsNav",
        continueOnClick: "#insightsNav",
        action: "Open a program, review its estimate, then tap Insights",
        content: (
          <TutorialPrompt text="Efficiency rebates cut home and business use. Compare the cost and demand estimate before committing. Peak curtailment contracts instead reduce factory, mine and data-center use during a daily window." />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#eventsNav",
        continueOnClick: "#eventsNav",
        action: "Compare your outlook, then tap Events",
        content: (
          <TutorialPrompt text="Overview compares supply, demand, cash and emissions; Profitability shows where money goes. If supply falls short, build or reduce demand. If cash keeps falling, review rates and spending." />
        ),
      },
      {
        card: "EVENTS",
        target: "#scenarioNav",
        continueOnClick: "#scenarioNav",
        action: "Check Upcoming events, then tap Scenario",
        content: (
          <TutorialPrompt text="Start construction early enough to cover scheduled demand increases. Leave spare supply for demand peaks and changing weather." />
        ),
      },
      {
        card: "SCENARIO",
        target: ".scenarioDetailsBody",
        action: "Review your goals, then finish the tour",
        nextLabel: "Finish tour",
        content: (
          <TutorialPrompt text="Scenario shows your timeframe, goals and score rules. After the tour, choose 1× to start time. Pause whenever you need to plan." />
        ),
      },
    ];
  }, [load]);

  React.useEffect(() => {
    if (!inGame) setOpen(false);
    if (!requested || !inGame || !ready || blocked) return;
    dispatch(uiDelta({ dataCenterGuideRequested: false }));
    if (getPlayedScenarioIds().includes(TUTORIALS[0].id)) return;
    // Count the offer itself, including ignoring it or reloading, exactly once.
    recordScenarioPlayed(TUTORIALS[0].id);
    dispatch(setSpeed("PAUSED"));
    setStep(-1);
    setOpen(true);
  }, [requested, inGame, ready, blocked, dispatch]);

  React.useLayoutEffect(() => {
    if (open && inGame && speed !== "PAUSED") dispatch(setSpeed("PAUSED"));
  }, [open, inGame, speed, dispatch]);

  // Returning to the pricing step also restores the program list after a review.
  React.useEffect(() => {
    if (!open || blocked || step !== 3) return;
    document
      .querySelector<HTMLButtonElement>('[aria-label="Back to programs"]')
      ?.click();
  }, [open, blocked, step]);

  const close = React.useCallback(() => {
    dispatch(setSpeed("PAUSED"));
    setOpen(false);
  }, [dispatch]);

  React.useEffect(() => {
    if (!open || blocked || !ready || step < 0) return;
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
  }, [open, blocked, ready, step, close]);

  const goTo = React.useCallback(
    (index: number) => {
      const destination = steps[index].card;
      dispatch(
        navigate({
          name: destination,
          replaceCurrentCard: true,
          skipBrowserHistory: true,
        }),
      );
      setStep(index);
    },
    [dispatch, steps],
  );
  const next = React.useCallback(() => {
    if (step === steps.length - 1) {
      goTo(0);
      close();
    } else goTo(step + 1);
  }, [step, steps.length, goTo, close]);

  const autoAdvance = React.useCallback(() => setStep(step + 1), [step]);

  if (!open || !inGame || !ready || blocked) return null;
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
            programs. Tap each highlighted control to continue. Time will stay
            paused.
          </Typography>
        </DialogContent>
        <DialogActions
          sx={{
            p: 2,
            gap: 1,
            flexWrap: "wrap",
            "& .MuiButton-root": {
              minHeight: 40,
              "@media (pointer: coarse)": { minHeight: 44 },
            },
          }}
        >
          <Button onClick={close}>Skip tutorial</Button>
          <Button variant="contained" onClick={() => goTo(0)}>
            Start tour
          </Button>
        </DialogActions>
      </Dialog>
    );

  return (
    <div data-data-center-guide="true" style={{ display: "contents" }}>
      <TutorialHud
        desktop={isSideToolLayout()}
        step={steps[step]}
        stepIndex={step}
        totalSteps={steps.length}
        canGoBack={step > 0}
        onBack={() => goTo(step - 1)}
        onNext={next}
        onAutoAdvance={autoAdvance}
        onExit={close}
      />
    </div>
  );
}
