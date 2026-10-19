import { act, render, screen } from "@testing-library/react";
import * as React from "react";
import { GameType } from "../../Types";
import { MissionRisk } from "../../helpers/MissionStatus";
import MissionSummary from "./MissionSummary";

const mockSelectProjection = jest.fn();
const mockSelectMissionRisk = jest.fn();
const mockRequirements: { id: string; status: string }[] = [];
jest.mock("../../helpers/Projection", () => ({
  projectionSignature: (game: GameType) => `month ${game.date.monthsElapsed}`,
  selectProjection: (...args: unknown[]) => mockSelectProjection(...args),
  cacheProjection: () => undefined,
}));
jest.mock("../../helpers/MissionStatus", () => ({
  getMissionStatus: () => ({
    monthsRemaining: 12,
    requirements: mockRequirements,
  }),
  selectMissionRisk: (...args: unknown[]) => mockSelectMissionRisk(...args),
}));

const runway = (months: number): MissionRisk => ({
  id: "cash-runway",
  label: `Projected cash runs out in about ${months} months`,
  shortLabel: `Cash out in ~${months} mo`,
  target: "finances",
});

const event: MissionRisk = {
  id: "event:freeze",
  label: "Announced event: Winter freeze",
  shortLabel: "Upcoming: Winter freeze",
  target: "supply-demand",
};

const history: never[] = [];
function makeGame(
  monthsElapsed: number,
  minute = monthsElapsed,
  tick: { cash?: number; supplyW?: number; demandW?: number } = {},
): GameType {
  return {
    date: { monthsElapsed, minute },
    timeline: [{ minute: 0, cash: 1, supplyW: 1, demandW: 1, ...tick }],
    monthlyHistory: history,
  } as unknown as GameType;
}

const summary = (game: GameType) => <MissionSummary game={game} />;

beforeEach(() => {
  jest.useFakeTimers();
  mockSelectProjection.mockReset();
  mockSelectMissionRisk.mockReset();
  mockRequirements.length = 0;
});
afterEach(() => jest.useRealTimers());

it("does not synchronously simulate or show a runway warning while its first worker forecast is pending", () => {
  const originalWorker = global.Worker;
  global.Worker = jest.fn() as unknown as typeof Worker;
  mockSelectMissionRisk.mockReturnValue(runway(6));
  try {
    const view = render(summary(makeGame(31)));
    expect(screen.queryByText("Cash out in ~6 mo")).not.toBeInTheDocument();
    expect(mockSelectMissionRisk).not.toHaveBeenCalled();
    expect(mockSelectProjection).not.toHaveBeenCalled();
    act(() => jest.runAllTimers());
    expect(mockSelectProjection).not.toHaveBeenCalled();
    view.unmount();
  } finally {
    global.Worker = originalWorker;
  }
});

it("clears the previous run's pending warning when a matching-calendar save is imported", () => {
  mockSelectMissionRisk.mockReturnValue(runway(6));
  const first = makeGame(32);
  const view = render(summary(first));
  expect(screen.getByText("Cash out in ~6 mo")).toBeInTheDocument();
  const originalWorker = global.Worker;
  global.Worker = jest.fn() as unknown as typeof Worker;
  try {
    view.rerender(summary({ ...first, monthlyHistory: [] }));
    expect(screen.queryByText("Cash out in ~6 mo")).not.toBeInTheDocument();
    view.unmount();
  } finally {
    global.Worker = originalWorker;
  }
});

it("keeps the runway warning off the frame that makes the projection stale", () => {
  mockSelectMissionRisk.mockReturnValue(runway(6));
  const view = render(summary(makeGame(1)));
  expect(screen.getByText("Cash out in ~6 mo")).toBeTruthy();
  // The next tick finds no projection registered as current yet, so it asks for one
  view.rerender(summary(makeGame(1, 2)));
  act(() => {
    jest.runAllTimers();
  });
  expect(mockSelectProjection).toHaveBeenCalledTimes(1);
  // Ordinary ticks in the same month read the risk directly
  view.rerender(summary(makeGame(1, 3)));
  act(() => {
    jest.runAllTimers();
  });
  expect(mockSelectProjection).toHaveBeenCalledTimes(1);
  const calls = mockSelectMissionRisk.mock.calls.length;

  // The month rolls over: last month's warning stays up, and nothing reads the projection yet
  mockSelectMissionRisk.mockReturnValue(runway(5));
  view.rerender(summary(makeGame(2)));
  expect(screen.getByText("Cash out in ~6 mo")).toBeTruthy();
  expect(mockSelectMissionRisk).toHaveBeenCalledTimes(calls);
  expect(mockSelectProjection).toHaveBeenCalledTimes(1);

  act(() => {
    jest.runAllTimers();
  });
  expect(mockSelectProjection).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Cash out in ~5 mo")).toBeTruthy();
});

