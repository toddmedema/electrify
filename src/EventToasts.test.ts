import { eventToastForUpdate } from "./EventToasts";
import type { GameEventType, GameType, SpeedType } from "./Types";

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
  return { eventLog, date: { minute }, speed, inGame } as unknown as GameType;
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
