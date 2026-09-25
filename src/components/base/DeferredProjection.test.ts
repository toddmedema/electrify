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
jest.mock("../../helpers/Projection", () => ({
  projectionSignature: (game: GameType) => `month ${game.date.monthsElapsed}`,
  selectProjection: (...args: unknown[]) => mockSelectProjection(...args),
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
