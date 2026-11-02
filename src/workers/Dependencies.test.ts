export {};

const browserServices = [
  "../Globals",
  "../LocalStorage",
  "../reducers/User",
  "../reducers/Card",
  "../reducers/UI",
  "firebase/app",
  "firebase/auth",
  "firebase/firestore",
];

describe("forecast worker dependencies", () => {
  const previousHandler = globalThis.onmessage;

  beforeEach(() => {
    jest.resetModules();
    for (const service of browserServices) {
      jest.doMock(service, () => {
        throw new Error(
          `A forecast worker imported browser service ${service}`,
        );
      });
    }
    globalThis.onmessage = null;
  });

  afterEach(() => {
    globalThis.onmessage = previousHandler;
    for (const service of browserServices) jest.dontMock(service);
  });

  it("keeps browser effects inert until a live store registers them", () => {
    const { getGameEffects } =
      require("../StoreRegistry") as typeof import("../StoreRegistry");
    const effects = getGameEffects();
    expect(() => {
      effects.logEvent("scenario_end");
      effects.recordScenarioPlayed(101);
      effects.submitHighscore({
        scenarioId: 101,
        difficulty: "Intern",
        outcome: "completed",
        score: 123,
        scoreBreakdown: {},
      });
    }).not.toThrow();
  });

  it.each([
    "Projection",
    "Outlook",
    "PolicyPreview",
    "CustomGameForecast",
    "ScenarioStartingPeak",
    "DataCenterSetup",
  ])("initializes %s without loading browser services", (worker) => {
    require(`./${worker}.worker`);
    expect(globalThis.onmessage).toEqual(expect.any(Function));
  });
});
