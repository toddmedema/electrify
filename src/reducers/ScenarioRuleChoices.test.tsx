import cloneDeep from "lodash.clonedeep";
import { createNextState } from "@reduxjs/toolkit";
import { TICKS_PER_MONTH } from "../Constants";
import type { RuleChoice, RuleEvent } from "../data/ScenarioRules";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "../helpers/DateTime";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { selectUpcomingStoryEvents } from "../components/views/StoryEventSelectors";
import { modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame, runSimulation } from "../testing/Simulator";
import type { AppStateType, DifficultyType, GameType } from "../Types";
import reducer, {
  delta,
  generateNewTimeline,
  setSpeed,
  tickState,
} from "./Game";
import { chooseScenarioResponse } from "./GameActions";

const choice = (id = "response", dueMonth = 1): RuleChoice => ({
  id,
  dueMonth,
  title: "Choose a response",
  prompt: "Commit to a response before continuing.",
  options: [
    {
      id: "accept",
      label: "Accept funding",
      description: "Receive company funding.",
      message: "Funding received.",
      grantDollars: 10000,
    },
    {
      id: "decline",
      label: "Keep the plan",
      description: "Keep the existing plan.",
      message: "The plan stays.",
      costDollars: 0,
    },
  ],
});
const pack = (
  choices: RuleChoice[] = [choice()],
  events: RuleEvent[] = [],
): ModPackage => ({
  schemaVersion: 1,
  gameApi: 1,
  id: "choice-grid",
  title: "Choice grid",
  creator: "Fixture",
  version: "1",
  description: "A grid with a binding response.",
  seed: 42,
  baseScenarioId: 999,
  officialArcs: [],
  objectives: { mode: "none" },
  scenario: {
    durationMonths: 6,
    cash: 1e9,
    startingCustomers: 10000,
    dollarsPerkWh: 0.2,
  },
  choices,
  events,
});
const game = (input = pack(), difficulty: DifficultyType = "Employee") =>
  createGame({
    scenarioId: 999,
    scenario: modScenario(input, undefined, difficulty),
    difficulty,
    seed: input.seed,
    wildfireHazardEnabled: false,
    weatherHazardsEnabled: false,
  });
const now = (state: GameType) =>
  getTimeFromTimeline(state.date.minute, state.timeline)!;
const answer = (id: string, optionId: string) =>
  chooseScenarioResponse({ decisionId: `mod:choice-grid:${id}`, optionId });
const restore = (state: GameType) => {
  const saved = parseSave(JSON.parse(JSON.stringify(serializeSave(state))));
  expect(saved).not.toBeNull();
  return cloneDeep(saved!.game);
};
const advance = (state: GameType, month: number) => {
  for (
    let i = 0;
    state.date.monthsElapsed < month && i < TICKS_PER_MONTH * (month + 1);
    i++
  )
    tickState(state);
  expect(state.date.monthsElapsed).toBe(month);
};
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("an opening choice blocks ticks and speed changes; a response stays paused and books once", () => {
  const before = game();
  expect(pendingScenarioChoice(before)?.id).toBe("mod:choice-grid:response");
  expect(before.speed).toBe("PAUSED");
  expect(reducer(before, setSpeed("ULTRA")).speed).toBe("PAUSED");
  const blocked = cloneDeep(before);
  for (let i = 0; i < 20; i++) tickState(blocked);
  expect(blocked.date.minute).toBe(0);
  const after = reducer(before, answer("response", "accept"));
  expect(now(after).cash - now(before).cash).toBe(10000);
  expect(now(after).revenueGrants).toBe(10000);
  expect(after.speed).toBe("PAUSED");
  expect(pendingScenarioChoice(after)).toBeUndefined();
  expect(reducer(after, answer("response", "decline"))).toBe(after);
  expect(
    reducer(after, delta({ dollarsPerkWh: after.dollarsPerkWh })).timeline,
  ).toEqual(after.timeline);
  expect(restore(after).worldEvents.occurrences).toEqual(
    after.worldEvents.occurrences,
  );
});

