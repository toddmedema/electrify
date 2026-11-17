import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { configureStore, createAction } from "@reduxjs/toolkit";
import { Provider, useSelector } from "react-redux";
import ProjectBuild from "./ProjectBuild";
import { TerritoryTilePurchasesProvider } from "./TerritoryTilePurchases";
import { createGame } from "../../testing/Simulator";
import { currentTick } from "../../helpers/GameSelectors";
import { formatWatts, formatWattHours } from "../../helpers/Format";
import {
  projectCatalogue,
  type ProjectSelection,
} from "../../helpers/ProjectBuild";
import {
  getTerritoryTile,
  ownsTerritoryTile,
} from "../../helpers/TerritoryTiles";
import { tilePurchaseQuotes } from "../../helpers/Territories";
import { registerMultiplayerRuntime } from "../../multiplayer/Registry";
import { acquireTile } from "../../reducers/GameActions";
import gameReducer, { buildFacility } from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import type { GameType, TerritoryTileId } from "../../Types";
import type { Command } from "../../multiplayer/Types";

jest.mock("./BuildForecast", () => ({ useBuildForecast: () => undefined }));
const replace = createAction<GameType>("test/replace");
afterEach(() => {
  registerMultiplayerRuntime(undefined);
});
function show(multiplayer = false, year?: number, compatibleSites = 2) {
  const game = createGame({ scenarioId: 116, seed: 188 });
  currentTick(game)!.cash = 1e9;
  if (year) {
    game.startingYear = year;
    game.date.year = year;
  }
  if (multiplayer) game.multiplayer = { seat: "0" };
  const store = configureStore({
    reducer: {
      game: (
        state: GameType = game,
        action: Parameters<typeof gameReducer>[1],
      ) =>
        replace.match(action) ? action.payload : gameReducer(state, action),
      ui: uiReducer,
    },
    preloadedState: { game },
    middleware: (defaults) =>
      defaults({ serializableCheck: false, immutableCheck: false }),
  });
  const close = jest.fn();
  const onSelection = jest.fn();
  function Workspace() {
    const current = useSelector((state: { game: GameType }) => state.game);
    const [project, setProject] = React.useState<ProjectSelection>();
    const [candidate, setCandidate] = React.useState<TerritoryTileId>();
    const [catalogue, setCatalogue] = React.useState(true);
    return (
      <TerritoryTilePurchasesProvider game={current}>
        <button onClick={() => setCandidate("champlain:site-13")}>
          Owned site
        </button>
        <button onClick={() => setCandidate("green-uplands:site-1")}>
          Adjacent site
        </button>
        <button
          onClick={() =>
            setCandidate(
              [...tilePurchaseQuotes(current).keys()].find((id) => {
                const tile = getTerritoryTile(id)!;
                return (
                  tile.terrain === "mountain" && tile.siteKind === "general"
                );
              }),
            )
          }
        >
          Ridge site
        </button>
        <ProjectBuild
          game={current}
          project={project}
          candidate={candidate}
          compatibleSites={compatibleSites}
          catalogue={catalogue}
          onProject={(selection) => {
            onSelection(selection);
            setProject(selection);
            setCatalogue(false);
          }}
          onChangeProject={() => setCatalogue(true)}
          onClose={close}
          onBusy={() => undefined}
        />
      </TerritoryTilePurchasesProvider>
    );
  }
  render(
    <Provider store={store}>
      <Workspace />
    </Provider>,
  );
  const choose = () => {
    fireEvent.change(
      screen.getByRole("slider", { name: "Generator capacity" }),
      { target: { value: "10" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Choose sites for Wind" }),
    );
  };
  const adjacent = () => {
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Adjacent site" }));
    fireEvent.click(screen.getByRole("button", { name: "Review project" }));
  };
  return { game, store, close, choose, adjacent, onSelection };
}
function runtime(submit: (command: Command) => Promise<void>) {
  registerMultiplayerRuntime({
    submit,
    command: jest.fn(),
    activity: jest.fn(),
    leave: async () => undefined,
  });
}

it("explores two sites with the selected size and spends only after explicit review confirmation", async () => {
  const { store, choose, close, game } = show();
  const cash = currentTick(game)!.cash;
  choose();
  fireEvent.click(screen.getByRole("button", { name: "Adjacent site" }));
  expect(screen.getByText("Estimated online")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Wind · 20MW" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Owned site" }));
  expect(screen.getByRole("heading", { name: "Wind · 20MW" })).toBeVisible();
  expect(currentTick(store.getState().game)!.cash).toBe(cash);
  fireEvent.click(screen.getByRole("button", { name: "Review project" }));
  expect(store.getState().game.facilities).toHaveLength(game.facilities.length);
  fireEvent.click(screen.getByRole("button", { name: "Build project" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(
    store
      .getState()
      .game.facilities.find(
        (facility) => facility.tileId === "champlain:site-13",
      ),
  ).toMatchObject({ name: "Wind", peakW: 20e6 });
});
it("requires another review after cash changes and never submits the stale connection", () => {
  const { store, adjacent } = show();
  adjacent();
  const newer = JSON.parse(JSON.stringify(store.getState().game)) as GameType;
  currentTick(newer)!.cash -= 1;
  act(() => {
    store.dispatch(replace(newer));
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect & build" }));
  expect(
    screen.getByText("Project changed. Review the updated details."),
  ).toBeVisible();
  expect(ownsTerritoryTile(store.getState().game, "green-uplands:site-1")).toBe(
    false,
  );
  expect(screen.getByRole("button", { name: "Review project" })).toBeEnabled();
});
it("locks repeated confirmation and waits for host ownership before building", async () => {
  const { store, adjacent, close, game } = show(true);
  const commands: Command[] = [];
  runtime(async (command) => {
    commands.push(command);
    if (command.kind === "action" && command.name === "buildFacility")
      store.dispatch(
        buildFacility(command.payload as Parameters<typeof buildFacility>[0]),
      );
  });
  adjacent();
  const confirm = screen.getByRole("button", { name: "Connect & build" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await act(async () => {
    await Promise.resolve();
  });
  expect(commands).toHaveLength(1);
  expect(store.getState().game.facilities).toHaveLength(game.facilities.length);
  const connect = commands[0];
  if (connect.kind !== "action" || connect.name !== "acquireTile")
    throw new Error("Expected connection command");
  act(() => {
    store.dispatch(
      acquireTile(connect.payload as Parameters<typeof acquireTile>[0]),
    );
  });
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(commands).toHaveLength(2);
  expect(
    store
      .getState()
      .game.facilities.find(
        (facility) => facility.tileId === "green-uplands:site-1",
      ),
  ).toMatchObject({ name: "Wind", peakW: 20e6 });
});
it("preserves partial success and retries the build without charging another connection", async () => {
  const { store, adjacent, close, game } = show(true);
  let rejectBuild = true;
  const commands: Command[] = [];
  runtime(async (command) => {
    commands.push(command);
    if (command.kind !== "action") return;
    if (command.name === "acquireTile")
      store.dispatch(
        acquireTile(command.payload as Parameters<typeof acquireTile>[0]),
      );
    if (command.name === "buildFacility") {
      if (rejectBuild) throw new Error("Host rejected construction.");
      store.dispatch(
        buildFacility(command.payload as Parameters<typeof buildFacility>[0]),
      );
    }
  });
  adjacent();
  fireEvent.click(screen.getByRole("button", { name: "Connect & build" }));
  await waitFor(() =>
    expect(
      screen.getByText(/Site connected. Construction did not start/),
    ).toBeVisible(),
  );
  expect(ownsTerritoryTile(store.getState().game, "green-uplands:site-1")).toBe(
    true,
  );
  expect(store.getState().game.facilities).toHaveLength(game.facilities.length);
  fireEvent.click(screen.getByRole("button", { name: "Review build" }));
  rejectBuild = false;
  fireEvent.click(screen.getByRole("button", { name: "Build project" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(
    commands.filter(
      (command) => command.kind === "action" && command.name === "acquireTile",
    ),
  ).toHaveLength(1);
  expect(store.getState().game.territoryNetwork!.tilePurchases).toHaveLength(1);
});
it("keeps a rejected connection unowned with the project available for review", async () => {
  const { store, adjacent } = show(true);
  runtime(async () => {
    throw new Error("Another utility claimed this site.");
  });
  adjacent();
  fireEvent.click(screen.getByRole("button", { name: "Connect & build" }));
  await waitFor(() =>
    expect(
      screen.getByText("Another utility claimed this site."),
    ).toBeVisible(),
  );
  expect(ownsTerritoryTile(store.getState().game, "green-uplands:site-1")).toBe(
    false,
  );
  expect(screen.getByRole("heading", { name: "Wind · 20MW" })).toBeVisible();
});
it("shows a combined cash shortfall and charging requirements for storage", () => {
  const { store } = show(false, 2031);
  fireEvent.click(screen.getByRole("tab", { name: "Storage" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Choose sites for Battery" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Owned site" }));
  expect(screen.getByText(/requires charging/)).toBeVisible();
  const newer = JSON.parse(JSON.stringify(store.getState().game)) as GameType;
  currentTick(newer)!.cash = 0;
  act(() => {
    store.dispatch(replace(newer));
  });
  expect(screen.getByText(/more cash needed/)).toBeVisible();
  expect(projectCatalogue(newer, 20e6, false)).not.toHaveLength(0);
});

it("cancels the pending project continuation when the run changes", async () => {
  const { store, adjacent, game } = show(true);
  const commands: Command[] = [];
  runtime(async (command) => {
    commands.push(command);
  });
  adjacent();
  fireEvent.click(screen.getByRole("button", { name: "Connect & build" }));
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    store.dispatch(replace({ ...store.getState().game, seed: game.seed + 1 }));
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Connecting…" }),
    ).not.toBeInTheDocument(),
  );
  expect(commands).toHaveLength(1);
  expect(store.getState().game.facilities).toHaveLength(game.facilities.length);
});

it("corrects an oversized technology to the map's terrain maximum before choosing sites", () => {
  const { store, game } = show();
  fireEvent.change(screen.getByRole("slider", { name: "Generator capacity" }), {
    target: { value: "34" },
  });
  const choose = screen.getByRole("button", {
    name: "Choose 450MW sites for Wind",
  });
  expect(screen.getByText("Maximum available size: 450MW")).toBeVisible();
  fireEvent.click(choose);
  fireEvent.click(screen.getByRole("button", { name: "Owned site" }));
  expect(screen.getByRole("heading", { name: "Wind · 450MW" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Review project" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    /project size.*compatible site/,
  );
  fireEvent.click(screen.getByRole("button", { name: "Ridge site" }));
  expect(screen.getByRole("button", { name: "Review project" })).toBeEnabled();
  expect(currentTick(store.getState().game)!.cash).toBe(
    currentTick(game)!.cash,
  );
  expect(store.getState().game.territoryNetwork!.tilePurchases).toHaveLength(0);
});

it("explains a project with no compatible sites and keeps Change project available", () => {
  const { choose, store, game } = show(false, undefined, 0);
  choose();
  expect(
    screen.getByText(/No compatible connected or adjacent sites/),
  ).toBeVisible();
  expect(
    screen.queryByText("Choose a highlighted site."),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Change project" }));
  expect(
    screen.getByRole("slider", { name: "Generator capacity" }),
  ).toBeVisible();
  expect(currentTick(store.getState().game)!.cash).toBe(
    currentTick(game)!.cash,
  );
});

it("chooses the exact storage technology limit without requiring affordable cash", () => {
  const { game, store, onSelection } = show(false, 2031);
  fireEvent.click(screen.getByRole("tab", { name: "Storage" }));
  fireEvent.change(screen.getByRole("slider", { name: "Storage capacity" }), {
    target: { value: "37" },
  });
  const battery = projectCatalogue(game, 20e9, true).find(
    ({ name }) => name === "Battery",
  )!;
  const limit = battery.maxPeakWh!;
  const label = formatWattHours(limit);
  const newer = JSON.parse(JSON.stringify(store.getState().game)) as GameType;
  currentTick(newer)!.cash = 0;
  act(() => {
    store.dispatch(replace(newer));
  });
  fireEvent.click(
    screen.getByRole("button", { name: `Choose ${label} sites for Battery` }),
  );
  expect(onSelection).toHaveBeenLastCalledWith(
    expect.objectContaining({ peakWh: limit }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Owned site" }));
  expect(
    screen.getByRole("heading", {
      name: `Battery · ${formatWatts(limit / 4)}`,
    }),
  ).toBeVisible();
  expect(screen.getByText(/more cash needed/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Review project" })).toBeEnabled();
  expect(currentTick(store.getState().game)!.cash).toBe(0);
});
