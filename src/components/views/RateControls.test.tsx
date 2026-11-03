import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { EMPTY_HISTORY } from "../../helpers/DateTime";
import { CUSTOM_SCENARIO_ID, getScenario } from "../../data/Scenarios";
import { createGame } from "../../testing/Simulator";
import { GameType } from "../../Types";
import { currentTick } from "../../helpers/GameSelectors";
import * as DeferredProjection from "../base/DeferredProjection";
import RateControls from "./RateControls";

function renderRates(scenarioId = 100, game = createGame({ scenarioId })) {
  return render(<RateControls game={game} onDelta={() => undefined} />);
}

test("shows pricing and the market benchmark without a customer-program requirement", () => {
  renderRates(3);
  const pricing = screen.getByRole("region", { name: "Electricity pricing" });
  expect(pricing).toHaveAccessibleDescription(
    /projected customers .* next month/i,
  );
  expect(within(pricing).getByText("Market")).toBeInTheDocument();
  expect(within(pricing).getByText("Customers/mo")).toBeInTheDocument();
  expect(screen.getByRole("slider")).toBeVisible();
});

test("commits a rate change", () => {
  const game = createGame({ scenarioId: 100 });
  const onDelta = jest.fn();
  render(<RateControls game={game} onDelta={onDelta} />);
  fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
  expect(onDelta).toHaveBeenCalledWith({ dollarsPerkWh: expect.any(Number) });
});

it.each(["Investor", "Public"] as const)(
  "caps the %s slider at exactly twice the target, even with a higher saved rate",
  (ownership) => {
    const game = createGame({ scenarioId: 100 });
    const target = 0.1234;
    renderRates(100, {
      ...game,
      scenarioId: CUSTOM_SCENARIO_ID,
      customScenario: {
        ...getScenario(100)!,
        id: CUSTOM_SCENARIO_ID,
        ownership,
        dollarsPerkWh: target,
      },
      dollarsPerkWh: target * 3,
    });
    expect(screen.getByRole("slider")).toHaveAttribute(
      "aria-valuemax",
      String(target * 2),
    );
  },
);

it("shows a public utility the points its rate earns over the next year", () => {
  const game = createGame({ scenarioId: 107 });
  const target = game.dollarsPerkWh;
  renderRates(107, { ...game, dollarsPerkWh: target - 0.02 });

  const levers = screen.getByRole("region", { name: "Electricity pricing" });
  // Customers never switch and growth is fixed, so neither is worth the space
  expect(levers).not.toHaveTextContent(/market/i);
  expect(levers).not.toHaveTextContent(/growth/i);
  expect(
    within(levers).getByText("Target", {
      selector: "div.insightsRateMetrics .insightsRateMetricLabel",
    }),
  ).toBeInTheDocument();
  expect(
    within(levers).getByText("Points / yr", {
      selector: "div.insightsRateMetrics .insightsRateMetricLabel",
    }),
  ).toBeInTheDocument();
  const points = within(levers).getByText(/pts$/, {
    selector:
      "div.insightsRateMetrics .insightsRateMetricValue.insightsRateScore",
  });
  expect(points.textContent).toMatch(/^\+\d+ pts$/);
  expect(points).toHaveClass("good");
  expect(
    screen.getByRole("region", { name: "Electricity pricing" }),
  ).toHaveAccessibleDescription(/rate score \+\d+ pts over the next year/i);
});

it("marks a public utility rate above its target as losing points", () => {
  const game = createGame({ scenarioId: 107 });
  renderRates(107, { ...game, dollarsPerkWh: game.dollarsPerkWh + 0.01 });

  const points = within(
    screen.getByRole("region", { name: "Electricity pricing" }),
  ).getByText(/pts$/, {
    selector:
      "div.insightsRateMetrics .insightsRateMetricValue.insightsRateScore",
  });
  expect(points.textContent).toMatch(/^−\d+ pts$/);
  expect(points).toHaveClass("bad");
});

