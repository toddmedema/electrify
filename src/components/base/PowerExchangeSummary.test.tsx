import { act, render, screen } from "@testing-library/react";
import PowerExchangeSummary from "./PowerExchangeSummary";
import { GameType, TickPresentFutureType } from "../../Types";

jest.mock("./ManualLink", () => () => null);

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
