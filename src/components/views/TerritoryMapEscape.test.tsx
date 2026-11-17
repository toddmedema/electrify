import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import type { TerritoryTileId } from "../../Types";
import reducer from "../../reducers/Game";
import { createGame } from "../../testing/Simulator";
import { TerritoryTilePurchasesProvider } from "../base/TerritoryTilePurchases";
import TileWorkspaceSurface from "../base/TileWorkspaceSurface";
import TerritoryHexMap from "./TerritoryHexMap";

function show() {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const store = configureStore({ reducer: { game: reducer } });
  function Workspace({ hidden = false, overlay = false } = {}) {
    const [selected, setSelected] = React.useState<TerritoryTileId | undefined>(
      "champlain:city",
    );
    const [inspected, setInspected] = React.useState(true);
    const close = () => {
      setSelected(undefined);
      setInspected(false);
    };
    return (
      <>
        <main className="base_main">
          <div className="gameWorkspace">
            <div hidden={hidden}>
              <section className="territoryNetwork">
                <TerritoryHexMap
                  game={game}
                  selected={selected}
                  onSelect={setSelected}
                  onDeselect={close}
                  onCloseInspection={inspected ? close : undefined}
                />
                <details>
                  <summary>Acquired utilities</summary>
                </details>
                {inspected && (
                  <TileWorkspaceSurface
                    title="City"
                    focusKey="city"
                    onClose={close}
                  >
                    City demand
                  </TileWorkspaceSurface>
                )}
              </section>
            </div>
            <button>Controller help</button>
            <section className="gameToolPanel" data-game-tool="PROGRAMS">
              <button>Program control</button>
            </section>
          </div>
        </main>
        <button>Other screen</button>
        {overlay && <div className="MuiModal-root">Acquisition review</div>}
      </>
    );
  }
  const view = render(
    <Provider store={store}>
      <TerritoryTilePurchasesProvider game={game}>
        <Workspace />
      </TerritoryTilePurchasesProvider>
    </Provider>,
  );
  return {
    ...view,
    rerenderWorkspace: (props: { hidden?: boolean; overlay?: boolean }) =>
      view.rerender(
        <Provider store={store}>
          <TerritoryTilePurchasesProvider game={game}>
            <Workspace {...props} />
          </TerritoryTilePurchasesProvider>
        </Provider>,
      ),
  };
}

it.each([
  ["Acquired utilities", false],
  ["Acquired utilities", true],
  ["Controller help", false],
  ["Controller help", true],
] as const)(
  "closes inspection from %s with buying mode %s, then releases Escape",
  (name, buying) => {
    show();
    const buy = screen.getByRole("button", { name: "Buy land" });
    if (buying) fireEvent.click(buy);
    const outside = screen.getByText(name);
    act(() => outside.focus());
    expect(outside).toHaveFocus();
    expect(fireEvent.keyDown(outside, { key: "Escape" })).toBe(false);
    expect(
      screen.queryByRole("dialog", { name: "City" }),
    ).not.toBeInTheDocument();
    expect(buy).toHaveAttribute("aria-pressed", "false");
    const tiles = screen
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("data-map-target"));
    expect(
      tiles.filter((tile) => tile.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(0);
    expect(tiles.filter((tile) => tile.tabIndex === 0)).toHaveLength(1);
    expect(buy).toHaveFocus();
    expect(fireEvent.keyDown(buy, { key: "Escape" })).toBe(true);
  },
);

it("leaves visible overlays, hidden maps and other screens in charge of Escape", () => {
  const view = show();
  const help = screen.getByRole("button", { name: "Controller help" });
  view.rerenderWorkspace({ overlay: true });
  expect(fireEvent.keyDown(help, { key: "Escape" })).toBe(true);
  expect(screen.getByRole("dialog", { name: "City" })).toBeInTheDocument();
  view.rerenderWorkspace({ hidden: true });
  expect(fireEvent.keyDown(help, { key: "Escape" })).toBe(true);
  view.rerenderWorkspace({});
  expect(
    fireEvent.keyDown(screen.getByRole("button", { name: "Other screen" }), {
      key: "Escape",
    }),
  ).toBe(true);
  expect(screen.getByRole("dialog", { name: "City" })).toBeInTheDocument();
});

it("honors an already handled Escape", () => {
  show();
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  event.preventDefault();
  act(() => screen.getByText("Acquired utilities").dispatchEvent(event));
  expect(screen.getByRole("dialog", { name: "City" })).toBeInTheDocument();
});

it("leaves Escape in another side tool with that tool before clearing the map", () => {
  show();
  const control = screen.getByRole("button", { name: "Program control" });
  act(() => control.focus());
  expect(fireEvent.keyDown(control, { key: "Escape" })).toBe(true);
  expect(screen.getByRole("dialog", { name: "City" })).toBeInTheDocument();
});
