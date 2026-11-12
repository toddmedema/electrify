import { act, renderHook } from "@testing-library/react";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../../testing/Simulator";
import { tickState } from "../../reducers/Game";
import type { AgreementForecast } from "../../helpers/AgreementForecast";
import {
  agreementYearMinute,
  powerAgreementQuote,
} from "../../helpers/PowerAgreements";
import { getDateFromMinute } from "../../helpers/DateTime";
import { useAgreementForecast } from "./useAgreementForecast";

const mockCreateWorker = jest.fn();
jest.mock("./ProjectionWorkerClient", () => ({
  createProjectionWorker: () => mockCreateWorker(),
}));
let workers: Worker[];
beforeEach(() => {
  workers = [];
  mockCreateWorker.mockReset().mockImplementation(() => {
    const worker = {
      postMessage: jest.fn(),
      terminate: jest.fn(),
      onmessage: null,
      onerror: null,
      onmessageerror: null,
    } as unknown as Worker;
    workers.push(worker);
    return worker;
  });
});
function fixture() {
  return createGame({ scenarioId: 116, seed: 12345 });
}
const result = { cutoffMinute: 0, cashDifference: 100 } as AgreementForecast;
function reply(worker: Worker, requestId: number, forecast = result) {
  act(() =>
    worker.onmessage?.({
      data: { requestId, agreementForecast: forecast },
    } as MessageEvent),
  );
}

it("keeps legacy cutoffs stable over ordinary ticks and cancels superseded requests", () => {
  const game = fixture();
  game.transmission!.inheritedAgreementTerms = 2;
  const view = renderHook(
    ({ state }) => useAgreementForecast(state, "champlain-nuclear"),
    { initialProps: { state: game } },
  );
  reply(workers[0], 1);
  const next = cloneDeep(game);
  next.monthlyHistory = game.monthlyHistory;
  tickState(next);
  view.rerender({ state: next });
  expect(workers).toHaveLength(1);
  expect(view.result.current.result?.cutoffMinute).toBe(0);
  const staleReply = workers[0].onmessage!;
  const staleError = workers[0].onerror!;
  const edited = { ...next, dollarsPerkWh: next.dollarsPerkWh + 0.01 };
  view.rerender({ state: edited });
  expect(view.result.current.result).toBeUndefined();
  expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  expect(workers).toHaveLength(2);
  act(() => {
    staleReply.call(workers[0], {
      data: { requestId: 1, agreementForecast: result },
    } as MessageEvent);
    staleError.call(workers[0], new ErrorEvent("error"));
  });
  expect(view.result.current.result).toBeUndefined();
  expect(workers[1].terminate).not.toHaveBeenCalled();
  reply(workers[1], 2, { ...result, cashDifference: -100 });
  expect(view.result.current.result?.cashDifference).toBe(-100);
});

it("invalidates current v3 cutoff and month meter inputs", () => {
  const game = fixture();
  const view = renderHook(
    ({ state }) => useAgreementForecast(state, "champlain-nuclear"),
    { initialProps: { state: game } },
  );
  reply(workers[0], 1);
  const next = cloneDeep(game);
  next.monthlyHistory = game.monthlyHistory;
  tickState(next);
  view.rerender({ state: next });
  expect(view.result.current.result).toBeUndefined();
  expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  expect(workers).toHaveLength(2);
});

it("updates quote identity while dragging without launching heavy jobs, then runs only the committed term and reuses cached results", () => {
  const game = fixture();
  const minute = agreementYearMinute(2018);
  game.date = getDateFromMinute(minute, game.startingYear);
  for (const tick of game.timeline) tick.minute += minute;
  const quote = (duration: number) =>
    powerAgreementQuote(game, "champlain-quebec", 3, duration)!.receipt;
  const view = renderHook(
    ({ duration, committed, open }) =>
      useAgreementForecast(
        game,
        open ? "champlain-quebec:0" : undefined,
        quote(duration),
        committed,
      ),
    { initialProps: { duration: 10, committed: true, open: true } },
  );
  reply(workers[0], 1);
  expect(view.result.current.result).toBe(result);
  view.rerender({ duration: 9, committed: false, open: true });
  expect(view.result.current.result).toBeUndefined();
  expect(view.result.current.updating).toBe(true);
  expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  for (let duration = 8; duration >= 1; duration--)
    view.rerender({ duration, committed: false, open: true });
  expect(workers).toHaveLength(1);
  view.rerender({ duration: 1, committed: true, open: true });
  expect(workers).toHaveLength(2);
  const message = (workers[1].postMessage as jest.Mock).mock.calls[0][0];
  expect(message.offer.durationYears).toBe(1);
  reply(workers[1], message.requestId, { ...result, cashDifference: -500 });
  expect(view.result.current.result?.cashDifference).toBe(-500);
  view.rerender({ duration: 10, committed: false, open: true });
  view.rerender({ duration: 10, committed: true, open: true });
  expect(view.result.current.result).toBe(result);
  expect(workers).toHaveLength(2);
  view.rerender({ duration: 5, committed: true, open: true });
  expect(workers).toHaveLength(3);
  view.rerender({ duration: 5, committed: true, open: false });
  expect(workers[2].terminate).toHaveBeenCalledTimes(1);
  view.unmount();
});

it("invalidates load/reset and offers retry after failure", () => {
  const game = fixture();
  const view = renderHook(
    ({ state }) => useAgreementForecast(state, "champlain-nuclear"),
    { initialProps: { state: game } },
  );
  reply(workers[0], 1);
  view.rerender({ state: cloneDeep(game) });
  expect(view.result.current.result).toBeUndefined();
  expect(workers).toHaveLength(2);
  act(() =>
    workers[1].onmessage?.({
      data: { requestId: 2, error: true },
    } as MessageEvent),
  );
  expect(view.result.current.error).toBe(true);
  expect(workers[1].terminate).toHaveBeenCalledTimes(1);
  act(() => view.result.current.retry());
  expect(workers).toHaveLength(3);
});

it("never launches comparisons with buying disabled", () => {
  const game = fixture();
  game.transmission!.buyingRule = "NONE";
  const view = renderHook(() =>
    useAgreementForecast(game, "champlain-nuclear"),
  );
  expect(view.result.current.blocked).toBe("buying");
  expect(mockCreateWorker).not.toHaveBeenCalled();
});