test("forged, early and unaffordable choices have no partial mutation; free funding works with negative cash", () => {
  const paid = choice();
  delete paid.options[0].grantDollars;
  paid.options[0].costDollars = 10;
  const input = pack(
    [paid, choice("later", 2)],
    [
      {
        id: "promised-funding",
        title: "Funding",
        message: "Funding arrives.",
        preview: "Funding will arrive.",
        startMonth: 1,
        durationMonths: 1,
        requiresChoice: { choiceId: "response", optionIds: ["accept"] },
        effects: { transactions: [{ kind: "grant", amountDollars: 100 }] },
      },
    ],
  );
  const before = game(input);
  now(before).cash = 5;
  expect(reducer(before, answer("later", "accept"))).toBe(before);
  expect(reducer(before, answer("response", "forged"))).toBe(before);
  expect(reducer(before, answer("response", "accept"))).toBe(before);
  const negative = game();
  now(negative).cash = -1;
  expect(now(reducer(negative, answer("response", "accept"))).cash).toBe(9999);
});

test("simultaneous decisions stay reachable after funding and a same-month conditional event", () => {
  const second = choice("b");
  delete second.options[0].grantDollars;
  second.options[0].costDollars = 5000;
  const input = pack(
    [second, choice("a")],
    [
      {
        id: "commitment",
        title: "Commitment",
        message: "The commitment starts.",
        preview: "The commitment will start.",
        startMonth: 1,
        durationMonths: 1,
        requiresChoice: { choiceId: "b", optionIds: ["accept"] },
        effects: {
          outputMultipliersByFuel: { "Natural Gas": 0 },
          transactions: [{ kind: "grant", amountDollars: 2000 }],
        },
      },
    ],
  );
  let live = game(input);
  now(live).cash = 100;
  expect(pendingScenarioChoice(live)?.id).toBe("mod:choice-grid:a");
  live = cloneDeep(reducer(live, answer("a", "accept")));
  expect(pendingScenarioChoice(live)?.id).toBe("mod:choice-grid:b");
  live = cloneDeep(reducer(live, answer("b", "accept")));
  expect(pendingScenarioChoice(live)).toBeUndefined();
  expect(live.speed).toBe("PAUSED");
  expect(now(live).cash).toBe(7100);
  expect(now(live).supplyW).toBe(0);
  expect(now(live).revenueGrants).toBe(12000);
  expect(
    live.worldEvents.occurrences.filter(
      (e) => e.key === "mod:choice-grid:commitment",
    ),
  ).toHaveLength(1);
  expect(restore(live).worldEvents.occurrences).toEqual(
    live.worldEvents.occurrences,
  );
  const forged = JSON.parse(JSON.stringify(serializeSave(live)));
  const conditional = forged.game.worldEvents.occurrences.pop();
  forged.game.worldEvents.occurrences.unshift(conditional);
  expect(parseSave(forged)).toBeNull();
});

test("a skipped dependent decision is never offered and valid pending state survives save", () => {
  const child = {
    ...choice("child", 2),
    requiresChoice: { choiceId: "parent", optionIds: ["accept"] },
  };
  const before = game(pack([child, choice("parent")]));
  expect(pendingScenarioChoice(restore(before))?.id).toBe(
    "mod:choice-grid:parent",
  );
  const live = cloneDeep(reducer(before, answer("parent", "decline")));
  advance(live, 2);
  expect(pendingScenarioChoice(live)).toBeUndefined();
  expect(restore(live).date).toEqual(live.date);
});

test("ULTRA presentation batches and catch-up ticks stop at the opening decision", () => {
  let live = game(pack([choice("response", 2)]));
  live.speed = "ULTRA";
  live = createNextState(live, (draft) => {
    for (let i = 0; i < TICKS_PER_MONTH * 3; i++) tickState(draft);
  });
  expect(live.date.minute).toBe(MINUTES_PER_MONTH);
  expect(live.monthlyHistory).toHaveLength(1);
  expect(live.speed).toBe("PAUSED");
  expect(pendingScenarioChoice(live)?.id).toBe("mod:choice-grid:response");
  const chosen = reducer(live, answer("response", "accept"));
  expect(chosen.speed).toBe("PAUSED");
  expect(now(chosen).revenueGrants).toBe(10000);
});

