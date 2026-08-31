import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { UnknownAction } from "redux";
import type { AppDispatch } from "../Store";
import { SCENARIOS } from "../data/Scenarios";
import { reprioritizeFacility, togglePauseFacility } from "../reducers/Game";
import { CardNameType, NavigateActionType, TutorialStepType } from "../Types";
import { mapDispatchToProps } from "./CompositorContainer";

// Where `loaded` drops the player, and so where every walkthrough starts
const STARTING_CARD: CardNameType = "FACILITIES";

function walkthrough(name: string): TutorialStepType[] {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (!scenario || !scenario.tutorialSteps) {
    throw new Error(`No walkthrough named ${name}`);
  }
  return scenario.tutorialSteps;
}

function cardOf(step: TutorialStepType): CardNameType | undefined {
  if (!step.card) {
    return undefined;
  }
  return typeof step.card === "string" ? step.card : step.card.name;
}

interface Move {
  steps: TutorialStepType[];
  fromStep: number;
  toStep: number;
  currentCard: CardNameType;
}

/**
 * Runs one step change and collects what it dispatched. The actions are captured rather than
 * reduced because the card reducer logs analytics and pushes browser history, neither of which
 * this is about - all that matters is which card the walkthrough asks for.
 */
function step(move: Move): UnknownAction[] {
  const dispatched: UnknownAction[] = [];
  mapDispatchToProps(((action: UnknownAction) => {
    dispatched.push(action);
    return action;
  }) as AppDispatch).onTutorialStep({
    fromStep: move.fromStep,
    toStep: move.toStep,
    tutorialSteps: move.steps,
    scenarioId: 1,
    currentCard: move.currentCard,
  });
  return dispatched;
}

function navigatedTo(dispatched: UnknownAction[]): CardNameType | undefined {
  const navigations = dispatched.filter((a) => a.type === "card/navigate");
  if (navigations.length > 1) {
    throw new Error(
      `One step change dispatched ${navigations.length} navigations`,
    );
  }
  if (navigations.length === 0) {
    return undefined;
  }
  // card/navigate takes either a bare card name or a full navigation object
  const payload = navigations[0].payload as string | NavigateActionType;
  return (typeof payload === "string" ? payload : payload.name) as CardNameType;
}

describe("onTutorialStep", () => {
  const generators = walkthrough("Mission 2: Generators");

  it("moves the walkthrough to the new step", () => {
    const dispatched = step({
      steps: generators,
      fromStep: 0,
      toStep: 1,
      currentCard: STARTING_CARD,
    });
    expect(dispatched).toContainEqual(
      expect.objectContaining({ payload: { tutorialStep: 1 } }),
    );
  });

  it("navigates forwards onto the card holding the next step's target", () => {
    const dispatched = step({
      steps: generators,
      fromStep: 0,
      toStep: 1,
      currentCard: STARTING_CARD,
    });
    expect(navigatedTo(dispatched)).toBe("BUILD_GENERATORS");
  });

  /**
   * Regression test. Back used to dispatch the previous step's onNext, which only ever modelled
   * moving forwards, so nothing undid the navigation the forward step performed: the player was
   * left on the build screen while the step's target lived on Facilities, so the objective had
   * no relevant control to identify.
   */
  it("navigates back onto the card holding the previous step's target", () => {
    const dispatched = step({
      steps: generators,
      fromStep: 1,
      toStep: 0,
      currentCard: "BUILD_GENERATORS",
    });
    expect(navigatedTo(dispatched)).toBe(STARTING_CARD);
    expect(dispatched).toContainEqual(
      expect.objectContaining({ payload: { tutorialStep: 0 } }),
    );
  });

  // The mirror of the case above: a later step closes the build screen, so stepping back into
  // the preceding shop step has to reopen it
  it("navigates back into a screen a later step closed", () => {
    const facilitiesStep = generators.findIndex(
      (candidate, index) =>
        index > 0 &&
        cardOf(candidate) === STARTING_CARD &&
        cardOf(generators[index - 1]) === "BUILD_GENERATORS",
    );
    expect(facilitiesStep).toBeGreaterThan(0);
    const dispatched = step({
      steps: generators,
      fromStep: facilitiesStep,
      toStep: facilitiesStep - 1,
      currentCard: STARTING_CARD,
    });
    expect(navigatedTo(dispatched)).toBe("BUILD_GENERATORS");
  });

  it("doesn't navigate while stepping within a single card", () => {
    expect(
      navigatedTo(
        step({
          steps: generators,
          fromStep: 1,
          toStep: 2,
          currentCard: "BUILD_GENERATORS",
        }),
      ),
    ).toBeUndefined();
  });

  describe("one-way side effects", () => {
    const sideEffect = { type: "test/onNext" };
    const steps: TutorialStepType[] = [
      {
        card: "FACILITIES",
        target: "#first",
        content: <span />,
        onNext: () => sideEffect,
      },
      { card: "INSIGHTS", target: "#second", content: <span /> },
    ];

    it("fires onNext when leaving a step forwards", () => {
      expect(
        step({ steps, fromStep: 0, toStep: 1, currentCard: "FACILITIES" }),
      ).toContainEqual(sideEffect);
    });

    it("doesn't replay onNext when stepping backwards", () => {
      expect(
        step({ steps, fromStep: 1, toStep: 0, currentCard: "INSIGHTS" }),
      ).not.toContainEqual(sideEffect);
    });
  });

  it("carries the guided generator purchase into its capstone", () => {
    const capstone = generators.findIndex((candidate) => candidate.capstone);
    expect(capstone).toBeGreaterThan(0);

    const dispatched = step({
      steps: generators,
      fromStep: capstone - 1,
      toStep: capstone,
      currentCard: "FACILITIES",
    });

    expect(dispatched.map((action) => action.type)).toEqual(["game/delta"]);
    expect(dispatched[0].payload).toEqual({ tutorialStep: capstone });
  });

  it("still rebuilds capstones that require an authored checkpoint", () => {
    const storage = walkthrough("Mission 3: Storage");
    const capstone = storage.findIndex((candidate) => candidate.capstone);

    const dispatched = step({
      steps: storage,
      fromStep: capstone - 1,
      toStep: capstone,
      currentCard: "FACILITIES",
    });

    expect(dispatched.map((action) => action.type)).toEqual([
      "game/quit",
      "game/start",
      "game/delta",
    ]);
    expect(dispatched[2].payload).toEqual({ tutorialStep: capstone });
  });
});

