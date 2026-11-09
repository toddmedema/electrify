import { render, screen, within } from "@testing-library/react";
import * as DateTime from "../../helpers/DateTime";
import { createGame } from "../../testing/Simulator";
import { activeScenario } from "../../helpers/GameSelectors";
import { ScenarioDetailsContent } from "./ScenarioDetails";
import * as MissionProjection from "../../helpers/MissionProjection";
import * as DeferredProjection from "./DeferredProjection";

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
      screen.getByRole("status", { name: "Scenario forecast" }),
    ).toHaveTextContent("Updating forecast");
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

it("keeps one concise loss line under the score chart and removes redundant goal forecasts", () => {
  const game = createGame({ scenarioId: 111 });
  jest.spyOn(MissionProjection, "projectMission").mockReturnValue({
    status: "loss",
    through: "Dec 2026",
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
  expect(status).toHaveTextContent(
    "Projected loss: Cash below $0 by Jan 2022. Under 95% of demand served for 3 months by Jan 2025.",
  );
  expect(
    screen.getByRole("img", { name: /Projected loss periods shaded/ }),
  ).toBeInTheDocument();
  expect(screen.getAllByText(/Projected loss:/)).toHaveLength(1);
  // The run would end early, so the full-term score is labelled as hypothetical
  expect(outlook).toHaveTextContent("If the run continued");
  expect(outlook).not.toHaveTextContent("Projected final");
  expect(status).toContainHTML("<strong>Projected loss:</strong>");
  expect(status).toHaveClass("insightsWarning");
  // The game's shared danger glyph, not a one-off warning triangle
  expect(
    // eslint-disable-next-line testing-library/no-node-access
    status.querySelector('[data-concept="danger"]'),
  ).toBeInTheDocument();
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

it("clears a stale win while an edited plan is being forecast", () => {
  const game = createGame({ scenarioId: 111 });
  jest
    .spyOn(MissionProjection, "projectMission")
    .mockReturnValue({ status: "win", through: "Dec 2026", requirements: [] });
  const ready = jest
    .spyOn(DeferredProjection, "projectionReady")
    .mockReturnValue(true);
  jest
    .spyOn(DeferredProjection, "requestProjection")
    .mockImplementation(() => undefined);
  const view = renderDetails(game);
  expect(
    screen.getByRole("status", { name: "Scenario forecast" }),
  ).toHaveTextContent("Projected win.");
  const originalWorker = global.Worker;
  Object.defineProperty(global, "Worker", {
    configurable: true,
    value: jest.fn(),
  });
  try {
    ready.mockReturnValue(false);
    view.rerender(
      <ScenarioDetailsContent
        game={{ ...game, dollarsPerkWh: 0 }}
        scenario={activeScenario(game)!}
      />,
    );
    expect(
      screen.getByRole("status", { name: "Scenario forecast" }),
    ).toHaveTextContent("Updating forecast…");
    expect(screen.queryByText("Projected win.")).toBeNull();
  } finally {
    Object.defineProperty(global, "Worker", {
      configurable: true,
      value: originalWorker,
    });
  }
});
