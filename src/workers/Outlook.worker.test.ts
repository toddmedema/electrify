import { GENERATORS, STORAGE } from "../data/Facilities";
import { createGame } from "../testing/Simulator";
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
    const game = createGame({ scenarioId: 116, seed: 188 });
    game.territoryNetwork = {
      version: 2,
      landPurchases: [{ territoryId: "green-uplands", minute: 0, price: 18e6 }],
      legacyConnections: [],
    };
    game.date.year = 2020;
    const facility =
      kind === "generator"
        ? GENERATORS(game, 100e6, [], []).find(
            (quote) => quote.name === "Wind",
          )!
        : STORAGE(game, 100e6).find((quote) => quote.name === "Battery")!;
    const snapshot = forecastWorkerSnapshot(game);
    const expected = computeOutlook(
      "buildImpact",
      snapshot,
      facility,
      "green-uplands",
    );
    expect(expected).toEqual(computeOutlook("buildImpact", snapshot, facility));
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
