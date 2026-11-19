import { GENERATORS, STORAGE } from "../data/Facilities";
import { createGame } from "../testing/Simulator";
import reducer, { buildFacility } from "../reducers/Game";
import { availableTerritoryTiles } from "../helpers/TerritoryTiles";
import { forecastWorkerSnapshot } from "../components/base/ForecastWorkerSnapshot";
import {
  computeOutlook,
  OutlookReply,
  OutlookRequest,
} from "../components/base/OutlookForecast";

jest.mock("./ForecastData", () => ({
  createForecastDataLoader: () => async () => undefined,
}));

const worker = globalThis as unknown as Worker;
const originalHandler = worker.onmessage;
let postMessage: jest.SpyInstance;

beforeEach(() => {
  postMessage = jest
    .spyOn(worker, "postMessage")
    .mockImplementation(() => undefined);
  require("./Outlook.worker");
});

afterAll(() => {
  worker.onmessage = originalHandler;
});

afterEach(() => postMessage.mockRestore());

it.each(["generator", "storage"] as const)(
  "keeps the selected territory in a %s worker forecast and matches the page fallback",
  async (kind) => {
    let game = createGame({ scenarioId: 116, seed: 188 });
    game.territoryNetwork = {
      version: 3,
      landPurchases: [{ territoryId: "green-uplands", minute: 0, price: 18e6 }],
      legacyConnections: [],
    };
    game.date.year = 2020;
    game.timeline.forEach((tick) => {
      tick.cash = 1e12;
    });
    // Reserve the first plains cell through a real purchase, leaving forest next remotely.
    game = reducer(
      game,
      buildFacility({
        facility: GENERATORS(game, 20e6, [], []).find(
          (quote) => quote.name === "Wind",
        )!,
        financed: false,
        territoryId: "green-uplands",
        tileId: "green-uplands:site-0",
      }),
    );
    const facility =
      kind === "generator"
        ? GENERATORS(game, 100e6, [], []).find(
            (quote) => quote.name === "Wind",
          )!
        : STORAGE(game, 100e6).find((quote) => quote.name === "Battery")!;
    const homeTile = availableTerritoryTiles(game, facility, "champlain")[0];
    const remoteTile = availableTerritoryTiles(
      game,
      facility,
      "green-uplands",
    )[0];
    expect([homeTile.terrain, remoteTile.terrain]).toEqual([
      "plains",
      "forest",
    ]);
    const snapshot = forecastWorkerSnapshot(game);
    const expected = computeOutlook(
      "buildImpact",
      snapshot,
      facility,
      "green-uplands",
    );
    const home = computeOutlook("buildImpact", snapshot, facility);
    expect(expected).toBeDefined();
    expect(expected).toEqual(
      computeOutlook("buildImpact", game, facility, "green-uplands"),
    );
    expect(JSON.stringify(expected) === JSON.stringify(home)).toBe(
      kind === "storage",
    );
    const result = await new Promise<OutlookReply>((resolve) => {
      postMessage.mockImplementationOnce(resolve);
      const request: OutlookRequest = {
        requestId: 1,
        kind: "buildImpact",
        game: snapshot,
        facility,
        territoryId: "green-uplands",
      };
      worker.onmessage?.({ data: request } as MessageEvent<OutlookRequest>);
    });
    expect(result).toEqual({ requestId: 1, result: expected });
  },
);

it("forecasts the explicit non-default site within the selected territory", async () => {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const facility = GENERATORS(game, 50e6, [], []).find(
    ({ name }) => name === "Wind",
  )!;
  const tiles = availableTerritoryTiles(game, facility, "champlain");
  const chosen = tiles.find(({ terrain }) => terrain !== tiles[0].terrain)!;
  const snapshot = forecastWorkerSnapshot(game);
  const expected = computeOutlook(
    "buildImpact",
    snapshot,
    facility,
    "champlain",
    chosen.id,
  );
  expect(expected).toBeDefined();
  expect(expected).not.toEqual(
    computeOutlook("buildImpact", snapshot, facility, "champlain"),
  );
  const reply = await new Promise<OutlookReply>((resolve) => {
    postMessage.mockImplementationOnce(resolve);
    const request: OutlookRequest = {
      requestId: 2,
      kind: "buildImpact",
      game: snapshot,
      facility,
      territoryId: "champlain",
      tileId: chosen.id,
    };
    worker.onmessage?.({ data: request } as MessageEvent<OutlookRequest>);
  });
  expect(reply).toEqual({ requestId: 2, result: expected });
});
