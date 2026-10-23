import "../../Store";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { TICKS_PER_MONTH } from "../../Constants";
import * as Globals from "../../Globals";
import { getScenarioLocation } from "../../helpers/Locations";
import { modScenario } from "../../mods/ModScenario";
import {
  applyCommand,
  createWorld,
  roomView,
  stepWorld,
} from "../../multiplayer/World";
import type { Command } from "../../multiplayer/Types";
import { coopSeats } from "../../testing/MultiplayerFixtures";
import { loadSimData } from "../../testing/SimData";
import EventLog from "./EventLog";

jest.mock("../base/GameCard", () => (props: { children: ReactNode }) => (
  <div>{props.children}</div>
));

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
  jest.spyOn(Globals, "isPaneLayout").mockReturnValue(false);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("a retired company's real timeline retains its name outside the active clock roster", () => {
  const scenario = modScenario(
    {
      schemaVersion: 1,
      gameApi: 1,
      id: "company-timeline",
      title: "Company timelines",
      creator: "Fixture",
      version: "1",
      description: "Each company's result remains identifiable.",
      seed: 42,
      baseScenarioId: 999,
      officialArcs: [],
      scenario: {
        startingYear: 2020,
        durationMonths: 6,
        startingCustomers: 10000,
        cash: 1e9,
        dollarsPerkWh: 0.2,
      },
      objectives: [
        {
          id: "affordable",
          label: "Keep bills affordable",
          metric: "monthlyBilledRate",
          fromMonth: 1,
          throughMonth: 6,
          maxDollarsPerKWh: 0.1,
        },
      ],
    },
    undefined,
    "Employee",
  );
  const location = getScenarioLocation(scenario);
  if (!location) throw new Error("The fixture must resolve its base location");
  loadSimData(location);
  const world = createWorld(
    { scenarioId: 999, difficulty: "Employee", customScenario: scenario },
    coopSeats(2),
    "timeline",
    "epoch",
  );
  const command = (id: string, command: Command) =>
    applyCommand(world, id, {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence: (world.sequences[id] ?? 0) + 1,
      command,
    });
  expect(command("0", { kind: "ready" })).toBeUndefined();
  expect(command("1", { kind: "ready" })).toBeUndefined();
  expect(command("0", { kind: "rate", value: 0.05 })).toBeUndefined();
  for (let tick = 0; tick < TICKS_PER_MONTH * 2 && !world.outcomes["1"]; tick++)
    stepWorld(world);
  expect(world.outcomes["1"]).toMatchObject({ outcome: "fired", month: 1 });
  expect(world.outcomes["0"]).toBeUndefined();
  const active = roomView(world, "0").game!;
  const retired = roomView(world, "1").game!;
  expect(
    retired.multiplayer!.clock!.players.map((player) => player.id),
  ).not.toContain("1");
  expect(
    retired.multiplayer!.results!.find((result) => result.id === "1")?.name,
  ).toBe("Player 1");
  const props = { events: [], onOpen: jest.fn(), onSelect: jest.fn() };
  const view = render(<EventLog {...props} game={active} />);
  expect(screen.getByText("Events for Player 0.")).toBeVisible();
  view.rerender(<EventLog {...props} game={retired} />);
  expect(screen.getByText("Events for Player 1.")).toBeVisible();
  view.rerender(
    <EventLog {...props} game={{ ...retired, multiplayer: undefined }} />,
  );
  expect(screen.queryByText(/^Events for /)).toBeNull();
});
