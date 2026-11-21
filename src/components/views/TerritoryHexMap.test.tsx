import * as React from "react";
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { useAppSelector } from "../../Store";
import { createGame } from "../../testing/Simulator";
import reducer, { delta } from "../../reducers/Game";
import { acquireTile } from "../../reducers/GameActions";
import { currentTick } from "../../helpers/GameSelectors";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { tilePurchaseQuote } from "../../helpers/Territories";
import {
  territoryTileViews,
  type TerritoryMapTileKey,
} from "../../helpers/TerritoryMapState";
import { ownsTerritoryTile } from "../../helpers/TerritoryTiles";
import { registerMultiplayerRuntime } from "../../multiplayer/Registry";
import type { TerritoryTileId } from "../../Types";
import {
  TerritoryTilePurchasesProvider,
  useTerritoryTilePurchases,
} from "../base/TerritoryTilePurchases";
import TerritoryHexMap from "./TerritoryHexMap";
import { hexCenter } from "../base/TerritoryHexGeometry";
import * as HexGeometry from "../base/TerritoryHexGeometry";
import type { ScenePicker } from "../base/territory-3d/SceneBuilder";
import type { RendererState } from "../base/territory-3d/TerritoryCanvas3D";
import {
  projectCatalogue,
  projectSiteQuote,
  projectSiteCapitalCost,
  selectProject,
} from "../../helpers/ProjectBuild";
import type { ReadyProjectSite } from "../../helpers/ProjectBuild";
import { formatPurchasePrice } from "../../helpers/Format";

const mockPick = jest.fn();
let mockSceneError = false;
jest.mock("../base/territory-3d/TerritoryScene3D", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: function MockScene({
      onState,
      onPicker,
    }: {
      onState: (state: RendererState) => void;
      onPicker: (picker: ScenePicker | undefined) => void;
    }) {
      React.useEffect(() => {
        onPicker(mockPick);
        onState("ready");
        return () => onPicker(undefined);
      }, [onPicker, onState]);
      if (mockSceneError) throw new Error("3D chunk unavailable");
      return <div data-testid="map-scene" />;
    },
  };
});

it("releases arrow navigation to surrounding controls at the known map boundary", () => {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const north = territoryTileViews(game)
    .map(({ tile }) => tile)
    .sort((a, b) => hexCenter(a).y - hexCenter(b).y)[0];
  const map = show(1e9, false, north.id);
  const target = map.target(north.id);
  const event = createEvent.keyDown(target, {
    key: "ArrowUp",
    bubbles: true,
    cancelable: true,
  });
  fireEvent(target, event);
  expect(event.defaultPrevented).toBe(false);
});

// jsdom has no PointerEvent; preserve the identity and coordinates used by map panning.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}
const originalPointerEvent = window.PointerEvent;
beforeAll(() => {
  window.PointerEvent = TestPointerEvent as typeof PointerEvent;
});
afterAll(() => {
  window.PointerEvent = originalPointerEvent;
});
beforeEach(() => {
  jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
});
afterEach(() => {
  registerMultiplayerRuntime(undefined);
  jest.restoreAllMocks();
  mockPick.mockReset();
  mockSceneError = false;
});

