import { act, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { GENERATORS } from "../../data/Facilities";
import { createGame } from "../../testing/Simulator";
import type { GameType } from "../../Types";
import BuildPurchaseReviewDialog from "./BuildPurchaseReviewDialog";
import { signature } from "./DeferredProjection";
import {
  computeOutlook,
  OutlookReply,
  OutlookRequest,
} from "./OutlookForecast";
import UPlotChart from "./UPlotChart";

jest.mock("./UPlotChart", () => jest.fn(() => null));

const originalWorker = global.Worker;
let factory: jest.SpyInstance;
interface StubWorker {
  postMessage: jest.Mock<void, [OutlookRequest]>;
  terminate: jest.Mock;
  onmessage?: (event: { data: OutlookReply }) => void;
}
let workers: StubWorker[];

function fixture() {
  const game = createGame({ scenarioId: 100, seed: 12345 });
  const facility = GENERATORS(game, 50e6, [], []).find(
    (quote) => quote.name === "Natural Gas Peaker",
  )!;
  const store = configureStore({ reducer: { game: () => game } });
  const review = (state: GameType) => (
    <Provider store={store}>
      <BuildPurchaseReviewDialog
        open
        title="Build peaker?"
        game={state}
        facility={facility}
        cash={1e12}
        buildCost={facility.buildCost}
        interestRate={0.05}
        upkeepPerMonth={facility.annualOperatingCost / 12}
        onClose={jest.fn()}
        onPurchase={jest.fn()}
      />
    </Provider>
  );
  return { game, facility, review };
}

const flush = () => act(() => jest.advanceTimersByTime(100));
const chartState = () => jest.mocked(UPlotChart).mock.calls.at(-1)![0].state;
function reply(index: number) {
  const worker = workers[index];
  const { requestId, game, facility } = worker.postMessage.mock.calls[0][0];
  const result = computeOutlook("buildImpact", game, facility)!;
  act(() => worker.onmessage?.({ data: { requestId, result } }));
  return result;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(UPlotChart).mockClear();
  global.Worker = jest.fn() as unknown as typeof Worker;
  workers = [];
  factory = jest
    .spyOn(jest.requireMock("./OutlookWorkerClient"), "createOutlookWorker")
    .mockImplementation(() => {
      const worker = { postMessage: jest.fn(), terminate: jest.fn() };
      workers.push(worker);
      return worker;
    });
});

afterEach(() => {
  factory.mockRestore();
  global.Worker = originalWorker;
  jest.useRealTimers();
});

it("replaces an imported run's estimate even when its projection signature matches", () => {
  const { game, review } = fixture();
  const view = render(review(game));
  flush();
  const initial = reply(0);
  expect(chartState()).toEqual(initial);

  const ticking = {
    ...game,
    date: { ...game.date, minute: game.date.minute + 15 },
  };
  expect(signature(ticking)).toBe(signature(game));
  view.rerender(review(ticking));
  flush();
  expect(factory).toHaveBeenCalledTimes(1);
  expect(chartState()).toEqual(initial);

  const imported = createGame({ scenarioId: 100, seed: 12345 });
  imported.timeline.forEach((tick) => {
    tick.customers *= 3;
    tick.cash += 1e9;
  });
  expect(signature(imported)).toBe(signature(game));
  expect(imported.runIdentity).not.toBe(game.runIdentity);
  view.rerender(review(imported));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Estimating grid impact",
  );
  expect(
    screen.getByRole("region", { name: "Expected impact" }),
  ).toHaveTextContent("Estimating…");
  flush();
  expect(factory).toHaveBeenCalledTimes(2);
  expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  expect(workers[1].postMessage.mock.calls[0][0].game.timeline).toBe(
    imported.timeline,
  );
  reply(0);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Estimating grid impact",
  );
  const refreshed = reply(1);
  expect(refreshed).not.toEqual(initial);
  expect(chartState()).toEqual(refreshed);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it.each(["unavailable", "blocked"])(
  "shows the synchronous forecast when worker startup is %s",
  (failure) => {
    const { game, facility, review } = fixture();
    const expected = computeOutlook("buildImpact", game, facility)!;
    if (failure === "unavailable") {
      global.Worker = undefined as unknown as typeof Worker;
      factory.mockImplementation(() => new Worker(""));
    } else {
      factory.mockImplementation(() => {
        throw new Error("worker blocked");
      });
    }
    render(review(game));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Estimating grid impact",
    );
    flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(chartState()).toEqual(expected);
    const facts = screen.getByRole("region", { name: "Expected impact" });
    expect(facts).toHaveTextContent("Lowest supply margin");
    expect(facts).not.toHaveTextContent("Estimating…");
  },
);
