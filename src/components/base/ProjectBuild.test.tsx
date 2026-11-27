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
import { formatWatts } from "../../helpers/Format";
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
import gameReducer, { buildFacility } from "../../reducers/Game";
import cardReducer from "../../reducers/Card";
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
      card: cardReducer,
      ui: uiReducer,
    },
    preloadedState: { game },
    middleware: (defaults) =>
      defaults({ serializableCheck: false, immutableCheck: false }),
  });
  const close = jest.fn();
  const onConnectedBuild = jest.fn();
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
          onClose={close}
          onConnectedBuild={onConnectedBuild}
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
    fireEvent.click(screen.getByRole("button", { name: "Pick site for Wind" }));
  };
  const adjacent = () => {
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Adjacent site" }));
  };
  return {
    game,
    store,
    close,
    choose,
    adjacent,
    onSelection,
    onConnectedBuild,
  };
}
function runtime(submit: (command: Command) => Promise<void>) {
  registerMultiplayerRuntime({
    submit,
    command: jest.fn(),
    activity: jest.fn(),
    leave: async () => undefined,
  });
}

it("explores two sites with the selected size and spends with one cash action after selecting a site", async () => {
  const { store, choose, close, game } = show();
  const cash = currentTick(game)!.cash;
  expect(screen.getByRole("heading", { name: "Build" })).toBeVisible();
  choose();
  fireEvent.click(screen.getByRole("button", { name: "Adjacent site" }));
  expect(screen.getByText("Total project cost")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Wind · 20MW" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Owned site" }));
  expect(screen.getByRole("heading", { name: "Wind · 20MW" })).toBeVisible();
  expect(currentTick(store.getState().game)!.cash).toBe(cash);
  expect(store.getState().game.facilities).toHaveLength(game.facilities.length);
  fireEvent.click(screen.getByRole("button", { name: "Cash" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(
    store
      .getState()
      .game.facilities.find(
        (facility) => facility.tileId === "champlain:site-13",
      ),
  ).toMatchObject({ name: "Wind", peakW: 20e6 });
});
it("rejects a payment when cash changed after the displayed quote", () => {
  const { store, choose } = show();
  choose();
  fireEvent.click(screen.getByRole("button", { name: "Owned site" }));
  const newer = JSON.parse(JSON.stringify(store.getState().game)) as GameType;
  currentTick(newer)!.cash -= 1;
  const pay = screen.getByRole("button", { name: "Cash" });
  // Click while React is still showing the preceding store snapshot.
  act(() => {
    store.dispatch(replace(newer));
    pay.click();
  });
  expect(
    screen.getByText("Project changed. Check the updated costs before paying."),
  ).toBeVisible();
  expect(ownsTerritoryTile(store.getState().game, "green-uplands:site-1")).toBe(
    false,
  );
  expect(screen.getByRole("button", { name: "Cash" })).toBeEnabled();
});
it("locks repeated confirmation and starts both jobs with one host command", async () => {
  const { store, adjacent, onConnectedBuild, game } = show(true);
  const commands: Command[] = [];
  runtime(async (command) => {
    commands.push(command);
    if (command.kind === "action" && command.name === "buildFacility")
      store.dispatch(
        buildFacility(command.payload as Parameters<typeof buildFacility>[0]),
      );
  });
  adjacent();
  const confirm = screen.getByRole("button", { name: /^Connect & build ·/ });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(onConnectedBuild).toHaveBeenCalledTimes(1));
  expect(commands).toHaveLength(1);
  const current = store.getState().game;
  expect(current.facilities).toHaveLength(game.facilities.length + 1);
  expect(
    current.facilities.find(({ tileId }) => tileId === "green-uplands:site-1"),
  ).toMatchObject({
    name: "Wind",
    peakW: 20e6,
    minuteCreated: game.date.minute,
  });
  expect(current.territoryNetwork?.tilePurchases).toEqual([
    expect.objectContaining({
      tileId: "green-uplands:site-1",
      minute: game.date.minute,
    }),
  ]);
});
it("keeps a rejected connection unowned with the project available for review", async () => {
  const { store, adjacent } = show(true);
  runtime(async () => {
    throw new Error("Another utility claimed this site.");
  });
  adjacent();
  fireEvent.click(screen.getByRole("button", { name: /^Connect & build ·/ }));
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
it("shows a construction cash shortfall and charging requirements for storage", () => {
  const { store } = show(false, 2031);
  fireEvent.click(screen.getByRole("tab", { name: "Storage" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Pick site for Lithium Battery" }),
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
  let complete!: () => void;
  runtime(async (command) => {
    commands.push(command);
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
  });
  adjacent();
  fireEvent.click(screen.getByRole("button", { name: /^Connect & build ·/ }));
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    store.dispatch(replace({ ...store.getState().game, seed: game.seed + 1 }));
    complete();
  });
  await waitFor(() =>
    expect(
      screen.queryByText("Starting construction…"),
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
  const choose = screen.getByRole("button", { name: "Pick site for Wind" });
  expect(choose).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Use max size for Wind" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Pick site for Wind" }));
  fireEvent.click(screen.getByRole("button", { name: "Owned site" }));
  expect(screen.getByRole("heading", { name: "Wind · 450MW" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Cash" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("No sites available");
  fireEvent.click(screen.getByRole("button", { name: "Ridge site" }));
  expect(
    screen.getByRole("button", { name: /^Connect & build ·/ }),
  ).toBeEnabled();
  expect(currentTick(store.getState().game)!.cash).toBe(
    currentTick(game)!.cash,
  );
  expect(store.getState().game.territoryNetwork!.tilePurchases).toHaveLength(0);
});

it("explains a project with no compatible sites", () => {
  const { choose, store, game } = show(false, undefined, 0);
  choose();
  expect(
    screen.getByText(/No compatible connected or adjacent sites/),
  ).toBeVisible();
  expect(
    screen.queryByText("Choose a highlighted site."),
  ).not.toBeInTheDocument();
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
  const newer = JSON.parse(JSON.stringify(store.getState().game)) as GameType;
  currentTick(newer)!.cash = 0;
  act(() => {
    store.dispatch(replace(newer));
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Use max size for Lithium Battery" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Pick site for Lithium Battery" }),
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
  expect(screen.getByRole("button", { name: "Cash" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Loan" })).toBeDisabled();
  expect(currentTick(store.getState().game)!.cash).toBe(0);
});