describe("background rate estimates", () => {
  const originalWorker = global.Worker;
  let game: GameType;
  let ready: jest.SpyInstance;
  let publish: () => void;

  beforeEach(() => {
    game = createGame({ scenarioId: 107 });
    game = { ...game, dollarsPerkWh: game.dollarsPerkWh - 0.02 };
    const projection = DeferredProjection.readProjection(
      game,
      currentTick(game)!,
    );
    global.Worker = jest.fn() as unknown as typeof Worker;
    ready = jest
      .spyOn(DeferredProjection, "projectionReady")
      .mockReturnValue(false);
    jest
      .spyOn(DeferredProjection, "readProjection")
      .mockReturnValue(projection);
    jest
      .spyOn(DeferredProjection, "requestProjection")
      .mockImplementation(() => undefined);
    jest
      .spyOn(DeferredProjection, "subscribeProjection")
      .mockImplementation((listener) => {
        publish = listener;
        return () => undefined;
      });
  });

  afterEach(() => {
    global.Worker = originalWorker;
    jest.restoreAllMocks();
  });

  it("keeps points through monthly refreshes and reprices immediately while pending", () => {
    const view = renderRates(107, game);
    const pricing = screen.getByRole("region", { name: "Electricity pricing" });
    expect(within(pricing).getByText("Calculating…")).toBeVisible();
    expect(screen.getByRole("slider")).not.toHaveAttribute(
      "aria-valuetext",
      expect.stringContaining("rate score"),
    );
    ready.mockReturnValue(true);
    act(() => publish());
    const points = within(pricing).getByText(/^\+\d+ pts$/);
    const previous = points.textContent;
    ready.mockReturnValue(false);
    const next = {
      ...game,
      date: { ...game.date, monthsElapsed: game.date.monthsElapsed + 1 },
      monthlyHistory: [...game.monthlyHistory],
    };
    view.rerender(<RateControls game={next} onDelta={() => undefined} />);
    expect(points).toHaveTextContent(previous!);
    expect(pricing).not.toHaveTextContent("Calculating");
    expect(pricing).toHaveAccessibleDescription(
      /estimated rate score \+\d+ pts/,
    );
    view.rerender(
      <RateControls
        game={{ ...next, dollarsPerkWh: game.dollarsPerkWh + 0.03 }}
        onDelta={() => undefined}
      />,
    );
    expect(points).toHaveTextContent(/^−\d+ pts$/);
    expect(points).toHaveClass("bad");
    jest.mocked(DeferredProjection.readProjection).mockReturnValue({
      ...DeferredProjection.readProjection(game, currentTick(game)!),
      financeProjected: [],
    });
    ready.mockReturnValue(true);
    act(() => publish());
    expect(points).toHaveTextContent("±0 pts");
  });

  it.each(["run", "seed", "year", "rewind", "ownership"])(
    "clears the previous estimate after changing %s",
    (change) => {
      ready.mockReturnValue(true);
      const view = renderRates(107, game);
      ready.mockReturnValue(false);
      const next = { ...game };
      if (change === "run") next.runIdentity = { ...game.runIdentity! };
      if (change === "seed") next.seed += 1;
      if (change === "year") next.startingYear += 1;
      if (change === "rewind")
        next.date = { ...game.date, minute: game.date.minute - 1 };
      if (change === "ownership") next.scenarioId = 100;
      view.rerender(<RateControls game={next} onDelta={() => undefined} />);
      // Returning while a new forecast is pending must not resurrect an old run's estimate.
      view.rerender(<RateControls game={game} onDelta={() => undefined} />);
      expect(screen.getByText("Calculating…")).toBeVisible();
    },
  );
});

