import { act, render, screen } from "@testing-library/react";
import PowerExchangeSummary from "./PowerExchangeSummary";
import { GameType, TickPresentFutureType } from "../../Types";

const game = { speed: "NORMAL" } as GameType;
const now = (flow: number) =>
  ({
    importedW: Math.max(0, flow),
    exportedW: Math.max(0, -flow),
  }) as TickPresentFutureType;
// Motion is decorative and intentionally absent from the accessibility tree.
// eslint-disable-next-line testing-library/no-node-access
const arrow = () => document.querySelector(".powerExchangeArrow")!;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("keeps facts immediate, waits for stable direction, and cancels stale motion", () => {
  const { rerender } = render(
    <PowerExchangeSummary game={game} now={now(10)} />,
  );
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(arrow()).not.toHaveAttribute("data-moving");
  rerender(<PowerExchangeSummary game={game} now={now(-10)} />);
  expect(screen.getByText("Exporting")).toBeVisible();
  expect(arrow()).not.toHaveAttribute("data-moving");
  act(() => {
    jest.advanceTimersByTime(350);
  });
  expect(arrow()).toHaveAttribute("data-moving", "true");
  rerender(<PowerExchangeSummary game={game} now={now(0)} />);
  expect(screen.getByText("Standing by")).toBeVisible();
  expect(arrow()).not.toHaveAttribute("data-moving");
});

it("suppresses chatter, paused/fast motion, and resume celebrations", () => {
  const { rerender } = render(
    <PowerExchangeSummary game={game} now={now(10)} />,
  );
  rerender(<PowerExchangeSummary game={game} now={now(-10)} />);
  act(() => {
    jest.advanceTimersByTime(200);
  });
  rerender(<PowerExchangeSummary game={game} now={now(10)} />);
  act(() => {
    jest.advanceTimersByTime(350);
  });
  expect(arrow()).toHaveAttribute("data-moving", "true");
  rerender(<PowerExchangeSummary game={game} now={now(-10)} />);
  act(() => {
    jest.advanceTimersByTime(350);
  });
  expect(arrow()).not.toHaveAttribute("data-moving");
  for (const speed of ["PAUSED", "FAST", "NORMAL"] as const) {
    rerender(<PowerExchangeSummary game={{ ...game, speed }} now={now(10)} />);
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(arrow()).not.toHaveAttribute("data-moving");
  }
});

it("consumes cues even without animationend and cancels pending cues on pause", () => {
  const { rerender } = render(
    <PowerExchangeSummary game={game} now={now(0)} />,
  );
  rerender(<PowerExchangeSummary game={game} now={now(10)} />);
  act(() => {
    jest.advanceTimersByTime(350);
  });
  expect(arrow()).toHaveAttribute("data-moving", "true");
  act(() => {
    jest.advanceTimersByTime(500);
  });
  expect(arrow()).not.toHaveAttribute("data-moving");
  rerender(<PowerExchangeSummary game={game} now={now(-10)} />);
  rerender(
    <PowerExchangeSummary game={{ ...game, speed: "PAUSED" }} now={now(-10)} />,
  );
  act(() => {
    jest.advanceTimersByTime(3000);
  });
  expect(arrow()).not.toHaveAttribute("data-moving");
});

describe("as the current reading beside the exchange chart", () => {
  const MW = 1e6;
  const withLines = (nameplateMW: number[]) =>
    ({
      ...game,
      transmission: {
        tradingPolicy: "BALANCED",
        lines: nameplateMW.map((capacity) => ({
          capacityW: capacity * MW,
          yearsToBuildLeft: 0,
        })),
      },
    }) as unknown as GameType;
  const reading = (flowMW: number, availableMW: number, price: number) =>
    ({
      ...now(flowMW * MW),
      transmissionCapacityW: availableMW * MW,
      marketPricePerMWh: price,
    }) as TickPresentFutureType;

  it("names the direction and size of the flow with the capacity and price it ran at", () => {
    render(
      <PowerExchangeSummary
        game={withLines([100])}
        now={reading(-40, 100, 52)}
      />,
    );
    expect(screen.getByRole("heading", { name: "Exporting" })).toBeVisible();
    const definitions = screen.getAllByRole("definition");
    expect(
      Object.fromEntries(
        screen
          .getAllByRole("term")
          .map((term, i) => [term.textContent, definitions[i].textContent]),
      ),
    ).toEqual({
      "Power flowing": "40MW",
      "Available capacity": "100MW",
      "Neighbor price": "$52/MWh",
    });
    expect(screen.queryByText(/nameplate capacity/)).toBeNull();
  });

  it("calls the price an average once several lines share the flow, and says when heat cuts them back", () => {
    render(
      <PowerExchangeSummary
        game={withLines([100, 50])}
        now={reading(10, 120, 40)}
      />,
    );
    expect(screen.getByText("Average neighbor price")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Importing" })).toBeVisible();
    expect(
      screen.getByText(/lines from 150MW nameplate capacity/),
    ).toBeVisible();
  });
});