function show(
  cash = 1e9,
  inspectionInitiallyOpen = false,
  initialSelected: TerritoryTileId = "champlain:city",
  projectSites?: ReadonlyMap<TerritoryTileId, ReadyProjectSite>,
  projectPending = false,
) {
  const game = createGame({ scenarioId: 116, seed: 188 });
  currentTick(game)!.cash = cash;
  const store = configureStore({
    reducer: {
      game: reducer,
      ui: (
        state: { evidenceRunId: number } = { evidenceRunId: 1 },
        action: { type: string },
      ) =>
        action.type === "test/load"
          ? { evidenceRunId: state.evidenceRunId + 1 }
          : state,
    },
    preloadedState: { game, ui: { evidenceRunId: 1 } },
  });
  const onSelect = jest.fn();
  const onTileMenu = jest.fn();
  const closeInspection = jest.fn();
  function OtherPurchaseControl() {
    const { purchase, pendingCost } = useTerritoryTilePurchases();
    return (
      <button onClick={() => void purchase(otherTile!)} data-testid="other-buy">
        Surface buy · committed {pendingCost}
      </button>
    );
  }
  let otherTile: TerritoryTileId | undefined;
  function Workspace() {
    const activeGame = useAppSelector((state) => state.game);
    const [inspectionOpen, setInspectionOpen] = React.useState(
      inspectionInitiallyOpen,
    );
    const [selected, select] = React.useState<TerritoryMapTileKey | undefined>(
      initialSelected,
    );
    return (
      <TerritoryTilePurchasesProvider game={activeGame}>
        <OtherPurchaseControl />
        <TerritoryHexMap
          game={activeGame}
          views={territoryTileViews(activeGame)}
          projectPlanning={!!projectSites}
          projectPending={projectPending}
          projectSites={projectSites}
          projectWindOutput={projectSites && { forest: 0.8, mountain: 1.29 }}
          selected={selected}
          onCloseInspection={
            inspectionOpen
              ? () => {
                  closeInspection();
                  setInspectionOpen(false);
                }
              : undefined
          }
          onDeselect={() => select(undefined)}
          onTileMenu={onTileMenu}
          onSelect={(id, activate) => {
            select(id);
            onSelect(id, activate);
          }}
        />
      </TerritoryTilePurchasesProvider>
    );
  }
  const utils = render(
    <Provider store={store}>
      <Workspace />
    </Provider>,
  );
  const viewport = screen.getByRole("region", { name: "Territory map" });
  // jsdom cannot compute layout. Read the camera transform to recover tile positions.
  // eslint-disable-next-line testing-library/no-node-access
  const stage = viewport.querySelector<HTMLElement>(".territoryMapStage")!;
  const target = (id: TerritoryTileId) =>
    screen
      .getAllByRole<HTMLButtonElement>("button")
      .find((button) => button.dataset.mapTarget === id)!;
  const candidates = () =>
    screen
      .getAllByRole<HTMLButtonElement>("button")
      .filter((button) => button.dataset.purchasable === "true");
  const buyMode = () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Rapid connection mode" }),
    );
  return {
    ...utils,
    store,
    stage,
    viewport,
    target,
    candidates,
    buyMode,
    onSelect,
    onTileMenu,
    closeInspection,
    setOtherTile: (id: TerritoryTileId) => {
      otherTile = id;
    },
  };
}
function idOf(button: HTMLButtonElement) {
  return button.dataset.mapTarget as TerritoryTileId;
}
function hoverColor(button: HTMLButtonElement) {
  return button.style.getPropertyValue("--territory-hover-color");
}
it("pans with the middle button without connecting or selecting a tile", () => {
  const map = show();
  map.buyMode();
  const tile = map.candidates()[0];
  const { stage } = map;
  const transform = stage.style.transform;
  const left = tile.style.left;
  const top = tile.style.top;
  fireEvent.pointerDown(tile, {
    button: 1,
    pointerId: 1,
    clientX: 100,
    clientY: 100,
  });
  fireEvent.pointerMove(tile, {
    buttons: 4,
    pointerId: 1,
    clientX: 130,
    clientY: 120,
  });
  fireEvent.pointerUp(tile, {
    button: 1,
    pointerId: 1,
    clientX: 130,
    clientY: 120,
  });
  expect(stage.style.transform).not.toBe(transform);
  expect(tile.style.left).toBe(left);
  expect(tile.style.top).toBe(top);
  expect(map.onSelect).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Build" }),
  ).not.toBeInTheDocument();
  expect(map.store.getState().game.territoryNetwork!.tilePurchases).toEqual([]);
});

it("explains and colors physical building eligibility without guessing from terrain", () => {
  const map = show();
  const vacant = map.target("champlain:site-13"),
    occupied = territoryTileViews(map.store.getState().game).find(
      (view) => view.operatingFacility,
    )!;
  expect(hoverColor(vacant)).toBe("var(--interactive-blue)");
  expect(vacant).toHaveAccessibleDescription("Plains");
  expect(hoverColor(map.target("champlain:city"))).toBe("var(--blackout-red)");
  const capital = map.target("champlain:city");
  expect(capital).toHaveAccessibleName("Inspect You territory · Burlington");
  expect(capital).not.toHaveAccessibleDescription();
  expect(capital).toHaveAttribute("data-tooltip", "Burlington");
  expect(hoverColor(map.target(occupied.tile.id))).toBe("var(--blackout-red)");
  expect(map.target(occupied.tile.id)).toHaveAccessibleDescription(
    new RegExp(occupied.facility!.name),
  );
  expect(hoverColor(map.target("champlain:site-14"))).toBe(
    "var(--blackout-red)",
  );
  expect(map.target("champlain:site-14")).toHaveAccessibleDescription(
    /No compatible technology/,
  );
  expect(hoverColor(map.target("green-uplands:site-0"))).toBe(
    "var(--interactive-blue)",
  );
  expect(map.target("green-uplands:site-0")).toHaveAccessibleDescription(
    /Unconnected/,
  );
});

function readySites(...ids: TerritoryTileId[]) {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const facility = projectCatalogue(game, 20e6, false).find(
    (option) => option.name === "Solar",
  )!;
  return new Map(
    ids.map((id) => {
      const quote = projectSiteQuote(game, selectProject(facility), id);
      if (!quote.facility) throw new Error(`Invalid test site ${id}`);
      return [id, quote] as const;
    }),
  );
}

it("uses project candidates for construction and connection quotes for Rapid eligibility", () => {
  const sites = readySites("champlain:site-13", "green-uplands:site-0");
  const project = show(1e9, false, "champlain:city", sites);
  expect(hoverColor(project.target("champlain:site-13"))).toBe(
    "var(--interactive-blue)",
  );
  expect(hoverColor(project.target("green-uplands:site-0"))).toBe(
    "var(--interactive-blue)",
  );
  expect(hoverColor(project.target("champlain:site-12"))).toBe(
    "var(--blackout-red)",
  );
  expect(project.target("champlain:site-12")).toHaveAccessibleDescription(
    /Unavailable for this project/,
  );
  project.unmount();

  const rapid = show();
  rapid.buyMode();
  expect(hoverColor(rapid.target("green-uplands:site-0"))).toBe(
    "var(--interactive-blue)",
  );
  expect(hoverColor(rapid.target("champlain:site-13"))).toBe(
    "var(--blackout-red)",
  );
  expect(rapid.target("champlain:site-13")).toHaveAccessibleDescription(
    /^Plains/,
  );
  expect(
    rapid.store.getState().game.territoryNetwork!.tilePurchases,
  ).toHaveLength(0);
});

