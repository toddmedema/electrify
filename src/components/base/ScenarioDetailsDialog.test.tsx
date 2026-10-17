import { act, render, screen } from "@testing-library/react";
import * as DateTime from "../../helpers/DateTime";
import * as MissionStatus from "../../helpers/MissionStatus";
import * as Scoring from "../../helpers/Scoring";
import { createGame } from "../../testing/Simulator";
import ScenarioDetailsDialog from "./ScenarioDetailsDialog";

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it("does no hidden mission or scoring work and shows the latest game when opened", () => {
  const game = createGame({ scenarioId: 103 });
  const mission = jest.spyOn(MissionStatus, "getMissionStatus");
  const history = jest.spyOn(DateTime, "summarizeHistory");
  const scoring = jest.spyOn(Scoring, "computeScoreBreakdown");
  const onClose = jest.fn();
  const { rerender } = render(
    <ScenarioDetailsDialog open={false} game={game} onClose={onClose} />,
  );
  const latest = {
    ...game,
    date: { ...game.date, monthsElapsed: 1 },
    monthlyHistory: [{ ...DateTime.EMPTY_HISTORY, revenue: 1000 }],
  };
  for (let i = 0; i < 30; i++) {
    rerender(
      <ScenarioDetailsDialog
        open={false}
        game={{ ...latest }}
        onClose={onClose}
      />,
    );
  }
  expect(mission).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
  expect(scoring).not.toHaveBeenCalled();
  rerender(<ScenarioDetailsDialog open game={latest} onClose={onClose} />);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText(/239 months remaining/)).toBeInTheDocument();
  expect(history).toHaveBeenCalledWith(latest.monthlyHistory);
  expect(scoring).toHaveBeenCalled();
});

it("retains contents through the exit transition, then stops work until reopening", () => {
  jest.useFakeTimers();
  const game = createGame({ scenarioId: 103 });
  const mission = jest.spyOn(MissionStatus, "getMissionStatus");
  const onClose = jest.fn();
  const { rerender } = render(
    <ScenarioDetailsDialog open game={game} onClose={onClose} />,
  );
  act(() => jest.advanceTimersByTime(1000));
  rerender(
    <ScenarioDetailsDialog open={false} game={game} onClose={onClose} />,
  );
  expect(screen.getByText(/240 months remaining/)).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(1000));
  expect(screen.queryByText(/240 months remaining/)).not.toBeInTheDocument();
  mission.mockClear();
  const latest = { ...game, date: { ...game.date, monthsElapsed: 12 } };
  rerender(
    <ScenarioDetailsDialog open={false} game={latest} onClose={onClose} />,
  );
  expect(mission).not.toHaveBeenCalled();
  rerender(<ScenarioDetailsDialog open game={latest} onClose={onClose} />);
  expect(screen.getByText(/228 months remaining/)).toBeInTheDocument();
  expect(mission).toHaveBeenCalledWith(latest);
});

it("keeps an unknown scenario closed", () => {
  const game = { ...createGame({ scenarioId: 103 }), scenarioId: -999 };
  render(<ScenarioDetailsDialog open game={game} onClose={jest.fn()} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