test("load replacement cancels only its future load and cannot be reintroduced at rollover", () => {
  const response = choice();
  response.options[0].replaceLoad = { loadId: "campus", with: [] };
  const live = game(
    pack(
      [response],
      [
        {
          id: "loads",
          title: "Scheduled loads",
          message: "New loads are scheduled.",
          preview: "Loads will connect.",
          startMonth: 1,
          loads: [
            {
              id: "campus",
              startMonth: 3,
              peakMW: 20,
              demandType: "Data Centers",
              loadFactor: 0.9,
            },
            {
              id: "unrelated",
              startMonth: 3,
              peakMW: 10,
              demandType: "Mining",
              loadFactor: 0.8,
            },
          ],
        },
      ],
    ),
  );
  const after = cloneDeep(reducer(live, answer("response", "accept")));
  expect(after.loadAdditions.map((load) => load.id)).toEqual([
    "mod:choice-grid:load:unrelated",
  ]);
  advance(after, 3);
  expect(after.loadAdditions.map((load) => load.id)).toEqual([
    "mod:choice-grid:load:unrelated",
  ]);
  expect(restore(after).loadAdditions).toEqual(after.loadAdditions);
  expect(() =>
    game(
      pack(
        [{ ...response, dueMonth: 3 }],
        [
          {
            id: "loads",
            title: "Loads",
            message: "Loads",
            preview: "Loads will arrive.",
            startMonth: 1,
            loads: [
              {
                id: "campus",
                startMonth: 3,
                peakMW: 20,
                demandType: "Data Centers",
                loadFactor: 0.9,
              },
            ],
          },
        ],
      ),
    ),
  ).toThrow(/before its start/);
});

test("late unanswered clocks, forged receipts and duplicate answers are rejected on import", () => {
  const before = game();
  const raw = () => JSON.parse(JSON.stringify(serializeSave(before)));
  const late = raw();
  late.game.date = getDateFromMinute(10, before.startingYear);
  expect(parseSave(late)).toBeNull();
  const answered = reducer(before, answer("response", "accept"));
  const saved = () => JSON.parse(JSON.stringify(serializeSave(answered)));
  for (const edit of [
    (value: ReturnType<typeof saved>) => {
      value.game.worldEvents.occurrences[0].attributes.upfrontGrant = 10001;
    },
    (value: ReturnType<typeof saved>) => {
      value.game.worldEvents.occurrences.push(
        value.game.worldEvents.occurrences[0],
      );
    },
    (value: ReturnType<typeof saved>) => {
      value.game.worldEvents.occurrences[0].attributes.choice = "forged";
    },
    (value: ReturnType<typeof saved>) => {
      delete value.game.worldEvents.occurrences[0].attributes.ruleChoice;
    },
  ]) {
    const value = saved();
    edit(value);
    expect(parseSave(value)).toBeNull();
  }
  expect(parseSave(saved())).not.toBeNull();
});

test("live, saved and headless explicit branches share monthly accounting and receipts", () => {
  const input = pack([choice("response", 2)]);
  const scenario = modScenario(input);
  let live = game(input);
  advance(live, 1);
  const pending = restore(live);
  live = cloneDeep(reducer(live, answer("response", "accept")));
  const resumed = cloneDeep(reducer(pending, answer("response", "accept")));
  advance(live, 3);
  advance(resumed, 3);
  const headless = runSimulation({
    scenarioId: 999,
    scenario,
    seed: input.seed,
    difficulty: "Employee",
    months: 3,
    strategy: "none",
    scenarioResponses: { "mod:choice-grid:response": "accept" },
    wildfireHazardEnabled: false,
    weatherHazardsEnabled: false,
  });
  expect(headless.violations).toEqual([]);
  expect(headless.months).toEqual([...live.monthlyHistory].reverse());
  expect(resumed.monthlyHistory).toEqual(live.monthlyHistory);
  expect(headless.storyOccurrences).toEqual(live.worldEvents.occurrences);
});

