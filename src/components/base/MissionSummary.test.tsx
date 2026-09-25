import { act, render, screen } from "@testing-library/react";
import * as React from "react";
import { GameType } from "../../Types";
import { MissionRisk } from "../../helpers/MissionStatus";
import MissionSummary from "./MissionSummary";

const mockSelectProjection = jest.fn();
const mockSelectMissionRisk = jest.fn();
jest.mock("../../helpers/Projection", () => ({
  projectionSignature: (game: GameType) => `month ${game.date.monthsElapsed}`,
  selectProjection: (...args: unknown[]) => mockSelectProjection(...args),
}));
jest.mock("../../helpers/MissionStatus", () => ({
  getMissionStatus: () => ({ monthsRemaining: 12, requirements: [] }),
  selectMissionRisk: (...args: unknown[]) => mockSelectMissionRisk(...args),
}));

const runway = (months: number): MissionRisk => ({
  id: "cash-runway",
  label: `Projected cash runs out in about ${months} months`,
  shortLabel: `Cash out in ~${months} mo`,
  target: "finances",
});

const history: never[] = [];
function makeGame(monthsElapsed: number, minute = monthsElapsed): GameType {
  return {
    date: { monthsElapsed, minute },
    timeline: [{ minute: 0 }],
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
