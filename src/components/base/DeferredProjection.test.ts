import {
  GameType,
  MonthlyHistoryType,
  TickPresentFutureType,
} from "../../Types";
import {
  projectionReady,
  readProjection,
  requestProjection,
  subscribeProjection,
} from "./DeferredProjection";

const mockSelectProjection = jest.fn();
const mockCacheProjection = jest.fn();
const mockCreateWorker = jest.fn();
jest.mock("./ProjectionWorkerClient", () => ({
  createProjectionWorker: () => mockCreateWorker(),
}));
jest.mock("../../helpers/Projection", () => ({
  projectionSignature: (game: GameType) => `month ${game.date.monthsElapsed}`,
  selectProjection: (...args: unknown[]) => mockSelectProjection(...args),
  cacheProjection: (...args: unknown[]) => mockCacheProjection(...args),
}));

const now = { minute: 0 } as TickPresentFutureType;

// Each test gets its own history array, which is part of what makes a projection current, so
// the module's state from one test never counts as ready in the next
function makeGame(
  monthsElapsed: number,
  monthlyHistory: MonthlyHistoryType[] = [],
): GameType {
  return { date: { monthsElapsed }, monthlyHistory } as unknown as GameType;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSelectProjection.mockReset();
  mockCacheProjection.mockReset();
  mockSelectProjection.mockImplementation((game: GameType) => ({
    month: game.date.monthsElapsed,
  }));
});
afterEach(() => jest.useRealTimers());

it("computes a requested projection after paint and tells every subscriber at once", () => {
  const game = makeGame(1);
  const first = jest.fn();
  const second = jest.fn();
  const unsubscribe = [subscribeProjection(first), subscribeProjection(second)];
  requestProjection(game, now);
  // A second reader asking for the same inputs shares the one computation
  requestProjection(makeGame(1, game.monthlyHistory), now);
  expect(mockSelectProjection).not.toHaveBeenCalled();
  expect(projectionReady(game)).toBe(false);
  jest.runAllTimers();
  expect(mockSelectProjection).toHaveBeenCalledTimes(1);
  expect(mockSelectProjection).toHaveBeenCalledWith(game, now);
  expect(projectionReady(game)).toBe(true);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  unsubscribe.forEach((u) => u());
});

it("drops a request that newer inputs replaced before it ran", () => {
  const history: MonthlyHistoryType[] = [];
  const unsubscribe = subscribeProjection(jest.fn());
  requestProjection(makeGame(1, history), now);
  const newer = makeGame(2, history);
  requestProjection(newer, now);
  jest.runAllTimers();
  expect(mockSelectProjection).toHaveBeenCalledTimes(1);
  expect(mockSelectProjection).toHaveBeenCalledWith(newer, now);
  unsubscribe();
});

it("treats a projection read synchronously as ready, so no request is made", () => {
  const game = makeGame(3);
  expect(readProjection(game, now)).toEqual({ month: 3 });
  expect(projectionReady(game)).toBe(true);
  requestProjection(game, now);
  jest.runAllTimers();
  expect(mockSelectProjection).toHaveBeenCalledTimes(1);
  // A different run with the same signature is not the same projection
  expect(projectionReady(makeGame(3))).toBe(false);
});

it("cancels pending work once nobody is listening", () => {
  const unsubscribe = subscribeProjection(jest.fn());
  requestProjection(makeGame(4), now);
  unsubscribe();
  jest.runAllTimers();
  expect(mockSelectProjection).not.toHaveBeenCalled();
});

describe("worker forecasts", () => {
  const originalWorker = global.Worker;
  let worker: {
    postMessage: jest.Mock;
    terminate: jest.Mock;
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
  };
  beforeEach(() => {
    global.Worker = jest.fn() as unknown as typeof Worker;
    worker = { postMessage: jest.fn(), terminate: jest.fn() };
    mockCreateWorker.mockReturnValue(worker);
  });
  afterEach(() => {
    global.Worker = originalWorker;
  });

  it("shares one worker result with all readers without simulating on the UI thread", () => {
    const game = makeGame(5);
    const changed = jest.fn();
    const unsubscribe = subscribeProjection(changed);
    requestProjection(game, now);
    requestProjection(makeGame(5, game.monthlyHistory), now);
    jest.runAllTimers();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(mockSelectProjection).not.toHaveBeenCalled();
    const request = worker.postMessage.mock.calls[0][0];
    const projection = { month: 5 };
    worker.onmessage?.({ data: { requestId: request.requestId, projection } });
    expect(mockCacheProjection).toHaveBeenCalledWith(game, projection);
    expect(projectionReady(game)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(mockSelectProjection).not.toHaveBeenCalled();
    unsubscribe();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("discards obsolete replies and collapses rapid edits to the newest snapshot", () => {
    const changed = jest.fn();
    const unsubscribe = subscribeProjection(changed);
    requestProjection(makeGame(6), now);
    jest.runAllTimers();
    const first = worker.postMessage.mock.calls[0][0];
    requestProjection(makeGame(7), now);
    const latest = makeGame(8);
    requestProjection(latest, now);
    jest.runAllTimers();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.onmessage?.({
      data: { requestId: first.requestId, projection: {} },
    });
    expect(changed).not.toHaveBeenCalled();
    expect(mockCacheProjection).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    const last = worker.postMessage.mock.calls[1][0];
    expect(last.game).toBe(latest);
    worker.onmessage?.({ data: { requestId: last.requestId, projection: {} } });
    expect(projectionReady(latest)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("falls back after paint when a worker fails", () => {
    const unsubscribe = subscribeProjection(jest.fn());
    const game = makeGame(9);
    requestProjection(game, now);
    jest.runAllTimers();
    worker.onerror?.();
    expect(mockSelectProjection).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(mockSelectProjection).toHaveBeenCalledWith(game, now);
    expect(projectionReady(game)).toBe(true);
    unsubscribe();
  });
});
