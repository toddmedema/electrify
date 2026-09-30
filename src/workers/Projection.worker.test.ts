import type { GameType, LocationType, TickPresentFutureType } from "../Types";

const mockEconomy = jest.fn();
const mockFuelPrices = jest.fn();
const mockWeather = jest.fn();
const mockProjection = jest.fn();
jest.mock("../data/Economy", () => ({
  initEconomy: (done: (error?: string) => void) => mockEconomy(done),
}));
jest.mock("../data/FuelPrices", () => ({
  initFuelPrices: (done: (error?: string) => void) => mockFuelPrices(done),
}));
jest.mock("../data/Weather", () => ({
  initWeather: (location: LocationType, done: (error?: string) => void) =>
    mockWeather(location, done),
}));
jest.mock("../helpers/Projection", () => ({
  selectProjection: (...args: unknown[]) => mockProjection(...args),
}));

const worker = globalThis as unknown as Worker;
const originalHandler = worker.onmessage;
let requestId = 0;
let reply: jest.SpyInstance;

beforeEach(() => {
  mockEconomy.mockReset().mockImplementation((done) => done());
  mockFuelPrices.mockReset().mockImplementation((done) => done());
  mockWeather.mockReset().mockImplementation((_location, done) => done());
  mockProjection.mockReset().mockReturnValue({ forecast: [] });
  reply = jest.spyOn(worker, "postMessage").mockImplementation(() => undefined);
  jest.isolateModules(() => require("./Projection.worker"));
});

afterEach(() => {
  worker.onmessage = originalHandler;
  reply.mockRestore();
});

async function request(location = "london", seed = 7, watershedId?: string) {
  const game = { seed, location: { id: location, watershedId } } as GameType;
  const now = { minute: 0 } as TickPresentFutureType;
  return new Promise<{ requestId: number; error?: boolean }>((resolve) => {
    reply.mockImplementationOnce(resolve);
    worker.onmessage?.({
      data: { requestId: ++requestId, game, now },
    } as MessageEvent);
  });
}

it("keeps initialized data and its forecast caches between requests for the same run", async () => {
  await request();
  await request();
  expect(mockEconomy).toHaveBeenCalledTimes(1);
  expect(mockFuelPrices).toHaveBeenCalledTimes(1);
  expect(mockWeather).toHaveBeenCalledTimes(1);
  expect(mockProjection).toHaveBeenCalledTimes(2);
});

it("reloads weather when either the city or watershed changes", async () => {
  await request();
  await request("paris");
  await request("paris", 7, "basin");
  await request("paris", 7, "basin");
  expect(mockWeather).toHaveBeenCalledTimes(3);
  expect(mockEconomy).toHaveBeenCalledTimes(1);
  expect(mockFuelPrices).toHaveBeenCalledTimes(1);
});

it("resets all seeded forecast data when a different run seed arrives", async () => {
  await request();
  await request("london", 8);
  await request("london", 8);
  expect(mockEconomy).toHaveBeenCalledTimes(2);
  expect(mockFuelPrices).toHaveBeenCalledTimes(2);
  expect(mockWeather).toHaveBeenCalledTimes(2);
});

it("retries failed initialization without reloading successful data", async () => {
  mockWeather.mockImplementationOnce((_location, done) => done("offline"));
  expect((await request()).error).toBe(true);
  expect(mockProjection).not.toHaveBeenCalled();
  expect((await request()).error).toBeUndefined();
  expect(mockEconomy).toHaveBeenCalledTimes(1);
  expect(mockFuelPrices).toHaveBeenCalledTimes(1);
  expect(mockWeather).toHaveBeenCalledTimes(2);
  expect(mockProjection).toHaveBeenCalledTimes(1);
});

it("retries an unsuccessful economy load", async () => {
  mockEconomy.mockImplementationOnce((done) => done("offline"));
  expect((await request()).error).toBe(true);
  expect((await request()).error).toBeUndefined();
  expect(mockEconomy).toHaveBeenCalledTimes(2);
  expect(mockFuelPrices).toHaveBeenCalledTimes(1);
  expect(mockWeather).toHaveBeenCalledTimes(1);
});
