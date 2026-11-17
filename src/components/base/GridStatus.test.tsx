import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { configureStore } from "@reduxjs/toolkit";
import { Provider, useSelector } from "react-redux";
import type { AppDispatch } from "../../Store";
import type { AppStateType } from "../../Types";
import { createAppTheme } from "../../Theme";
import { createGame } from "../../testing/Simulator";
import gameReducer from "../../reducers/Game";
import cardReducer, { navigate } from "../../reducers/Card";
import uiReducer from "../../reducers/UI";
import { openEvidence } from "../../helpers/Evidence";
import { clearTransmissionMarket } from "../../helpers/Transmission";
import Facilities from "../views/FacilitiesContainer";
import { GameWorkspaceContext } from "./GameWorkspaceContext";
import GridStatus from "./GridStatus";
import { readProjection, requestProjection } from "./DeferredProjection";

jest.mock("./DeferredProjection", () => ({
  projectionReady: jest.fn(() => false),
  readProjection: jest.fn(),
  requestProjection: jest.fn(),
  subscribeProjection: () => () => undefined,
}));

function setup(scenarioId = 116) {
  const game = createGame({ scenarioId });
  const now = game.timeline[0];
  const onEvidence = jest.fn();
  const onNavigate = jest.fn();
  const onReserveHelp = jest.fn();
  const props = { game, now, onEvidence, onNavigate, onReserveHelp };
  return {
    props,
    ...render(
      <ThemeProvider theme={createAppTheme("light")}>
        <GridStatus {...props} />
      </ThemeProvider>,
    ),
  };
}

beforeEach(() => jest.clearAllMocks());

it("keeps current facts visible while requesting the shared forecast, never reading stale projection", () => {
  setup();
  expect(
    screen.getByRole("button", { name: /^Current grid status: NOW/ }),
  ).toBeVisible();
  expect(requestProjection).toHaveBeenCalled();
  expect(readProjection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^Current grid status/ }));
  expect(screen.getByRole("dialog", { name: "Grid status" })).toHaveTextContent(
    "Updating forecast…",
  );
});

it("shows live import exposure and agreement capacity, then closes before each navigation callback", () => {
  const { props, rerender } = setup();
  props.now.importedW = 25e6;
  props.now.supplyW = 100e6;
  props.now.entitlementImportCapacityW = 40e6;
  rerender(
    <ThemeProvider theme={createAppTheme("light")}>
      <GridStatus {...props} />
    </ThemeProvider>,
  );
  const status = screen.getByRole("button", { name: /^Current grid status/ });
  for (const [name, target] of [
    ["Manage fleet", "FLEET"],
    ["Manage agreements", "AGREEMENTS"],
  ]) {
    props.onNavigate.mockImplementation(() =>
      expect(
        screen.queryByRole("dialog", { name: "Grid status" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(status);
    const dialog = screen.getByRole("dialog", { name: "Grid status" });
    expect(dialog).toHaveTextContent("Purchased power now: 25MW total");
    expect(dialog).toHaveTextContent("For customers: 25MW · 25% of supply");
    expect(dialog).toHaveTextContent("Under agreement: 40MW");
    fireEvent.click(within(dialog).getByRole("button", { name }));
    expect(props.onNavigate).toHaveBeenLastCalledWith(target);
  }
  fireEvent.click(status);
  fireEvent.click(screen.getByRole("button", { name: "View supply forecast" }));
  expect(props.onEvidence).toHaveBeenCalledWith({
    card: "INSIGHTS",
    layer: "SUPPLY_DEMAND",
  });
});

it("returns focus to the status trigger after closing", async () => {
  setup(101);
  const status = screen.getByRole("button", { name: /^Current grid status/ });
  fireEvent.click(status);
  fireEvent.click(screen.getByRole("button", { name: "Close grid status" }));
  await waitFor(() => expect(status).toHaveFocus());
});

it("separates purchased power serving customers from imports charging storage", () => {
  const { props, rerender } = setup(101);
  const cleared = clearTransmissionMarket({
    localSupplyW: 0,
    demandW: 40e6,
    storageChargeW: 60e6,
    capacityW: 100e6,
    importLimitW: 100e6,
    exportLimitW: 0,
    buyingRule: "SHORTAGES_AND_STORAGE",
    sellingRule: "NONE",
  });
  Object.assign(props.now, cleared, {
    demandW: 40e6,
    supplyW: cleared.localAvailableSupplyW,
  });
  rerender(
    <ThemeProvider theme={createAppTheme("light")}>
      <GridStatus {...props} />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Current grid status/ }));
  const dialog = screen.getByRole("dialog", { name: "Grid status" });
  expect(dialog).toHaveTextContent("Purchased power now: 100MW total");
  expect(dialog).toHaveTextContent("For customers: 40MW · 100% of supply");
  expect(dialog).toHaveTextContent("Charging storage: 60MW");
});

it.each([101, 105])(
  "offers no agreement management without existing external controls (scenario %s)",
  (scenarioId) => {
    setup(scenarioId);
    fireEvent.click(
      screen.getByRole("button", { name: /^Current grid status/ }),
    );
    expect(
      screen.queryByRole("button", { name: "Manage agreements" }),
    ).not.toBeInTheDocument();
  },
);

it("repeatedly opens and focuses the legacy trading controls, which still update the real buying rule", async () => {
  const game = createGame({ scenarioId: 111, seed: 61 });
  game.inGame = true;
  const store = configureStore({
    reducer: { game: gameReducer, card: cardReducer, ui: uiReducer },
    preloadedState: { game },
  });
  const dispatch = store.dispatch as AppDispatch;
  dispatch(navigate("INSIGHTS"));
  function LegacyFacilities() {
    const card = useSelector((state: AppStateType) => state.card.name);
    return card === "FACILITIES" ? <Facilities /> : null;
  }
  render(
    <Provider store={store}>
      <ThemeProvider theme={createAppTheme("light")}>
        <GameWorkspaceContext.Provider value={true}>
          <GridStatus
            game={game}
            now={game.timeline[0]}
            onEvidence={(target) => dispatch(openEvidence(target))}
            onNavigate={(card) => dispatch(navigate(card))}
          />
          <LegacyFacilities />
        </GameWorkspaceContext.Provider>
      </ThemeProvider>
    </Provider>,
  );
  for (const [label, rule] of [
    ["None", "NONE"],
    ["Shortages only", "SHORTAGES"],
  ]) {
    fireEvent.click(
      screen.getByRole("button", { name: /^Current grid status/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage agreements" }));
    const controls = screen.getByRole("region", {
      name: "Intertie management",
    });
    await waitFor(() => expect(controls).toHaveFocus());
    expect(controls).toBeVisible();
    const buying = within(controls).getByRole("combobox", { name: "Buying" });
    fireEvent.mouseDown(buying);
    fireEvent.click(screen.getByRole("option", { name: label }));
    expect(store.getState().game.transmission!.buyingRule).toBe(rule);
  }
});

it("retains tutorial facts while allowing only revealed navigation", () => {
  const { props, rerender } = setup(0);
  fireEvent.click(screen.getByRole("button", { name: /^Current grid status/ }));
  expect(screen.getByRole("heading", { name: "Now" })).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: /Manage fleet|Manage agreements|View supply forecast/,
    }),
  ).not.toBeInTheDocument();
  rerender(
    <ThemeProvider theme={createAppTheme("light")}>
      <GridStatus {...props} tutorialActions={["INSIGHTS"]} />
    </ThemeProvider>,
  );
  expect(
    screen.getByRole("button", { name: "View supply forecast" }),
  ).toBeVisible();
});