/**
 * Every component's markup as one blob to search. Source only: the test files are full of
 * fixture markup no walkthrough will ever point at.
 */
const SOURCE = (function read(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return read(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [fs.readFileSync(full, "utf8")]
      : [];
  });
})(path.join(__dirname, "..")).join("\n");

/** Both targets a step can carry, since the desktop override is a selector of its own */
function targetsOf(steps: TutorialStepType[]): string[] {
  return steps
    .flatMap((s) => [s.target, s.desktop && s.desktop.target])
    .filter((t): t is string => Boolean(t));
}

/** Whether anything in the app still declares the id or class a simple selector names */
function declares(simple: string): boolean {
  const name = simple.slice(1);
  if (simple.startsWith("#")) {
    return SOURCE.includes(`id="${name}"`);
  }
  // MUI generates its own class names, so there is nothing of ours to find. Those steps lean
  // on the card check above instead
  if (name.startsWith("Mui")) {
    return true;
  }
  // Class attributes are often assembled from a template, so look for the whole word anywhere
  // on a line that sets one rather than trying to parse the value out
  return SOURCE.split("\n").some(
    (line) =>
      line.includes("className") && line.split(/[^\w-]+/).includes(name),
  );
}

describe("walkthrough steps", () => {
  const tutorials = SCENARIOS.filter((s) => s.tutorialSteps);
  const actionGateTypes = new Set<string>([
    reprioritizeFacility.type,
    togglePauseFacility.type,
  ]);

  it("covers every walkthrough", () => {
    expect(tutorials.length).toBeGreaterThan(0);
  });

  it("uses real game actions for every action gate", () => {
    const declared = tutorials.flatMap(
      (scenario) =>
        scenario.tutorialSteps?.flatMap((tutorialStep) =>
          tutorialStep.advanceOnAction
            ? ([] as string[]).concat(tutorialStep.advanceOnAction)
            : [],
        ) || [],
    );
    expect(declared.filter((type) => !actionGateTypes.has(type))).toEqual([]);
  });

  it("uses the same symbols as the generator and storage buttons it highlights", () => {
    const actionOf = (step: TutorialStepType) =>
      React.isValidElement<{ action?: string[] }>(step.content)
        ? step.content.props.action
        : undefined;
    const generatorStep = walkthrough("Mission 2: Generators").find(
      (step) => step.target === ".button-buildGenerator",
    )!;
    const storageStep = walkthrough("Mission 3: Storage").find(
      (step) => step.target === ".button-buildStorage",
    )!;

    expect(actionOf(generatorStep)).toEqual(["generator"]);
    expect(actionOf(storageStep)).toEqual(["storage"]);
  });

  it("declares the card every tutorial target lives on", () => {
    tutorials.forEach((scenario) => {
      const steps = scenario.tutorialSteps as TutorialStepType[];
      steps.forEach((s, i) => {
        expect([scenario.name, `step ${i}`, cardOf(s)]).not.toContainEqual(
          undefined,
        );
      });
    });
  });

  // Walk each walkthrough forwards and then all the way back, tracking the card the store
  // would be showing. Any step whose target isn't on the current card would point at nothing
  it("shows each guided step's card in both directions", () => {
    tutorials.forEach((scenario) => {
      const steps = scenario.tutorialSteps as TutorialStepType[];
      let card: CardNameType = STARTING_CARD;
      expect(cardOf(steps[0])).toBe(card);

      const moves: Array<[number, number]> = [];
      for (let i = 0; i < steps.length - 1; i++) {
        moves.push([i, i + 1]);
      }
      for (let i = steps.length - 1; i > 0; i--) {
        moves.push([i, i - 1]);
      }

      moves.forEach(([fromStep, toStep]) => {
        const dispatched = step({ steps, fromStep, toStep, currentCard: card });
        const destination = navigatedTo(dispatched);
        if (destination) {
          card = destination;
        } else if (dispatched.some((action) => action.type === "game/start")) {
          // Capstones restart through Loading; its eventual card is outside this dispatch unit.
          card = STARTING_CARD;
          return;
        }
        expect([scenario.name, toStep, card]).toEqual([
          scenario.name,
          toStep,
          cardOf(steps[toStep]),
        ]);
      });
    });
  });

  /**
   * A selector matching nothing silently loses the restrained target treatment. Rendering every
   * card would be the airtight check; scanning the source for the id or class each selector names
   * catches that kind of rename far cheaper.
   */
  it("points every tutorial step at markup that still exists", () => {
    tutorials.forEach((scenario) => {
      const steps = scenario.tutorialSteps as TutorialStepType[];
      targetsOf(steps).forEach((target) => {
        target.split(/\s+/).forEach((simple) => {
          expect([scenario.name, target, declares(simple)]).toEqual([
            scenario.name,
            target,
            true,
          ]);
        });
      });
    });
  });
});