it("keeps foreign company hover colors ahead of project eligibility", () => {
  const map = show(1e9, false, "champlain:city", new Map());
  expect(hoverColor(map.target("valley-electric:city"))).toBe(
    "var(--territory-owner-valley)",
  );
  expect(hoverColor(map.target("ridge-electric:city"))).toBe(
    "var(--territory-owner-ridge)",
  );
  act(() => {
    map.store.dispatch(
      delta({
        multiplayer: {
          seat: "0",
          tileOwners: {
            "green-uplands:site-2": { seat: "1", name: "Birch Utility" },
            "green-uplands:site-3": { seat: "2", name: "Cedar Utility" },
          },
        },
      }),
    );
  });
  expect(hoverColor(map.target("green-uplands:site-2"))).toBe(
    "var(--territory-owner-peer-0)",
  );
  expect(hoverColor(map.target("green-uplands:site-3"))).toBe(
    "var(--territory-owner-peer-1)",
  );
  expect(map.target("green-uplands:site-2")).toHaveAccessibleDescription(
    / · Birch Utility/,
  );
});

it("shows full terrain-specific capital costs on owned and unconnected project markers without spending", async () => {
  const restore = enable3D();
  try {
    const sites = readySites("champlain:site-13", "green-uplands:site-0");
    const map = show(1e9, false, "champlain:city", sites);
    await screen.findByTestId("map-scene");
    for (const [id, quote] of sites) {
      const target = map.target(id);
      const price = formatPurchasePrice(projectSiteCapitalCost(quote));
      const title = `Total project cost ${price} · ${quote.owned ? "Already connected" : "Connection included"}`;
      expect(target).toHaveAccessibleName(expect.stringContaining(title));
      act(() => target.focus());
      expect(screen.getByRole("tooltip")).toHaveTextContent(title);
      act(() => target.blur());
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      const marker = within(target).getByText(price, { exact: true });
      expect(marker).toHaveTextContent(price);
      expect(marker).not.toHaveTextContent(/^\$0$/);
      fireEvent.pointerMove(marker, {
        pointerId: 1,
        clientX: 100,
        clientY: 100,
      });
      await waitFor(() =>
        expect(screen.getByRole("tooltip")).toHaveTextContent(title),
      );
    }
    expect(map.store.getState().game.territoryNetwork!.tilePurchases).toEqual(
      [],
    );
  } finally {
    restore();
  }
});
function tileCenter(tile: HTMLButtonElement, stage: HTMLElement) {
  const transform = stage.style.transform;
  const [x, y] = transform
    .slice("translate(".length)
    .split(", ")
    .map(Number.parseFloat);
  // CSS puts the stage origin at the viewport center, which jsdom does not lay out.
  const { clientWidth, clientHeight } = screen.getByRole("region", {
    name: "Territory map",
  });
  return {
    x: clientWidth / 2 + x + Number.parseFloat(tile.style.left),
    y: clientHeight / 2 + y + Number.parseFloat(tile.style.top),
  };
}
function fullyVisible(
  tile: HTMLButtonElement,
  stage: HTMLElement,
  width: number,
  height = 900,
) {
  const { x, y } = tileCenter(tile, stage);
  const halfWidth = Number.parseFloat(tile.style.width) / 2,
    halfHeight = Number.parseFloat(tile.style.height) / 2;
  return (
    x - halfWidth >= 0 &&
    x + halfWidth <= width &&
    y - halfHeight >= 0 &&
    y + halfHeight <= height
  );
}
function tap(button: HTMLButtonElement) {
  fireEvent.pointerDown(button, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(button, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.click(button, { detail: 1 });
}
function fakeHost() {
  let complete!: () => void;
  let reject!: (error: Error) => void;
  const submit = jest.fn(
    () =>
      new Promise<void>((resolve, fail) => {
        complete = resolve;
        reject = fail;
      }),
  );
  registerMultiplayerRuntime({
    submit,
    command: jest.fn(),
    activity: jest.fn(),
    leave: async () => undefined,
  });
  return {
    submit,
    complete: () => complete(),
    reject: () => reject(new Error("Another utility claimed this tile.")),
  };
}

it.each([1280, 360])(
  "inspects normally, then buys exactly one physical tile without shifting the camera or leaving buying mode at %ipx",
  (width) => {
    jest
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(width);
    const map = show();
    map.buyMode();
    const candidate = map
      .candidates()
      .find(
        (button) =>
          territoryTileViews(map.store.getState().game).find(
            ({ tile }) => tile.id === idOf(button),
          )?.visibilityDistance === 1,
      )!;
    const id = idOf(candidate);
    fireEvent.click(
      screen.getByRole("button", { name: "Rapid connection mode" }),
    );
    tap(candidate);
    expect(map.onSelect).toHaveBeenLastCalledWith(id, true);
    expect(ownsTerritoryTile(map.store.getState().game, id)).toBe(false);
    map.buyMode();
    const initialCount = territoryTileViews(map.store.getState().game).length;
    const position = { left: candidate.style.left, top: candidate.style.top };
    const camera = map.stage.style.transform;
    tap(candidate);
    expect(ownsTerritoryTile(map.store.getState().game, id)).toBe(true);
    expect(
      map.store.getState().game.territoryNetwork!.tilePurchases,
    ).toHaveLength(1);
    expect(map.target(id)).toHaveAttribute("aria-pressed", "true");
    expect(map.target(id).style.left).toBe(position.left);
    expect(map.target(id).style.top).toBe(position.top);
    expect(map.stage.style.transform).toBe(camera);
    expect(territoryTileViews(map.store.getState().game).length).toBe(
      initialCount,
    );
    expect(
      screen.getByRole("button", { name: "Rapid connection mode" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("status", { name: "Connection result" }),
    ).toHaveTextContent("Site connected");
  },
);

it("describes unconnected land and peer claims without repeating local ownership", () => {
  const map = show();
  map.buyMode();
  tap(map.target("green-uplands:site-0"));
  expect(map.target("green-uplands:site-0")).toHaveAccessibleDescription(
    /^Plains/,
  );
  expect(map.target("green-uplands:site-1")).toHaveAccessibleDescription(
    /Unconnected/,
  );
  act(() => {
    map.store.dispatch(
      delta({
        multiplayer: {
          seat: "0",
          tileOwners: {
            "green-uplands:site-2": { seat: "1", name: "Birch Utility" },
          },
        },
      }),
    );
  });
  expect(map.target("green-uplands:site-2")).toHaveAccessibleDescription(
    / · Birch Utility/,
  );
  expect(map.target("green-uplands:site-1")).toHaveAccessibleDescription(
    /Unconnected/,
  );
});

it("refreshes a stationary pointer tooltip after a peer claims its tile", async () => {
  const map = show();
  const tile = map.target("green-uplands:site-2");
  fireEvent.pointerMove(tile, { pointerId: 1, clientX: 100, clientY: 100 });
  await waitFor(() =>
    expect(screen.getByRole("tooltip")).toHaveTextContent(/Unconnected/),
  );
  act(() => {
    map.store.dispatch(
      delta({
        multiplayer: {
          seat: "0",
          tileOwners: {
            "green-uplands:site-2": { seat: "1", name: "Birch Utility" },
          },
        },
      }),
    );
  });
  expect(tile).toHaveAccessibleDescription(/ · Birch Utility/);
  expect(screen.getByRole("tooltip")).toHaveTextContent(/ · Birch Utility/);
  expect(screen.getByRole("tooltip")).not.toHaveTextContent(/Unconnected/);
});

it("shows the tile status tooltip on keyboard focus and dismisses it on blur", () => {
  const map = show();
  const tile = map.target("green-uplands:site-2");
  act(() => tile.focus());
  expect(tile).toHaveFocus();
  expect(screen.getByRole("tooltip")).toHaveTextContent(/Unconnected/);
  expect(tile).toHaveAccessibleDescription(
    screen.getByRole("tooltip").textContent!,
  );
  act(() =>
    screen.getByRole("button", { name: "Rapid connection mode" }).focus(),
  );
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  expect(
    map.store.getState().game.territoryNetwork!.tilePurchases,
  ).toHaveLength(0);
});

it.each([360, 390])(
  "initially shows useful owned land while keeping the capital visible at %ipx",
  (width) => {
    jest
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(width);
    const map = show();
    const owned = screen
      .getAllByRole<HTMLButtonElement>("button")
      .filter((tile) => tile.dataset.owned === "true");
    expect(
      owned.filter((tile) => fullyVisible(tile, map.stage, width)).length,
    ).toBeGreaterThanOrEqual(8);
    const capital = map.target("champlain:city");
    expect(fullyVisible(capital, map.stage, width)).toBe(true);
    // Keep a full cell from the edge to its center, including the city artwork.
    expect(tileCenter(capital, map.stage).x).toBeGreaterThanOrEqual(
      Number.parseFloat(capital.style.width),
    );
    expect(Number.parseFloat(capital.style.width)).toBe(96);
  },
);

it("initially shows the owned land and named utilities on desktop", () => {
  const map = show();
  const owned = screen
    .getAllByRole<HTMLButtonElement>("button")
    .filter((tile) => tile.dataset.owned === "true");
  expect(
    owned.filter((tile) => fullyVisible(tile, map.stage, 1280)),
  ).toHaveLength(16);
  expect(
    fullyVisible(map.target("valley-electric:city"), map.stage, 1280),
  ).toBe(true);
  expect(fullyVisible(map.target("ridge-electric:city"), map.stage, 1280)).toBe(
    true,
  );
});

it("keeps a resumed selected tile a full cell from the phone viewport edges", () => {
  jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
  const map = show(1e9, false, "champlain:site-13");
  const selected = map.target("champlain:site-13");
  const cellWidth = Number.parseFloat(selected.style.width);
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(tileCenter(selected, map.stage).x).toBeGreaterThanOrEqual(cellWidth);
  expect(tileCenter(selected, map.stage).x).toBeLessThanOrEqual(
    360 - cellWidth,
  );
});

it("keeps focus, arrows and repeated activation keys free of purchases", () => {
  const map = show();
  map.buyMode();
  const tile = map.candidates()[0];
  act(() => tile.focus());
  expect(fireEvent.keyDown(tile, { key: "Enter", repeat: true })).toBe(false);
  expect(fireEvent.keyDown(tile, { key: " ", repeat: true })).toBe(false);
  fireEvent.keyDown(tile, { key: "ArrowRight" });
  const selectedId =
    map.onSelect.mock.calls[map.onSelect.mock.calls.length - 1][0];
  expect(map.target(selectedId)).toHaveFocus();
  expect(map.target(selectedId)).not.toBe(tile);
  expect(
    map.store.getState().game.territoryNetwork!.tilePurchases,
  ).toHaveLength(0);
  expect(map.onSelect.mock.calls.some((call) => call[1] === true)).toBe(false);
  expect(
    screen
      .getAllByRole("button")
      .filter(
        (button) =>
          button.tabIndex === 0 && button.hasAttribute("data-map-target"),
      ),
  ).toHaveLength(1);
  fireEvent.keyDown(map.target(selectedId), { key: "Escape" });
  expect(
    screen.getByRole("button", { name: "Rapid connection mode" }),
  ).toHaveAttribute("aria-pressed", "false");
});

it("suppresses clicks after panning and a second touch, and allows the next deliberate tap", () => {
  const map = show();
  map.buyMode();
  const tile = map.candidates()[0];
  fireEvent.pointerDown(tile, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(tile, { pointerId: 1, clientX: 130, clientY: 120 });
  fireEvent.pointerUp(tile, { pointerId: 1, clientX: 130, clientY: 120 });
  fireEvent.click(tile, { detail: 1 });
  expect(
    map.store.getState().game.territoryNetwork!.tilePurchases,
  ).toHaveLength(0);
  fireEvent.pointerDown(tile, { pointerId: 1 });
  fireEvent.pointerDown(tile, { pointerId: 2 });
  fireEvent.pointerUp(tile, { pointerId: 2 });
  fireEvent.pointerUp(tile, { pointerId: 1 });
  fireEvent.click(tile, { detail: 1 });
  expect(
    map.store.getState().game.territoryNetwork!.tilePurchases,
  ).toHaveLength(0);
  tap(tile);
  expect(
    map.store.getState().game.territoryNetwork!.tilePurchases,
  ).toHaveLength(1);
});

it("shares pending cash with surface purchases, prevents duplicates, and waits for authoritative ownership after the receipt", async () => {
  const cash = 5e6;
  const map = show(cash);
  const host = fakeHost();
  map.buyMode();
  const game = map.store.getState().game;
  const prices = (button: HTMLButtonElement) =>
    tilePurchaseQuote(game, idOf(button))!.price;
  const [tile, other] = map
    .candidates()
    .filter((button) => prices(button) <= cash);
  expect(prices(tile) + prices(other)).toBeGreaterThan(cash);
  const id = idOf(tile);
  const otherId = idOf(other);
  map.setOtherTile(otherId);
  tap(tile);
  tap(tile);
  fireEvent.click(screen.getByTestId("other-buy"));
  expect(host.submit).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("status", { name: "Connection result" }),
  ).toHaveTextContent("Not enough available cash");
  expect(tile).toHaveAttribute("aria-busy", "true");
  await act(async () => host.complete());
  expect(tile).toHaveAttribute("aria-busy", "true");
  expect(ownsTerritoryTile(map.store.getState().game, id)).toBe(false);
  const quote = tilePurchaseQuote(map.store.getState().game, id)!;
  act(() => {
    map.store.dispatch(acquireTile({ tileId: id, quoteKey: quote.quoteKey }));
  });
  expect(map.target(id)).not.toHaveAttribute("aria-busy");
  expect(
    screen.getByRole("status", { name: "Connection result" }),
  ).toHaveTextContent("Site connected");
  expect(screen.getByTestId("other-buy")).toHaveTextContent("committed 0");
});

it("keeps buying mode and releases commitments when the host rejects, then resets the mode on loading another run", async () => {
  const map = show();
  const host = fakeHost();
  map.buyMode();
  const tile = map.candidates()[0];
  tap(tile);
  await act(async () => host.reject());
  expect(
    screen.getByRole("status", { name: "Connection result" }),
  ).toHaveTextContent("Another utility claimed this tile");
  expect(tile).not.toHaveAttribute("aria-busy");
  expect(screen.getByTestId("other-buy")).toHaveTextContent("committed 0");
  expect(
    screen.getByRole("button", { name: "Rapid connection mode" }),
  ).toHaveAttribute("aria-pressed", "true");
  act(() => {
    map.store.dispatch({ type: "test/load" });
  });
  expect(
    screen.getByRole("button", { name: "Rapid connection mode" }),
  ).toHaveAttribute("aria-pressed", "false");
});

it("does not spend when an Inspect gesture becomes affordable before release", async () => {
  const map = show(5e6);
  const host = fakeHost();
  map.buyMode();
  const affordable = map.candidates().filter((button) => {
    const price = tilePurchaseQuote(
      map.store.getState().game,
      idOf(button),
    )!.price;
    return price > 2.5e6 && price <= 5e6;
  });
  const [first, second] = affordable;
  const id = idOf(second);
  tap(first);
  const inspected = map.target(id);
  expect(inspected).toHaveAccessibleName(/^Inspect.*not enough available cash/);
  fireEvent.pointerDown(inspected, { pointerId: 1 });
  await act(async () => host.reject());
  expect(map.target(id)).toHaveAccessibleName(/^(Connect|Acquire)/);
  fireEvent.pointerUp(map.target(id), { pointerId: 1 });
  fireEvent.click(map.target(id), { detail: 1 });
  expect(map.onSelect).toHaveBeenLastCalledWith(id, true);
  expect(host.submit).toHaveBeenCalledTimes(1);
  tap(map.target(id));
  expect(host.submit).toHaveBeenCalledTimes(2);
});

it("keeps Rapid connection off during a pending project confirmation", () => {
  const map = show(undefined, false, undefined, new Map(), true);
  const rapid = screen.getByRole("button", { name: "Rapid connection mode" });
  expect(rapid).toHaveAttribute("aria-disabled", "true");
  map.buyMode();
  expect(rapid).toHaveAttribute("aria-pressed", "false");
});

it("closes inspection, exits buying and deselects with one Escape on the map", () => {
  const map = show(1e9, true);
  map.buyMode();
  const tile = map.candidates()[0];
  fireEvent.keyDown(tile, { key: "Escape" });
  expect(map.closeInspection).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Rapid connection mode" }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(map.target("champlain:city")).toHaveAttribute("aria-pressed", "false");
  expect(
    screen.getByRole("button", { name: "Rapid connection mode" }),
  ).toHaveFocus();
});

it("returns from map geography to its buying control after closing inspection and buying mode, then releases Escape", () => {
  const map = show(1e9, true);
  map.buyMode();
  const tile = map.target("champlain:city");
  act(() => tile.focus());
  expect(fireEvent.keyDown(tile, { key: "Escape" })).toBe(false);
  expect(map.closeInspection).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Rapid connection mode" }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(tile).toHaveAttribute("aria-pressed", "false");
  const buy = screen.getByRole("button", { name: "Rapid connection mode" });
  expect(buy).toHaveFocus();
  // The next Back belongs to the game's global navigation again.
  expect(fireEvent.keyDown(buy, { key: "Escape" })).toBe(true);
});

it("requires a fresh activation if a displayed quote changes during a pointer gesture", () => {
  const map = show();
  const host = fakeHost();
  map.buyMode();
  const tile = map.candidates()[0];
  const id = idOf(tile);
  fireEvent.pointerDown(tile, { pointerId: 1, clientX: 100, clientY: 100 });
  const before = map.store.getState().game;
  const quotedPrice = tilePurchaseQuote(before, id)!.price;
  act(() => {
    map.store.dispatch(
      delta({
        date: getDateFromMinute(
          before.date.minute + MINUTES_PER_MONTH,
          before.startingYear,
        ),
        timeline: before.timeline.map((tick) => ({
          ...tick,
          minute: tick.minute + MINUTES_PER_MONTH,
        })),
      }),
    );
  });
  expect(tilePurchaseQuote(map.store.getState().game, id)!.price).not.toBe(
    quotedPrice,
  );
  fireEvent.pointerUp(map.target(id), {
    pointerId: 1,
    clientX: 100,
    clientY: 100,
  });
  fireEvent.click(map.target(id), { detail: 1 });
  expect(host.submit).not.toHaveBeenCalled();
  expect(
    screen.getByRole("status", { name: "Connection result" }),
  ).toHaveTextContent("connection cost changed");
  map.buyMode();
  map.buyMode();
  expect(
    screen.getByRole("button", { name: "Rapid connection mode" }),
  ).toHaveAccessibleDescription(/Select a priced site to pay/);
  tap(map.target(id));
  expect(host.submit).toHaveBeenCalledTimes(1);
});

it("hands the phone camera back to a drag during a tile inspection shift", () => {
  jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390);
  jest.useFakeTimers();
  try {
    const map = show();
    const initial = map.stage.style.transform;
    tap(map.target("champlain:city"));
    act(() => jest.advanceTimersByTime(64));
    const shifting = map.stage.style.transform;
    expect(shifting).not.toBe(initial);

    fireEvent.pointerDown(map.viewport, { clientX: 100 });
    fireEvent.pointerMove(map.viewport, { clientX: 140 });
    fireEvent.pointerUp(map.viewport, { clientX: 140 });
    const dragged = map.stage.style.transform;
    expect(dragged).not.toBe(shifting);
    act(() => jest.advanceTimersByTime(300));
    expect(map.stage.style.transform).toBe(dragged);
  } finally {
    jest.useRealTimers();
  }
});

it("keeps phone targets large and unaffordable land inspectable with its currency, benefit and reason", async () => {
  jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
  const map = show(1e6);
  map.buyMode();
  const tile = screen.getAllByRole<HTMLButtonElement>("button", {
    name: /Inspect.*\$.*General site; not enough available cash/,
  })[0];
  expect(Number.parseFloat(tile.style.width)).toBe(96);
  expect(Number.parseFloat(tile.style.height)).toBeGreaterThanOrEqual(44);
  expect(map.viewport).toHaveAttribute("data-camera-scale", "0.75");
  tap(tile);
  expect(map.onSelect).toHaveBeenLastCalledWith(idOf(tile), true);
  // The shared phone sheet occupies at most 62%; leave the selected hex above it.
  await waitFor(() => {
    expect(tileCenter(tile, map.stage).y).toBeLessThan(900 * 0.38);
  });
  expect(
    map.store.getState().game.territoryNetwork!.tilePurchases,
  ).toHaveLength(0);
});

it.each([
  { cash: 1e9, unaffordable: false, action: "Connect", reason: "" },
  {
    cash: 1e6,
    unaffordable: true,
    action: "Inspect",
    reason: "; not enough available cash",
  },
])(
  "keeps general-land price labels compact without losing cash-limited descriptions with $cash cash",
  ({ cash, unaffordable, action, reason }) => {
    const map = show(cash);
    map.buyMode();
    const tile = map
      .candidates()
      .find(
        (button) =>
          tilePurchaseQuote(map.store.getState().game, idOf(button))
            ?.benefit === "general",
      )!;
    expect(tile).toHaveTextContent(/\$/);
    expect(tile).not.toHaveTextContent(/General site|Not enough cash/);
    expect(tile).toHaveAttribute("data-unaffordable", String(unaffordable));
    expect(tile).toHaveAccessibleName(
      new RegExp(`^${action} .*General site${reason}$`),
    );
  },
);

it("keeps an unselected map unselected across game updates with one reachable tile", () => {
  const map = show();
  const tile = map.target("champlain:city");
  fireEvent.keyDown(tile, { key: "Escape" });
  const targets = () =>
    screen
      .getAllByRole<HTMLButtonElement>("button")
      .filter((button) => button.hasAttribute("data-map-target"));
  expect(
    targets().filter(
      (button) => button.getAttribute("aria-pressed") === "true",
    ),
  ).toHaveLength(0);
  expect(targets().filter((button) => button.tabIndex === 0)).toHaveLength(1);
  const camera = { ...map.viewport.dataset };
  act(() => {
    map.store.dispatch(delta({ speed: "NORMAL" }));
  });
  expect(
    targets().filter(
      (button) => button.getAttribute("aria-pressed") === "true",
    ),
  ).toHaveLength(0);
  expect({ ...map.viewport.dataset }).toEqual(camera);
  expect(map.onSelect).not.toHaveBeenCalled();
  const buy = screen.getByRole("button", { name: "Rapid connection mode" });
  expect(buy).not.toHaveTextContent(/Buy|available/);
  expect(buy).toHaveAttribute("aria-pressed", "false");
});

function enable3D() {
  const descriptor = Object.getOwnPropertyDescriptor(
    window,
    "WebGL2RenderingContext",
  );
  Object.defineProperty(window, "WebGL2RenderingContext", {
    configurable: true,
    value: class {},
  });
  return () => {
    if (descriptor)
      Object.defineProperty(window, "WebGL2RenderingContext", descriptor);
    else Reflect.deleteProperty(window, "WebGL2RenderingContext");
  };
}
it("retains ownership boundaries and wire topology through power ticks and camera movement, then updates after a connection", () => {
  const topology = jest.spyOn(HexGeometry, "hexWires");
  const map = show();
  const firstPasses = topology.mock.calls.length;
  act(() => {
    map.store.dispatch(delta({ speed: "NORMAL" }));
  });
  fireEvent.wheel(map.viewport, { deltaX: 1, deltaY: 1 });
  expect(topology).toHaveBeenCalledTimes(firstPasses);
  map.buyMode();
  tap(map.candidates()[0]);
  expect(topology.mock.calls.length).toBeGreaterThan(firstPasses);
});

it("leaves browser zoom and uncaptured pointer exits to the browser", () => {
  const map = show();
  const before = { ...map.viewport.dataset };
  const zoom = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    deltaY: 50,
  });
  fireEvent(map.viewport, zoom);
  expect(zoom.defaultPrevented).toBe(false);

  const tile = map.target("champlain:city");
  fireEvent.pointerDown(tile, { clientX: 20, clientY: 20, buttons: 1 });
  fireEvent.pointerLeave(map.viewport, {
    clientX: -1,
    clientY: 20,
    buttons: 1,
  });
  fireEvent.pointerMove(tile, { clientX: 65, clientY: 20, buttons: 0 });
  expect({ ...map.viewport.dataset }).toEqual(before);
});
it("activates and hovers the picked elevated model while keyboard and explicit price labels keep their own targets", async () => {
  const restore = enable3D();
  try {
    const map = show();
    await screen.findByTestId("map-scene");
    const facility = territoryTileViews(map.store.getState().game).find(
      (view) => view.operatingFacility,
    )!;
    mockPick.mockReturnValue(facility.tile.id);
    map.buyMode();
    const ground = map.candidates()[0],
      model = map.target(facility.tile.id);
    mockPick.mockClear();
    fireEvent.pointerMove(ground, { pointerId: 1, clientX: 90, clientY: 90 });
    fireEvent.pointerMove(ground, { pointerId: 1, clientX: 100, clientY: 100 });
    await waitFor(() =>
      expect(model).toHaveAttribute("data-model-hovered", "true"),
    );
    expect(mockPick).toHaveBeenCalledTimes(1);
    expect(hoverColor(model)).toBe("var(--blackout-red)");
    expect(ground).not.toHaveAttribute("data-model-hovered");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      facility.facility!.name,
    );
    expect(ground).not.toHaveAttribute("title");
    tap(ground);
    expect(map.onSelect).toHaveBeenLastCalledWith(facility.tile.id, true);
    expect(
      map.store.getState().game.territoryNetwork!.tilePurchases,
    ).toHaveLength(0);
    fireEvent.pointerLeave(map.viewport);
    expect(model).not.toHaveAttribute("data-model-hovered");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    const price = within(ground).getByText(/^\$/);
    fireEvent.pointerMove(price, { pointerId: 1, clientX: 100, clientY: 100 });
    await waitFor(() =>
      expect(ground).toHaveAttribute("data-model-hovered", "true"),
    );
    expect(model).not.toHaveAttribute("data-model-hovered");
    fireEvent.pointerDown(price, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(price, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.click(price, { detail: 1 });
    expect(ownsTerritoryTile(map.store.getState().game, idOf(ground))).toBe(
      true,
    );
    const keyboard = map.candidates()[0];
    fireEvent.click(keyboard, { detail: 0 });
    expect(ownsTerritoryTile(map.store.getState().game, idOf(keyboard))).toBe(
      true,
    );
    const company = map.target("valley-electric:city"),
      companyLabel = within(company).getByText("Valley Electric");
    fireEvent.pointerMove(companyLabel, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    await waitFor(() =>
      expect(company).toHaveAttribute("data-model-hovered", "true"),
    );
    expect(hoverColor(company)).toBe("var(--territory-owner-valley)");
  } finally {
    restore();
  }
});

it("ignores presses outside the painted map even if the terrain draws before release", async () => {
  const restore = enable3D();
  try {
    const map = show();
    await screen.findByTestId("map-scene");
    const tile = map.target("champlain:site-13");

    mockPick.mockReturnValue(null);
    tap(tile);
    expect(map.onSelect).not.toHaveBeenCalled();

    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 100, clientY: 100 });
    mockPick.mockReturnValue(undefined);
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.click(tile, { detail: 1 });
    expect(map.onSelect).not.toHaveBeenCalled();

    tap(tile);
    expect(map.onSelect).toHaveBeenLastCalledWith(idOf(tile), true);
  } finally {
    restore();
  }
});

it("binds a retargeted model gesture to the quote shown at pointer down", async () => {
  const restore = enable3D();
  try {
    const map = show(),
      host = fakeHost();
    await screen.findByTestId("map-scene");
    map.buyMode();
    const candidate = map.candidates()[0],
      id = idOf(candidate),
      ground = map.target("champlain:city");
    mockPick.mockReturnValue(id);
    fireEvent.pointerDown(ground, { pointerId: 1, clientX: 100, clientY: 100 });
    const before = map.store.getState().game;
    act(() => {
      map.store.dispatch(
        delta({
          date: getDateFromMinute(
            before.date.minute + MINUTES_PER_MONTH,
            before.startingYear,
          ),
          timeline: before.timeline.map((tick) => ({
            ...tick,
            minute: tick.minute + MINUTES_PER_MONTH,
          })),
        }),
      );
    });
    fireEvent.pointerUp(ground, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.click(ground, { detail: 1 });
    expect(host.submit).not.toHaveBeenCalled();
    expect(
      screen.getByRole("status", { name: "Connection result" }),
    ).toHaveTextContent("connection cost changed");
  } finally {
    restore();
  }
});

it("retains the accessible map and Connect action after the lazy scene fails", async () => {
  const restore = enable3D();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  mockSceneError = true;
  try {
    const map = show();
    await waitFor(() =>
      expect(
        screen.getByLabelText("Terrain, structures and utility ownership"),
      ).toHaveAttribute("data-renderer", "unavailable"),
    );
    expect(map.target("champlain:city")).toHaveAccessibleName(
      "Inspect You territory · Burlington",
    );
    map.buyMode();
    tap(map.candidates()[0]);
    expect(
      map.store.getState().game.territoryNetwork!.tilePurchases,
    ).toHaveLength(1);
  } finally {
    restore();
  }
});

it("opens the actions for the picked model on right-click and for the focused tile from the keyboard", async () => {
  const restore = enable3D();
  try {
    const map = show();
    await screen.findByTestId("map-scene");
    const tile = map.target("champlain:city");
    const picked = territoryTileViews(map.store.getState().game).find(
      ({ operatingFacility }) => operatingFacility,
    )!.tile.id;
    mockPick.mockReturnValue(picked);

    expect(fireEvent.contextMenu(tile, { clientX: 100, clientY: 120 })).toBe(
      false,
    );
    expect(map.onTileMenu).toHaveBeenLastCalledWith({
      key: picked,
      left: 100,
      top: 120,
    });
    expect(fireEvent.keyDown(tile, { key: "F10", shiftKey: true })).toBe(false);
    expect(map.onTileMenu).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "champlain:city" }),
    );
    // Opening the menu moves focus and its highlight, without activating inspection.
    expect(map.onSelect.mock.calls).toEqual([
      ["champlain:site-0", undefined],
      ["champlain:city", undefined],
    ]);
  } finally {
    restore();
  }
});

it.each([
  ["green-uplands:site-1", "−20%", "false"],
  ["champlain:site-9", "+29%", "true"],
] as const)(
  "shows the estimated wind output modifier on %s",
  (id, modifier, favorable) => {
    const game = createGame({ scenarioId: 116, seed: 188 });
    const wind = projectCatalogue(game, 20e6, false).find(
      ({ name }) => name === "Wind",
    )!;
    const quote = projectSiteQuote(game, selectProject(wind), id);
    if (!quote.facility) throw new Error(quote.reason);
    const map = show(1e9, false, "champlain:city", new Map([[id, quote]]));
    const target = map.target(id);
    expect(target).toHaveAccessibleName(
      expect.stringContaining(`${modifier} estimated output vs flat terrain`),
    );
    expect(within(target).getByText(modifier)).toHaveAttribute(
      "data-favorable",
      favorable,
    );
  },
);
