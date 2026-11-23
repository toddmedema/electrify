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
import { getDateFromMinute } from "../../helpers/DateTime";
import { clearTransmissionMarket } from "../../helpers/Transmission";
import { selectProjection } from "../../helpers/Projection";
import Facilities from "../views/FacilitiesContainer";
import { GameWorkspaceContext } from "./GameWorkspaceContext";
import GridStatus from "./GridStatus";
import {
  projectionReady,
  readProjection,
  requestProjection,
} from "./DeferredProjection";

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

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(projectionReady).mockReturnValue(false);
});

it("keeps current facts visible while requesting the shared forecast, never reading stale projection", () => {
  const { props } = setup();
  expect(
    screen.getByRole("button", { name: /^Current grid status: NOW/ }),
  ).toBeVisible();
  expect(requestProjection).toHaveBeenCalledWith(
    props.game,
    props.now,
    "top-bar",
  );
  expect(readProjection).not.toHaveBeenCalled();
  props.game.timeline = [props.now];
  fireEvent.click(screen.getByRole("button", { name: /^Current grid status/ }));
  expect(screen.getByRole("dialog", { name: "Grid status" })).toHaveTextContent(
    "Updating forecast…",
  );
});

it("closes before navigating from the diagnosis", () => {
  const { props } = setup();
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

it("shows the estimated size and quarter-hour of a sampled shortfall while the long-range forecast updates", () => {
  const { props, rerender } = setup();
  const minute = 18 * 60 + 15;
  props.game.date = getDateFromMinute(minute, props.game.startingYear);
  props.game.timeline = [
    { ...props.now, minute, demandW: 100e6, supplyW: 100e6 },
    { ...props.now, minute: minute + 30, demandW: 100e6, supplyW: 50e6 },
  ];
  rerender(
    <ThemeProvider theme={createAppTheme("light")}>
      <GridStatus {...props} now={props.game.timeline[0]} />
    </ThemeProvider>,
  );
  expect(screen.getByText("Short at 6:45 PM")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^Current grid status/ }));
  const dialog = screen.getByRole("dialog", { name: "Grid status" });
  expect(dialog).toHaveTextContent(
    "About 50MW short at 6:45 PM in this month’s sample",
  );
  expect(dialog).not.toHaveTextContent("Updating forecast…");
});

it("surfaces a projected monthly reliability risk without implying a sampled shortfall", () => {
  const { props, rerender } = setup();
  const { game, now } = props;
  game.timeline = [now];
  const projection = selectProjection(game, now, undefined, "top-bar");
  jest.mocked(projectionReady).mockReturnValue(true);
  jest.mocked(readProjection).mockReturnValue({
    ...projection,
    financeProjected: [
      {
        ...projection.financeProjected[0],
        year: game.startingYear,
        month: 7,
        demandWh: 100,
        supplyWh: 50,
      },
    ],
  });
  rerender(
    <ThemeProvider theme={createAppTheme("light")}>
      <GridStatus {...props} />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Current grid status/ }));
  const dialog = screen.getByRole("dialog", { name: "Grid status" });
  expect(readProjection).toHaveBeenCalledWith(game, now, "top-bar");
  expect(dialog).toHaveTextContent(
    `Projected reliability risk in Jul ${game.startingYear}`,
  );
  expect(dialog).not.toHaveTextContent(/short at|Updating forecast/);
});

it.each([
  [120e6, 20e6, "Stable", "20MW reserve", "View supply forecast"],
  [105e6, 5e6, "Low reserve", "5MW reserve", "Manage fleet"],
  [100e6, 0, "At limit", "0MW reserve", "Manage fleet"],
  [70e6, 0, "Shortage", "30MW short", "Manage fleet"],
])(
  "prioritizes the action for a %s W supply with %s W of reserve",
  (supplyW, reserveW, label, metric, action) => {
    const { props, rerender } = setup(101);
    const now = { ...props.now, demandW: 100e6, supplyW, reserveW };
    rerender(
      <ThemeProvider theme={createAppTheme("light")}>
        <GridStatus {...props} now={now} />
      </ThemeProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Current grid status/ }),
    );
    const dialog = screen.getByRole("dialog", { name: "Grid status" });
    expect(
      within(dialog).getByRole("heading", { name: `Now · ${label}` }),
    ).toBeVisible();
    expect(dialog).toHaveTextContent(metric);
    expect(within(dialog).getByRole("button", { name: action })).toHaveClass(
      "MuiButton-contained",
    );
  },
);

it("returns focus to the status trigger after closing", async () => {
  setup(101);
  const status = screen.getByRole("button", { name: /^Current grid status/ });
  fireEvent.click(status);
  fireEvent.click(screen.getByRole("button", { name: "Close grid status" }));
  await waitFor(() => expect(status).toHaveFocus());
});

it("reports only imported power serving customers", () => {
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
  expect(dialog).toHaveTextContent("40MW imported for customers");
  expect(dialog).not.toHaveTextContent(/100MW|60MW/);
});

it.each([101, 105])(
  "offers no agreement management without existing external controls (scenario %s)",
  (scenarioId) => {
    setup(scenarioId);
    fireEvent.click(
      screen.getByRole("button", { name: /^Current grid status/ }),
    );
    expect(
      screen.queryByRole("button", {
        name: /Manage agreements|Manage interties/,
      }),
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
    fireEvent.click(screen.getByRole("button", { name: "Manage interties" }));
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
  expect(screen.getByRole("heading", { name: /^Now ·/ })).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: /Manage fleet|Manage agreements|Manage interties|View supply forecast/,
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
