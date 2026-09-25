import { act, render, screen } from "@testing-library/react";
import * as React from "react";
import { GameType } from "../../Types";
import { MissionRisk } from "../../helpers/MissionStatus";
import MissionSummary from "./MissionSummary";

const mockSelectProjection = jest.fn();
const mockSelectMissionRisk = jest.fn();
const mockProjectedShortfall = jest.fn();
const mockRequirements: { id: string; status: string }[] = [];
jest.mock("../../helpers/Projection", () => ({
  projectionSignature: (game: GameType) => `month ${game.date.monthsElapsed}`,
  selectProjection: (...args: unknown[]) => mockSelectProjection(...args),
}));
jest.mock("../../helpers/MissionStatus", () => ({
  getMissionStatus: () => ({
    monthsRemaining: 12,
    requirements: mockRequirements,
  }),
  projectedShortfall: (...args: unknown[]) => mockProjectedShortfall(...args),
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

const summary = (game: GameType) => (
  <MissionSummary game={game} onDetails={jest.fn()} />
);

beforeEach(() => {
  jest.useFakeTimers();
  mockSelectProjection.mockReset();
  mockSelectMissionRisk.mockReset();
  mockProjectedShortfall.mockReset();
  mockRequirements.length = 0;
});
afterEach(() => jest.useRealTimers());

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

it("computes a risk that returns before the runway check as usual", () => {
  mockSelectMissionRisk.mockReturnValue({
    id: "reliability",
    label: "Required reliability window missed",
    shortLabel: "Reliability missed",
    target: "mission-details",
  });
  const view = render(summary(makeGame(10)));
  mockSelectMissionRisk.mockReturnValue(runway(3));
  view.rerender(summary(makeGame(11)));
  expect(screen.getByText("Cash out in ~3 mo")).toBeTruthy();
  act(() => {
    jest.runAllTimers();
  });
  expect(mockSelectProjection).not.toHaveBeenCalled();
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
  it("a shortfall expected later today", () => {
    const view = steadyState(event);
    expect(screen.getByText("Upcoming: Winter freeze")).toBeTruthy();
    mockProjectedShortfall.mockReturnValue({ minute: 5 });
    mockSelectMissionRisk.mockReturnValue({
      id: "projection:2006:2",
      label: "Shortfall expected later today",
      shortLabel: "Projected shortfall",
      target: "supply-demand",
    });
    view.rerender(summary(makeGame(2)));
    expect(screen.getByText("Projected shortfall")).toBeTruthy();
    expect(mockSelectMissionRisk).toHaveBeenCalledTimes(1);
  });

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
