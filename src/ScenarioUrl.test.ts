import {
  scenarioDetailsUrl,
  scenarioFromSearch,
  scenarioListUrl,
} from "./ScenarioUrl";

describe("scenario URLs", () => {
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
