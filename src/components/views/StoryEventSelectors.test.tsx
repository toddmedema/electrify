import { SCENARIOS } from "../../data/Scenarios";
import { createGame } from "../../testing/Simulator";
import { ActiveWorldEventType, AppStateType } from "../../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import {
  selectActiveEventGroups,
  selectUpcomingStoryEvents,
} from "./StoryEventSelectors";
import { modScenario } from "../../mods/ModScenario";
import type { ModPackage } from "../../mods/ModSchema";

function event(
  key: string,
  overrides: Partial<ActiveWorldEventType> = {},
): ActiveWorldEventType {
  return {
    key,
    definitionId: key,
    startsMinute: 12 * MINUTES_PER_MONTH,
    endsMinute: 14 * MINUTES_PER_MONTH,
    attributes: {},
    effects: {},
    title: key,
    message: `${key} is happening.`,
    importance: "NOTABLE",
    ...overrides,
  };
}

function stateAt(minute: number, active: ActiveWorldEventType[]) {
  const game = createGame({ scenarioId: 111 });
  game.date = getDateFromMinute(minute, game.startingYear);
  game.worldEvents.active = active;
  return { game } as AppStateType;
}

test("mod-only upcoming events use previews and keep surprises hidden without imported arcs or loads", () => {
  const scenario = modScenario({
    schemaVersion: 1,
    gameApi: 1,
    id: "upcoming-fixture",
    title: "Upcoming",
    creator: "Creator",
    version: "1",
    description: "A forecast fixture.",
    baseScenarioId: 999,
    seed: 42,
    officialArcs: [],
    objectives: { mode: "none" },
    events: [
      {
        id: "announced",
        title: "Output limit",
        message: "Output is lower.",
        preview: "Output will fall.",
        startMonth: 2,
        durationMonths: 1,
        effects: { outputMultipliersByFuel: { Coal: 0.5 } },
      },
      {
        id: "hidden",
        title: "Surprise",
        message: "An unexpected event.",
        visibility: "surprise",
        startMonth: 2,
      },
    ],
  });
  const game = createGame({ scenarioId: 999, scenario, seed: 42 });
  const before = JSON.stringify(game);
  const events = selectUpcomingStoryEvents({ game } as AppStateType);
  expect(events.map((event) => [event.title, event.message])).toEqual([
    ["Output limit", "Output will fall."],
  ]);
  expect(JSON.stringify(game)).toBe(before);
});

describe("active event groups", () => {
  it("uses the updated run's title and expiry when a package reuses its event ID", () => {
    const input = (
      version: string,
      title: string,
      duration: number,
    ): ModPackage => ({
      schemaVersion: 1,
      gameApi: 1,
      id: "updated-active-event",
      title: "Status review",
      creator: "Author",
      version,
      description: "A scenario with an opening output warning.",
      baseScenarioId: 999,
      seed: 42,
      objectives: { mode: "none" },
      officialArcs: [],
      scenario: { startingYear: 2020, durationMonths: 6, cash: 1e9 },
      events: [
        {
          id: "warning",
          title,
          message: "Prepare local supply.",
          preview: "A warning will appear.",
          startMonth: 1,
          durationMonths: duration,
          effects: { demandMultiplier: 1.1 },
        },
      ],
    });
    const oldGame = createGame({
      scenarioId: 999,
      scenario: modScenario(input("1", "Original warning", 1)),
      seed: 42,
    });
    const oldGroups = selectActiveEventGroups({
      game: oldGame,
    } as AppStateType);
    expect(oldGroups).toEqual([
      expect.objectContaining({
        title: "Original warning",
        throughLabel: "through Jan 2020",
      }),
    ]);
    expect(
      selectActiveEventGroups({
        game: {
          ...oldGame,
          worldEvents: { ...oldGame.worldEvents, active: [] },
        },
      } as unknown as AppStateType),
    ).toEqual([]);
    const newGame = createGame({
      scenarioId: 999,
      scenario: modScenario(input("2", "Updated warning", 3)),
      seed: 42,
    });
    expect(newGame.customScenario!.mod!.runtimeDigest).not.toBe(
      oldGame.customScenario!.mod!.runtimeDigest,
    );
    expect(newGame.worldEvents.active[0].title).toBe("Updated warning");
    const newGroups = selectActiveEventGroups({
      game: newGame,
    } as AppStateType);
    expect(newGroups).toEqual([
      expect.objectContaining({
        title: "Updated warning",
        throughLabel: "through Mar 2020",
      }),
    ]);
    expect(selectActiveEventGroups({ game: newGame } as AppStateType)).toBe(
      newGroups,
    );
    expect(selectActiveEventGroups({ game: oldGame } as AppStateType)).toEqual(
      oldGroups,
    );
  });

  it("includes only critical and notable events in effect now", () => {
    const now = 13 * MINUTES_PER_MONTH;
    const groups = selectActiveEventGroups(
      stateAt(now, [
        event("now"),
        event("later", { startsMinute: now + 1 }),
        event("over", { endsMinute: now }),
        event("silent", { message: undefined }),
        event("routine", { importance: "ROUTINE" }),
        event("unranked", { importance: undefined }),
      ]),
    );
    expect(groups.map((group) => group.title)).toEqual(["now"]);
    expect(groups[0].throughLabel).toBe("through Feb 2023");
  });

  it("groups repeated occurrences and leads with the most severe", () => {
    const now = 13 * MINUTES_PER_MONTH;
    const groups = selectActiveEventGroups(
      stateAt(now, [
        event("hail:1", { title: "Hail damage", importance: "CRITICAL" }),
        event("hail:2", { title: "Hail damage", importance: "CRITICAL" }),
        event("Extreme cold"),
      ]),
    );
    expect(
      groups.map(({ title, count, importance }) => [title, count, importance]),
    ).toEqual([
      ["Hail damage", 2, "CRITICAL"],
      ["Extreme cold", 1, "NOTABLE"],
    ]);
  });

  it("returns the same array across ticks until an event starts or ends", () => {
    const active = [event("fire")];
    const first = selectActiveEventGroups(
      stateAt(13 * MINUTES_PER_MONTH, active),
    );
    const next = selectActiveEventGroups(
      stateAt(13 * MINUTES_PER_MONTH + 60, [...active]),
    );
    expect(next).toBe(first);
    expect(
      selectActiveEventGroups(stateAt(14 * MINUTES_PER_MONTH, active)),
    ).toEqual([]);
  });
});

test("custom story forecasts appear without scheduled load additions", () => {
  const source = SCENARIOS.find((scenario) => scenario.id === 100)!;
  const game = createGame({
    scenarioId: 999,
    scenario: {
      ...source,
      id: 999,
      eventScenarioIds: [100],
      loadAdditions: [],
    },
  });
  expect(game.loadAdditions).toEqual([]);

  const upcoming = selectUpcomingStoryEvents({ game } as AppStateType);
  expect(upcoming).toEqual([
    expect.objectContaining({
      key: "story:100:carbon-fee-ratchet:ratchet-onset",
      title: "Pollution fees rising",
      message: "Coal and gas costing more to run.",
      label: `Expected Jan ${game.startingYear + 4}`,
    }),
  ]);
  expect(upcoming[0].message).not.toMatch(/[\d%$]/);

  game.customScenario = { ...game.customScenario!, eventScenarioIds: [] };
  expect(selectUpcomingStoryEvents({ game } as AppStateType)).toEqual([]);
});
