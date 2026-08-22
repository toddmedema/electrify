import * as React from "react";
import { SCENARIOS } from "../data/Scenarios";
import { CardNameType, TutorialStepType } from "../Types";
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
function step(move: Move): any[] {
  const dispatched: any[] = [];
  mapDispatchToProps((action: any) => {
    dispatched.push(action);
    return action;
  }).onTutorialStep({
    fromStep: move.fromStep,
    toStep: move.toStep,
    tutorialSteps: move.steps,
    scenarioId: 1,
    currentCard: move.currentCard,
  });
  return dispatched;
}

function navigatedTo(dispatched: any[]): CardNameType | undefined {
  const navigations = dispatched.filter((a) => a.type === "card/navigate");
  if (navigations.length > 1) {
    throw new Error(
      `One step change dispatched ${navigations.length} navigations`,
    );
  }
  if (navigations.length === 0) {
    return undefined;
  }
  const payload = navigations[0].payload;
  return (typeof payload === "string" ? payload : payload.name) as CardNameType;
}

describe("onTutorialStep", () => {
  const generators = walkthrough("102: Generators");

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
   * left on the build screen while the step's target lived on Facilities, Joyride found no
   * target, and the walkthrough appeared to die with no tooltip anywhere.
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

  // The mirror of the case above: the last step closes the build screen, so stepping back into
  // it has to reopen it
  it("navigates back into a screen a later step closed", () => {
    const last = generators.length - 1;
    expect(cardOf(generators[last])).toBe(STARTING_CARD);
    const dispatched = step({
      steps: generators,
      fromStep: last,
      toStep: last - 1,
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
      { card: "FINANCES", target: "#second", content: <span /> },
    ];

    it("fires onNext when leaving a step forwards", () => {
      expect(
        step({ steps, fromStep: 0, toStep: 1, currentCard: "FACILITIES" }),
      ).toContainEqual(sideEffect);
    });

    it("doesn't replay onNext when stepping backwards", () => {
      expect(
        step({ steps, fromStep: 1, toStep: 0, currentCard: "FINANCES" }),
      ).not.toContainEqual(sideEffect);
    });
  });
});

describe("walkthrough steps", () => {
  const tutorials = SCENARIOS.filter((s) => s.tutorialSteps);

  it("covers every walkthrough", () => {
    expect(tutorials.length).toBeGreaterThan(0);
  });

  tutorials.forEach((scenario) => {
    const steps = scenario.tutorialSteps as TutorialStepType[];

    it(`${scenario.name} declares the card every step's target lives on`, () => {
      steps.forEach((s, i) => {
        expect([`step ${i}`, cardOf(s)]).not.toContainEqual(undefined);
      });
    });

    // Walk the whole thing forwards and then all the way back, tracking the card the store
    // would be showing. Any step whose target isn't on the current card would show no tooltip
    it(`${scenario.name} shows each step's card in both directions`, () => {
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
        const destination = navigatedTo(
          step({ steps, fromStep, toStep, currentCard: card }),
        );
        if (destination) {
          card = destination;
        }
        expect([scenario.name, toStep, card]).toEqual([
          scenario.name,
          toStep,
          cardOf(steps[toStep]),
        ]);
      });
    });
  });
});
