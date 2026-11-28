import { eventToastForUpdate } from "./EventToasts";
import type {
  ActiveWorldEventType,
  GameEventType,
  GameType,
  SpeedType,
} from "./Types";

let nextId = 1;
function event(fields: Partial<GameEventType>): GameEventType {
  return {
    id: nextId++,
    kind: "WORLD_EVENT",
    label: "Jan 2020",
    message: "Something happened",
    ...fields,
  };
}

function game(
  eventLog: GameEventType[],
  minute: number,
  speed: SpeedType = "FAST",
  inGame = true,
): GameType {
  return {
    eventLog,
    date: { minute },
    speed,
    inGame,
    facilities: [],
    worldEvents: { active: [], checkedKeys: [], occurrences: [] },
  } as unknown as GameType;
}

describe("event toasts", () => {
  const history = [event({ message: "Old news", importance: "NOTABLE" })];
  const before = game(history, 100);

  it("toasts notable news without claiming the clock stopped", () => {
    const crossover = event({
      kind: "FUEL_CROSSOVER",
      importance: "NOTABLE",
      message: "Natural Gas is now more expensive than Coal",
    });
    expect(
      eventToastForUpdate(before, game([crossover, ...history], 101)),
    ).toEqual({
      message: "Natural Gas is now more expensive than Coal",
      paused: false,
    });
  });

  it("names the event that paused the game, whatever its importance", () => {
    const ends = event({ importance: "ROUTINE", title: "Gas boom ends" });
    expect(
      eventToastForUpdate(before, game([ends, ...history], 101, "PAUSED")),
    ).toEqual({ message: "Paused: Gas boom ends", paused: true });
  });

  it("leads with the most important of several and counts the rest", () => {
    const notable = event({ importance: "NOTABLE", title: "Plant advice" });
    const critical = event({ importance: "CRITICAL", title: "Hail damage" });
    expect(
      eventToastForUpdate(
        before,
        game([critical, notable, ...history], 101, "PAUSED"),
      ),
    ).toEqual({ message: "Paused: Hail damage (+1 more)", paused: true });
  });

  it("targets all struck plants from the grouped hail occurrence", () => {
    const hail = event({
      importance: "CRITICAL",
      concept: "severeWeather",
      title: "Hail damage",
      storyPhaseKey: "weather-hail:Denver:1",
    });
    const current = game([hail, ...history], 101, "PAUSED");
    current.facilities = [
      { id: 10 },
      { id: 11 },
      { id: 12, minuteCreated: 101 },
      { id: 99 },
    ] as GameType["facilities"];
    current.worldEvents = {
      active: [],
      checkedKeys: [],
      occurrences: [10, 11, 12].map((id): ActiveWorldEventType => ({
        key: `${hail.storyPhaseKey}:f${id}`,
        definitionId: "weather-hail",
        startsMinute: 100,
        endsMinute: 200,
        attributes: { eventKey: hail.storyPhaseKey! },
        effects: { facilityOutputMultipliersById: { [id]: 0.5 } },
      })),
    };
    expect(eventToastForUpdate(before, current)).toMatchObject({
      message: "Paused: Hail damage",
      mapFocus: { facilityIds: [10, 11] },
    });
  });

  it("targets the new wildfire's ignition site", () => {
    const wildfire = event({
      importance: "NOTABLE",
      concept: "severeWeather",
      title: "Wildfire",
    });
    const current = game([wildfire, ...history], 101);
    current.territoryWeather = {
      dryness: 0.8,
      fires: [
        {
          startsMinute: 90,
          tiles: [{ tileId: "champlain:site-1", ignitesMinute: 90 }],
        },
        {
          startsMinute: 101,
          tiles: [
            { tileId: "champlain:site-8", ignitesMinute: 101 },
            { tileId: "champlain:site-9", ignitesMinute: 221 },
          ],
        },
      ],
    };
    expect(eventToastForUpdate(before, current)).toMatchObject({
      mapFocus: { tileId: "champlain:site-8" },
    });
  });

  it("uses the affected fuels in an authored freeze and can show the entire grid", () => {
    const freeze = event({
      importance: "CRITICAL",
      concept: "blackout",
      storyPhaseKey: "story:107:texas-deep-freeze:uri",
    });
    const current = game([freeze, ...history], 101, "PAUSED");
    current.facilities = [
      { id: 10, fuel: "Natural Gas" },
      { id: 11, fuel: "Sun" },
    ] as GameType["facilities"];
    current.worldEvents = {
      active: [],
      checkedKeys: [],
      occurrences: [
        {
          key: freeze.storyPhaseKey!,
          definitionId: "texas-deep-freeze:uri",
          startsMinute: 101,
          endsMinute: 200,
          attributes: {},
          effects: {
            winterizationOutputMultipliersByFuel: { "Natural Gas": 0.5 },
          },
        },
      ],
    };
    expect(eventToastForUpdate(before, current)?.mapFocus).toEqual({
      facilityIds: [10],
    });
    expect(
      eventToastForUpdate(before, { ...current, facilities: [] })?.mapFocus,
    ).toEqual({});
  });

  it("leaves routine and unranked news to the Events pane", () => {
    const price = event({ kind: "FUEL_PRICE", message: "Coal up 20%" });
    const routine = event({ importance: "ROUTINE", title: "Drift" });
    expect(
      eventToastForUpdate(before, game([routine, price, ...history], 101)),
    ).toBeUndefined();
  });

  it("ignores the player's own actions, which happen with the clock still", () => {
    const built = event({ kind: "BUILD", importance: "NOTABLE" });
    expect(
      eventToastForUpdate(before, game([built, ...history], 100)),
    ).toBeUndefined();
  });

  it("ignores the history a run arrives with", () => {
    const loaded = event({ importance: "CRITICAL", title: "Wildfire" });
    expect(
      eventToastForUpdate(
        game([], 0, "PAUSED", false),
        game([loaded, ...history], 500, "PAUSED"),
      ),
    ).toBeUndefined();
  });
});
