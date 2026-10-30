import { render, screen, within } from "@testing-library/react";
import * as DateTime from "../../helpers/DateTime";
import { createGame } from "../../testing/Simulator";
import { activeScenario } from "../../helpers/GameSelectors";
import { ScenarioDetailsContent } from "./ScenarioDetails";
import * as MissionProjection from "../../helpers/MissionProjection";
import * as DeferredProjection from "./DeferredProjection";

afterEach(() => jest.restoreAllMocks());

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
  expect(outlook).toHaveTextContent("Projected final");
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
        id: "reliability",
        label: "Serve demand",
        required: true,
        status: "at-risk",
        failureMonth: 36,
        detail: "Lowest demand served: 92% · Jan–Feb 2025.",
      },
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
        label: "Avoid chronic blackouts",
        required: true,
        status: "on-track",
        detail: "No three-month blackout streak projected.",
      },
    ],
  });
  renderDetails(game);
  const outlook = screen.getByRole("region", { name: "Score outlook" });
  const status = within(outlook).getByRole("status", {
    name: "Scenario forecast",
  });
  expect(status).toHaveTextContent(
    "Projected loss: Cash below $0 by Jan 2022. Under 99.5% of demand served by Jan 2025.",
  );
  expect(
    screen.getByRole("img", { name: /Projected loss periods shaded/ }),
  ).toBeInTheDocument();
  expect(screen.getAllByText(/Projected loss:/)).toHaveLength(1);
  expect(status).toContainHTML("<strong>Projected loss:</strong>");
  expect(status).toHaveClass("insightsWarning");
  expect(within(status).getByTestId("WarningAmberIcon")).toBeInTheDocument();
  const conditions = screen.getByRole("region", { name: "Goals" });
  expect(conditions).not.toHaveTextContent(
    /Projected miss|Projected to meet|Projected loss/,
  );
  expect(conditions).not.toHaveTextContent(
    /Not started|Recorded:|months completed|Delivered customer electricity divided/,
  );
  expect(conditions).toHaveTextContent(
    "Keep the lights on through the wildfire emergency",
  );
  expect(conditions).toHaveTextContent("≥99.5% of demand monthly");
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