it("shows a year's rate moving a long record's score less", () => {
  const points = (game: GameType) => {
    const { unmount } = renderRates(107, game);
    const value = Number(
      within(screen.getByRole("region", { name: "Electricity pricing" }))
        .getByText(/pts$/, {
          selector:
            "div.insightsRateMetrics .insightsRateMetricValue.insightsRateScore",
        })
        .textContent!.replace(/[^\d]/g, ""),
    );
    unmount();
    return value;
  };
  const game = createGame({ scenarioId: 107 });
  const cheaper = { ...game, dollarsPerkWh: game.dollarsPerkWh - 0.02 };
  // Years of sales at the target already on the record dilute the coming year
  const established = {
    ...cheaper,
    monthlyHistory: [
      {
        ...EMPTY_HISTORY,
        supplyWh: 1e15,
        revenue: (1e15 / 1000) * game.dollarsPerkWh,
      },
    ],
  };

  expect(points(established)).toBeLessThan(points(cheaper));
});

it("always counts a public rate's points over a full year, even as the run ends", () => {
  const points = (game: GameType) => {
    const { unmount } = renderRates(107, game);
    const value = within(
      screen.getByRole("region", { name: "Electricity pricing" }),
    ).getByText(/pts$/, {
      selector:
        "div.insightsRateMetrics .insightsRateMetricValue.insightsRateScore",
    }).textContent;
    unmount();
    return value;
  };
  const game = createGame({ scenarioId: 107 });
  const established = {
    ...game,
    dollarsPerkWh: game.dollarsPerkWh - 0.02,
    monthlyHistory: [
      {
        ...EMPTY_HISTORY,
        supplyWh: 1e15,
        revenue: (1e15 / 1000) * game.dollarsPerkWh,
      },
    ],
  };
  // One month left; the projection is the same one, so only the window could differ
  const ending = {
    ...established,
    date: {
      ...established.date,
      monthsElapsed: getScenario(107)!.durationMonths - 1,
    },
  };

  expect(points(ending)).toBe(points(established));
});

it("labels the public slider axis in cents with a short cap", () => {
  renderRates(107);
  const marks = within(screen.getByTestId("rate-slider-control"))
    .getAllByText(/./, { selector: ".insightsRateMarkDesktop" })
    .map((mark) => mark.textContent);
  expect(marks).toEqual([
    "0¢",
    expect.stringMatching(/^\d+¢ target$/),
    expect.stringMatching(/^\d+¢ cap$/),
  ]);
});

it("offers a public utility a switch to follow inflation, off once a rate is chosen", () => {
  const game = createGame({ scenarioId: 107 });
  const onDelta = jest.fn();
  const view = render(<RateControls game={game} onDelta={onDelta} />);
  const follow = screen.getByRole("switch", { name: "Follow inflation" });
  expect(follow).toBeChecked();
  fireEvent.click(follow);
  expect(onDelta).toHaveBeenCalledWith({ rateFollowsInflation: false });
  view.rerender(
    <RateControls
      game={{ ...game, rateFollowsInflation: false }}
      onDelta={onDelta}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Rate no longer follows inflation.",
  );
  fireEvent.click(screen.getByRole("switch", { name: "Follow inflation" }));
  expect(onDelta).toHaveBeenLastCalledWith({ rateFollowsInflation: true });
});

it("doesn't offer an investor-owned utility inflation to follow", () => {
  renderRates(100);
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
});

it("keeps keyboard focus on the slider across committed rate steps", () => {
  const start = createGame({ scenarioId: 100 });
  const committed: number[] = [];
  function Harness() {
    const [game, setGame] = React.useState(start);
    return (
      <RateControls
        game={game}
        onDelta={(change) => {
          committed.push(change.dollarsPerkWh!);
          setGame((current) => ({ ...current, ...change }));
        }}
      />
    );
  }
  render(<Harness />);
  screen.getByRole("slider").focus();
  fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
  expect(screen.getByRole("slider")).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
  expect(screen.getByRole("slider")).toHaveFocus();
  expect(committed).toHaveLength(2);
  expect(committed[1]).toBeGreaterThan(committed[0]);
  expect(Number(screen.getByRole("slider").getAttribute("value"))).toBe(
    committed[1],
  );
});
