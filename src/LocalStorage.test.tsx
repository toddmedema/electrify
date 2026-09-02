import {
  getPlayedScenarioIds,
  getScenarioPlayCounts,
  getStorageChoice,
  recordScenarioPlayed,
  setStorageKeyValue,
} from "./LocalStorage";
import { getLocalStorage } from "./Globals";

const KEY = "testChoice";

describe("getStorageChoice", () => {
  beforeEach(() => {
    getLocalStorage().removeItem(KEY);
  });

  it("falls back when nothing has been stored yet", () => {
    expect(getStorageChoice(KEY, [1, 5, 10, 20], 1)).toBe(1);
  });

  it("round trips supported primitive choices through storage", () => {
    setStorageKeyValue(KEY, 20);
    expect(getStorageChoice(KEY, [1, 5, 10, 20], 1)).toBe(20);
    setStorageKeyValue(KEY, "revenue");
    expect(getStorageChoice(KEY, ["profit", "revenue"], "profit")).toBe(
      "revenue",
    );
  });

  // The finances year dropdown only offers the years a given game has reached, so a value left
  // by a longer game has to be dropped rather than left selected with nothing to plot
  it("falls back when the stored value is no longer on offer", () => {
    setStorageKeyValue(KEY, 2035);
    expect(getStorageChoice(KEY, [0, -1, 2020], -1)).toBe(-1);
  });

  it("keeps negative and zero choices distinct from the fallback", () => {
    setStorageKeyValue(KEY, 0);
    expect(getStorageChoice(KEY, [0, -1, 2020], -1)).toBe(0);
  });
});

describe("scenario play history", () => {
  beforeEach(() => {
    getLocalStorage().removeItem("plays");
  });

  it("treats legacy records without counts as one play", () => {
    setStorageKeyValue("plays", {
      plays: [
        { scenarioId: 100, date: "2026-08-27" },
        { scenarioId: 101, date: "2026-08-28", timesPlayed: 3 },
      ],
    });

    expect(getScenarioPlayCounts()).toEqual({ 100: 1, 101: 3 });
    expect(getPlayedScenarioIds()).toEqual([100, 101]);

    recordScenarioPlayed(100);
    expect(getScenarioPlayCounts()).toEqual({ 100: 2, 101: 3 });
  });

  it("increments a compact count instead of appending repeat plays", () => {
    recordScenarioPlayed(100);
    recordScenarioPlayed(100);
    recordScenarioPlayed(100);

    expect(getScenarioPlayCounts()).toEqual({ 100: 3 });
    expect(
      JSON.parse(getLocalStorage().getItem("plays") as string).plays,
    ).toEqual([expect.objectContaining({ scenarioId: 100, timesPlayed: 3 })]);
  });
});
