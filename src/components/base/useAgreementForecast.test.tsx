import { act, renderHook } from "@testing-library/react";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../../testing/Simulator";
import { tickState } from "../../reducers/Game";
import type { AgreementForecast } from "../../helpers/AgreementForecast";
import { useAgreementForecast } from "./useAgreementForecast";

const mockCreateWorker = jest.fn();
jest.mock("./ProjectionWorkerClient", () => ({
  createProjectionWorker: () => mockCreateWorker(),
}));
let worker: Worker;
beforeEach(() => {
  worker = {
    postMessage: jest.fn(),
    terminate: jest.fn(),
    onmessage: null,
    onerror: null,
  } as unknown as Worker;
  mockCreateWorker.mockReset().mockReturnValue(worker);
});
function fixture() {
  return createGame({ scenarioId: 116, seed: 12345 });
}
const result = { cutoffMinute: 0, cashDifference: 100 } as AgreementForecast;
function reply(requestId: number, forecast = result) {
  act(() =>
    worker.onmessage?.({
      data: { requestId, agreementForecast: forecast },
    } as MessageEvent),
  );
}

it("keeps a persistent worker and exact cutoff over ordinary ticks, invalidates decisions and rejects stale replies", () => {
  const game = fixture();
  const view = renderHook(
    ({ state }) => useAgreementForecast(state, "champlain-nuclear"),
    { initialProps: { state: game } },
  );
  reply(1);
  expect(view.result.current.result).toBe(result);
  const next = cloneDeep(game);
  next.monthlyHistory = game.monthlyHistory;
  tickState(next);
  view.rerender({ state: next });
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  expect(view.result.current.result?.cutoffMinute).toBe(0);
  const edited = { ...next, dollarsPerkWh: next.dollarsPerkWh + 0.01 };
  view.rerender({ state: edited });
  expect(view.result.current.result).toBeUndefined();
  reply(1);
  expect(view.result.current.result).toBeUndefined();
  reply(2, { ...result, cashDifference: -100 });
  expect(view.result.current.result?.cashDifference).toBe(-100);
  expect(mockCreateWorker).toHaveBeenCalledTimes(1);
});

it("invalidates load/reset even with matching monthly inputs, and offers retry after failure", () => {
  const game = fixture();
  const view = renderHook(
    ({ state }) => useAgreementForecast(state, "champlain-nuclear"),
    { initialProps: { state: game } },
  );
  reply(1);
  view.rerender({ state: cloneDeep(game) });
  expect(view.result.current.result).toBeUndefined();
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  act(() =>
    worker.onmessage?.({ data: { requestId: 2, error: true } } as MessageEvent),
  );
  expect(view.result.current.error).toBe(true);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  act(() => view.result.current.retry());
  expect(mockCreateWorker).toHaveBeenCalledTimes(2);
});

it("never launches a comparison with buying disabled or in co-op", () => {
  const game = fixture();
  game.transmission!.buyingRule = "NONE";
  const view = renderHook(() =>
    useAgreementForecast(game, "champlain-nuclear"),
  );
  expect(view.result.current.blocked).toBe("buying");
  expect(mockCreateWorker).not.toHaveBeenCalled();
});
