import { createTheme, ThemeProvider } from "@mui/material/styles";
import { render, screen, within } from "@testing-library/react";
import * as DateTime from "../../helpers/DateTime";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { SCENARIOS } from "../../data/Scenarios";
import { createGame } from "../../testing/Simulator";
import { activeScenario } from "../../helpers/GameSelectors";
import { ScenarioDetailsContent } from "./ScenarioDetails";
import * as MissionProjection from "../../helpers/MissionProjection";
import * as DeferredProjection from "./DeferredProjection";
import * as ScenarioOutlook from "./ScenarioOutlook";

afterEach(() => jest.restoreAllMocks());

it("keeps the successor's scenario forecast open after the first 240 months", () => {
  const first = createGame({ scenarioId: 117 });
  const offset = 240 * DateTime.MINUTES_PER_MONTH;
  const game = {
    ...first,
    scenarioId: 118,
    date: DateTime.getDateFromMinute(offset, first.startingYear),
    campaign: { ...first.campaign!, generationIndex: 1, termStartMonth: 240 },
    timeline: first.timeline.map((tick) => ({
      ...tick,
      minute: tick.minute + offset,
    })),
    monthlyHistory: [],
  };
  const originalWorker = global.Worker;
  global.Worker = jest.fn() as unknown as typeof Worker;
  jest.spyOn(DeferredProjection, "projectionReady").mockReturnValue(false);
  jest
    .spyOn(DeferredProjection, "requestProjection")
    .mockImplementation(() => undefined);
  try {
    renderDetails(game);
    const outlook = screen.getByRole("region", { name: "Score outlook" });
    expect(outlook).toHaveTextContent("Score now");
    expect(outlook).toHaveTextContent("Projected final");
    expect(
      screen.getByRole("status", { name: "Updating score outlook" }),
    ).toHaveTextContent("Updating...");
    expect(screen.getByRole("region", { name: "Goals" })).not.toHaveTextContent(
      "1921",
    );
  } finally {
    global.Worker = originalWorker;
  }
});

function renderDetails(game = createGame({ scenarioId: 103 })) {
  return render(
    <ScenarioDetailsContent game={game} scenario={activeScenario(game)!} />,
  );
}