it("clears an expired early risk without synchronously rebuilding the runway forecast", () => {
  mockSelectMissionRisk.mockReturnValue({
    id: "reliability",
    label: "Required reliability window missed",
    shortLabel: "Reliability missed",
    target: "mission-details",
  });
  const view = render(summary(makeGame(10)));
  mockSelectMissionRisk.mockClear();
  mockSelectMissionRisk.mockReturnValue(runway(3));
  view.rerender(summary(makeGame(11)));
  expect(screen.queryByText("Reliability missed")).not.toBeInTheDocument();
  expect(mockSelectMissionRisk).not.toHaveBeenCalled();
  expect(mockSelectProjection).not.toHaveBeenCalled();
  act(() => {
    jest.runAllTimers();
  });
  expect(mockSelectProjection).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Cash out in ~3 mo")).toBeTruthy();
});

/** Mounted mid-month with `risk` showing and the month's projection already current. */
function steadyState(risk: MissionRisk) {
  mockSelectMissionRisk.mockReturnValue(risk);
  const view = render(summary(makeGame(1)));
  view.rerender(summary(makeGame(1, 2)));
  act(() => {
    jest.runAllTimers();
  });
  mockSelectProjection.mockClear();
  mockSelectMissionRisk.mockClear();
  return view;
}

describe("an early risk that appears on the rollover frame replaces the kept one at once", () => {
  it("negative cash now", () => {
    const view = steadyState(runway(4));
    mockSelectMissionRisk.mockReturnValue({
      id: "cash",
      label: "Now: cash is negative",
      shortLabel: "Check finances",
      target: "finances",
    });
    view.rerender(summary(makeGame(2, 2, { cash: -1 })));
    expect(screen.getByText("Check finances")).toBeTruthy();
  });

  it("a missed reliability window", () => {
    const view = steadyState(event);
    mockRequirements.push({ id: "reliability", status: "failed" });
    mockSelectMissionRisk.mockReturnValue({
      id: "reliability",
      label: "Required reliability window missed",
      shortLabel: "Reliability missed",
      target: "mission-details",
    });
    view.rerender(summary(makeGame(2)));
    expect(screen.getByText("Reliability missed")).toBeTruthy();
  });
});

it("keeps an upcoming-event notice for the frame when no early risk is due", () => {
  const view = steadyState(event);
  mockSelectMissionRisk.mockReturnValue(runway(2));
  view.rerender(summary(makeGame(2)));
  expect(screen.getByText("Upcoming: Winter freeze")).toBeTruthy();
  expect(mockSelectMissionRisk).not.toHaveBeenCalled();
  act(() => {
    jest.runAllTimers();
  });
  expect(screen.getByText("Cash out in ~2 mo")).toBeTruthy();
});

it("cancels the requested projection on unmount", () => {
  const view = steadyState(runway(6));
  view.rerender(summary(makeGame(2)));
  view.unmount();
  act(() => {
    jest.runAllTimers();
  });
  expect(mockSelectProjection).not.toHaveBeenCalled();
});

it("marks an upcoming event as news rather than a warning", () => {
  const view = steadyState(event);
  expect(
    screen.getByRole("button", { name: /^Upcoming: Winter freeze\./ }),
  ).toHaveClass("missionRiskEvent");
  expect(screen.getByLabelText("Mission progress")).not.toHaveClass(
    "statusWarning",
  );
  view.unmount();

  steadyState(runway(4));
  expect(screen.getByLabelText("Mission progress")).toHaveClass(
    "statusWarning",
  );
  expect(screen.getByRole("button", { name: /Cash/ })).not.toHaveClass(
    "missionRiskEvent",
  );
});