test("forecasts name the pending decision without choosing either branch, then use the commitment", () => {
  const input = pack(
    [choice("response", 2)],
    [
      {
        id: "surge",
        title: "Demand commitment",
        message: "Demand doubles.",
        preview: "Demand will double.",
        startMonth: 2,
        durationMonths: 1,
        requiresChoice: { choiceId: "response", optionIds: ["accept"] },
        effects: { demandMultiplier: 2 },
      },
    ],
  );
  const before = game(input);
  const original = JSON.stringify(before);
  generateNewTimeline(
    before,
    now(before).cash,
    now(before).customers,
    TICKS_PER_MONTH * 3,
  );
  expect(JSON.stringify(before)).toBe(original);
  advance(before, 1);
  const upcoming = selectUpcomingStoryEvents({ game: before } as AppStateType);
  expect(
    upcoming.find((event) => event.key === "mod:choice-grid:response")?.label,
  ).toContain("Decision required");
  expect(upcoming.some((event) => event.key === "mod:choice-grid:surge")).toBe(
    false,
  );
  const after = reducer(before, answer("response", "accept"));
  const committedForecast = generateNewTimeline(
    before,
    now(before).cash,
    now(before).customers,
    before.timeline.length,
  );
  expect(now(after).demandW / committedForecast[0].demandW).toBeCloseTo(2, 10);
  expect(now(after).cash - now(before).cash).toBe(10000);
  expect(JSON.parse(JSON.stringify(restore(after).timeline))).toEqual(
    JSON.parse(JSON.stringify(after.timeline)),
  );
});

test("a conditional load connects at the answered opening without choosing it in the pending forecast", () => {
  const input = pack(
    [choice()],
    [
      {
        id: "conditional-load",
        title: "Connected campus",
        message: "The campus connects.",
        preview: "The campus will connect.",
        startMonth: 1,
        requiresChoice: { choiceId: "response", optionIds: ["accept"] },
        loads: [
          {
            id: "campus",
            startMonth: 1,
            peakMW: 100,
            demandType: "Data Centers",
            loadFactor: 0.9,
          },
        ],
      },
    ],
  );
  const before = game(input);
  const declined = reducer(before, answer("response", "decline"));
  const accepted = reducer(before, answer("response", "accept"));
  expect(now(declined).demandW).toBe(now(before).demandW);
  expect(now(accepted).demandByType["Data Centers"]).toBeGreaterThan(
    now(declined).demandByType["Data Centers"] + 50000000,
  );
  expect(accepted.loadAdditions.map((load) => load.id)).toContain(
    "mod:choice-grid:load:campus",
  );
  expect(restore(accepted).loadAdditions).toEqual(accepted.loadAdditions);
});

test("reordered equivalent frozen load definitions retain the same runtime schedule and forecast", () => {
  const response = choice();
  response.options[0].replaceLoad = {
    loadId: "target",
    with: [
      {
        id: "phase-a",
        startMonth: 3,
        peakMW: 5,
        demandType: "Data Centers",
        loadFactor: 0.9,
      },
      {
        id: "phase-z",
        startMonth: 4,
        peakMW: 5,
        demandType: "Data Centers",
        loadFactor: 0.9,
      },
    ],
  };
  const input = pack(
    [response],
    [
      {
        id: "loads",
        title: "Loads",
        message: "Loads",
        preview: "Loads will arrive.",
        startMonth: 1,
        loads: [
          {
            id: "target",
            startMonth: 3,
            peakMW: 10,
            demandType: "Data Centers",
            loadFactor: 0.9,
          },
          {
            id: "other",
            startMonth: 3,
            peakMW: 10,
            demandType: "Mining",
            loadFactor: 0.8,
          },
        ],
      },
    ],
  );
  const original = modScenario(input);
  const reordered = cloneDeep(original);
  reordered.mod!.rules.loads.reverse();
  reordered
    .mod!.rules.choices[0].options.find((option) => option.id === "accept")!
    .replaceLoad!.with.reverse();
  const make = (scenario: typeof original) =>
    createGame({
      scenarioId: 999,
      scenario,
      seed: input.seed,
      wildfireHazardEnabled: false,
      weatherHazardsEnabled: false,
    });
  const a = make(original),
    b = make(reordered);
  expect(a.loadAdditions).toEqual(b.loadAdditions);
  const answeredA = reducer(a, answer("response", "accept"));
  const answeredB = reducer(b, answer("response", "accept"));
  expect(answeredA.loadAdditions).toEqual(answeredB.loadAdditions);
  expect(JSON.parse(JSON.stringify(answeredA.timeline))).toEqual(
    JSON.parse(JSON.stringify(answeredB.timeline)),
  );
});