it("shows the score forecast immediately and waits for a completed month for the breakdown", () => {
  renderDetails();
  expect(screen.getByText("The Shale Boom")).toBeInTheDocument();
  expect(
    screen.getByText("Breakdown appears after your first month."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Score outlook" }),
  ).toHaveTextContent("Score now0");
  expect(
    screen.getByRole("img", { name: /Chart of score over time/ }),
  ).toBeInTheDocument();
  // The tool's top bar already counts down the term
  expect(screen.queryByText(/months remaining/)).toBeNull();
});

it("shows the score so far beside where the current pace ends it", () => {
  const game = createGame({ scenarioId: 103 });
  // Newest first: three months, each supplying 1 TWh and adding $1B of net worth
  const monthlyHistory = [3, 2, 1].map((month) => ({
    ...DateTime.EMPTY_HISTORY,
    deliveredWhByFuel: {},
    year: game.startingYear,
    month,
    supplyWh: 1e12,
    demandWh: 1e12,
    netWorth: 1e9 * month,
  }));
  renderDetails({ ...game, monthlyHistory });
  const outlook = screen.getByRole("region", { name: "Score outlook" });
  expect(outlook).toHaveTextContent("Score now");
  // This fleet is projected to lose, so the full-term figure is labelled as hypothetical
  expect(outlook).toHaveTextContent("If the run continued");
  expect(
    screen.getByRole("region", { name: "Score breakdown" }),
  ).toHaveTextContent(/TWh supplied/i);
});

it("lists each projected failure separately and removes redundant goal forecasts", () => {
  const game = createGame({ scenarioId: 111 });
  jest.spyOn(MissionProjection, "projectMission").mockReturnValue({
    status: "loss",
    through: "Dec 2026",
    shortageFrom: "Jul 2022",
    requirements: [
      {
        id: "cash",
        label: "Keep the utility solvent",
        required: true,
        status: "at-risk",
        failureMonth: 0,
        detail: "Cash below $0 at Jun 2024 month-end.",
      },
      {
        id: "survival",
        label: "Keep power flowing",
        required: true,
        status: "at-risk",
        failureMonth: 36,
        detail: "Three-month blackout streak projected.",
      },
    ],
  });
  renderDetails(game);
  const outlook = screen.getByRole("region", { name: "Score outlook" });
  const status = within(outlook).getByRole("status", {
    name: "Scenario forecast",
  });
  const failures = within(status).getAllByRole("listitem");
  expect(failures).toHaveLength(2);
  expect(failures[0]).toHaveTextContent("Cash below $0 by Jan 2022.");
  expect(failures[1]).toHaveTextContent(
    "Under 95% of demand served for 3 months by Jan 2025.",
  );
  expect(outlook).not.toHaveTextContent("If you build nothing");
  expect(
    screen.getByRole("img", { name: /Projected loss periods shaded/ }),
  ).toBeInTheDocument();
  expect(screen.getAllByText(/Projected loss:/)).toHaveLength(1);
  // The run would end early, so the full-term score is labelled as hypothetical
  expect(outlook).toHaveTextContent("If the run continued");
  expect(outlook).not.toHaveTextContent("Projected final");
  expect(status).toContainHTML("<strong>Projected loss:</strong>");
  expect(status).toHaveClass("insightsWarning");
  // No icon: the label carries the warning, and the text shares the panel's left edge
  expect(
    // eslint-disable-next-line testing-library/no-node-access
    status.querySelector('[data-concept="danger"]'),
  ).toBeNull();
  const conditions = screen.getByRole("region", { name: "Goals" });
  expect(conditions).not.toHaveTextContent(
    /Projected miss|Projected to meet|Projected loss/,
  );
  expect(conditions).not.toHaveTextContent(
    /Not started|Recorded:|months completed|Delivered customer electricity divided/,
  );
  expect(conditions).toHaveTextContent(
    "Serving less than 95% of demand for 3 months in a row ends the run.",
  );
  expect(
    outlook.compareDocumentPosition(conditions) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("keeps the completed outlook while updating and replaces it when ready", () => {
  const game = createGame({ scenarioId: 111 });
  jest.spyOn(MissionProjection, "projectMission").mockReturnValue({
    status: "win",
    through: "Dec 2026",
    shortageFrom: "Jul 2022",
    requirements: [],
  });
  const ready = jest
    .spyOn(DeferredProjection, "projectionReady")
    .mockReturnValue(true);
  jest
    .spyOn(DeferredProjection, "requestProjection")
    .mockImplementation(() => undefined);
  const scoreProjection = jest
    .spyOn(ScenarioOutlook, "scenarioScoreProjection")
    .mockReturnValue({ actual: [200], projected: [400], final: 400 });
  const view = renderDetails(game);
  const outlook = screen.getByRole("region", { name: "Score outlook" });
  const chart = within(outlook).getByRole("img", { name: /Chart of score/ });
  expect(
    screen.getByRole("status", { name: "Scenario forecast" }),
  ).toHaveTextContent("Projected win.");
  expect(screen.queryByText(/If you build nothing/)).toBeNull();
  const originalWorker = global.Worker;
  Object.defineProperty(global, "Worker", {
    configurable: true,
    value: jest.fn(),
  });
  try {
    ready.mockReturnValue(false);
    scoreProjection.mockReturnValue({
      actual: [200],
      projected: [],
      final: 200,
    });
    view.rerender(
      <ScenarioDetailsContent
        game={{ ...game, dollarsPerkWh: 0 }}
        scenario={activeScenario(game)!}
      />,
    );
    expect(
      screen.getByRole("status", { name: "Scenario forecast" }),
    ).toHaveTextContent("Projected win.");
    expect(within(outlook).getByText("400")).toBeInTheDocument();
    expect(within(outlook).getByRole("img", { name: /Chart of score/ })).toBe(
      chart,
    );
    const updating = within(outlook).getByRole("status", {
      name: "Updating score outlook",
    });
    expect(updating).toHaveTextContent("Updating...");
    expect(
      within(updating).getByRole("progressbar", { hidden: true }),
    ).toBeInTheDocument();
    ready.mockReturnValue(true);
    scoreProjection.mockReturnValue({
      actual: [200],
      projected: [600],
      final: 600,
    });
    view.rerender(
      <ScenarioDetailsContent
        game={{ ...game, dollarsPerkWh: 0 }}
        scenario={activeScenario(game)!}
      />,
    );
    expect(within(outlook).getByText("600")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Updating score outlook" }),
    ).not.toBeInTheDocument();
    // A different run must not inherit this run's completed forecast.
    ready.mockReturnValue(false);
    scoreProjection.mockReturnValue(null);
    const nextRun = { ...game, seed: game.seed + 1 };
    view.rerender(
      <ScenarioDetailsContent
        game={nextRun}
        scenario={activeScenario(nextRun)!}
      />,
    );
    expect(screen.queryByText("600")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Scenario forecast" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Updating score outlook" }),
    ).toBeInTheDocument();
  } finally {
    Object.defineProperty(global, "Worker", {
      configurable: true,
      value: originalWorker,
    });
  }
});

it.each([-198, 198])(
  "uses monthly-profit theme colors for a score change of %s, including projected losses",
  (change) => {
    const game = createGame({ scenarioId: 111 });
    const theme = createTheme({
      palette: { error: { main: "#b51230" }, success: { main: "#087f5b" } },
    });
    jest.spyOn(ScenarioOutlook, "scenarioScoreProjection").mockReturnValue({
      actual: [200],
      projected: [200 + change],
      final: 200 + change,
    });
    jest.spyOn(MissionProjection, "projectMission").mockReturnValue({
      status: "loss",
      through: "Dec 2026",
      requirements: [],
    });
    render(
      <ThemeProvider theme={theme}>
        <ScenarioDetailsContent game={game} scenario={activeScenario(game)!} />
      </ThemeProvider>,
    );
    const outlook = screen.getByRole("region", { name: "Score outlook" });
    const delta = within(outlook).getByText(`${change < 0 ? "−" : "+"}200`);
    expect(delta).toHaveStyle({
      color: change < 0 ? theme.palette.error.main : theme.palette.success.main,
    });
    expect(outlook).not.toHaveTextContent("from now");
  },
);

it.each(SCENARIOS)("omits the supply plan from $name details", (scenario) => {
  const originalWorker = global.Worker;
  global.Worker = jest.fn() as unknown as typeof Worker;
  jest.spyOn(DeferredProjection, "projectionReady").mockReturnValue(false);
  jest
    .spyOn(DeferredProjection, "requestProjection")
    .mockImplementation(() => undefined);
  try {
    const game = createGame({ scenarioId: scenario.id });
    const store = configureStore({ reducer: () => ({ game }) });
    render(
      <Provider store={store}>
        <ScenarioDetailsContent game={game} scenario={scenario} />
      </Provider>,
    );
    expect(
      screen.queryByRole("region", { name: "Supply plan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Next year at current rates and policies/),
    ).not.toBeInTheDocument();
  } finally {
    global.Worker = originalWorker;
  }
});

it("shows the acquisition deadline in scenario details", () => {
  const game = createGame({ scenarioId: 116 });
  renderDetails(game);
  const goals = screen.getByRole("region", { name: "Goals" });
  expect(
    within(goals).getByText("Acquire 3 utilities", { exact: true }),
  ).toBeInTheDocument();
  expect(
    within(goals).getByText("Acquire 3 utilities · Dec 2014", {
      exact: true,
    }),
  ).toBeInTheDocument();
  expect(goals).not.toHaveTextContent("customer baseline");
  expect(goals).not.toHaveTextContent(/retire|original oil/i);
});
