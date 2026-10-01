import {
  customEventFromSearch,
  isDataCenterSetupSearch,
  scenarioDetailsUrl,
  scenarioFromSearch,
  scenarioListUrl,
} from "./ScenarioUrl";

describe("scenario URLs", () => {
  it("opens guided data-center setup only for the explicit route", () => {
    expect(isDataCenterSetupSearch("?dataCenters=1")).toBe(true);
    expect(isDataCenterSetupSearch("?campaign=fall&dataCenters=1")).toBe(true);
    for (const search of [
      "",
      "?dataCenters=0",
      "?dataCenters=true",
      "?dataCenters=1oops",
    ]) {
      expect(isDataCenterSetupSearch(search)).toBe(false);
    }
  });

  it("clears guided setup when navigating to the game catalog or a challenge", () => {
    const location = { pathname: "/", search: "?dataCenters=1&campaign=fall" };
    expect(scenarioListUrl(location)).toBe("/?campaign=fall");
    expect(scenarioDetailsUrl(111, location)).toBe(
      "/?campaign=fall&scenario=111",
    );
  });
  it("accepts only supported custom event ids", () => {
    expect(customEventFromSearch("?customEvent=106")).toBe(106);
    for (const search of [
      "",
      "?customEvent=0",
      "?customEvent=999",
      "?customEvent=106oops",
      "?customEvent=-106",
    ]) {
      expect(customEventFromSearch(search)).toBeUndefined();
    }
  });

  it("clears the custom event when leaving its setup route", () => {
    const location = {
      pathname: "/",
      search: "?customEvent=106&campaign=fall",
    };
    expect(scenarioListUrl(location)).toBe("/?campaign=fall");
    expect(scenarioDetailsUrl(111, location)).toBe(
      "/?campaign=fall&scenario=111",
    );
  });
  it("resolves a public challenge from a shared query", () => {
    expect(scenarioFromSearch("?scenario=111")?.name).toBe(
      "Wildfire Emergency",
    );
  });

  it("does not route unknown, malformed, or tutorial ids to challenge details", () => {
    expect(scenarioFromSearch("?scenario=99999")).toBeUndefined();
    expect(scenarioFromSearch("?scenario=111oops")).toBeUndefined();
    expect(scenarioFromSearch("?scenario=0")).toBeUndefined();
  });

  it("adds and removes only the scenario query parameter", () => {
    const location = {
      pathname: "/play",
      search: "?campaign=fall",
    } as Location;
    expect(scenarioDetailsUrl(111, location)).toBe(
      "/play?campaign=fall&scenario=111",
    );
    expect(
      scenarioListUrl({
        pathname: "/play",
        search: "?campaign=fall&scenario=111",
      } as Location),
    ).toBe("/play?campaign=fall");
  });
});
