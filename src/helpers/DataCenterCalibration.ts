import { ScenarioType } from "../Types";
import {
  forecastCustomGameTimeline,
  summarizeYearOneOutlook,
} from "./CustomGameForecast";
import {
  createDataCenterScenario,
  DATA_CENTER_DIFFICULTY,
  DATA_CENTER_SEED,
} from "./DataCenterScenario";
import { DataCenterSetupRequest } from "./DataCenterSetup";

/** Runs only after simulation data is loaded, normally inside the setup worker. */
export function calibrateDataCenterScenario({
  location,
  startingYear,
}: Omit<DataCenterSetupRequest, "requestId">): ScenarioType {
  let scenario = createDataCenterScenario(location, startingYear);
  for (let attempt = 0; attempt < 5; attempt++) {
    const timeline = forecastCustomGameTimeline(
      scenario,
      DATA_CENTER_DIFFICULTY,
      DATA_CENTER_SEED,
    );
    const outlook = summarizeYearOneOutlook(timeline);
    if (outlook.worstShortfallW === 0) {
      // Leave a full opening budget after the worst projected first-year cash drawdown.
      const lowestCash = Math.min(
        scenario.cash,
        ...timeline.map((tick) => tick.cash),
      );
      return {
        ...scenario,
        cash: scenario.cash + Math.max(0, scenario.cash - lowestCash),
      };
    }
    // Nameplate output derates in heat. Increase both steady and fast-response supply:
    // merely enlarging a peaker cannot fix every commitment/ramping shortfall.
    // Starting facilities resolve to catalog size steps; sub-step additions would vanish.
    const extra =
      Math.ceil((outlook.worstShortfallW * 2) / 10000000) * 10000000;
    scenario = {
      ...scenario,
      facilities: scenario.facilities.map((facility) =>
        facility.fuel === "Natural Gas"
          ? { ...facility, peakW: (facility.peakW || 0) + extra }
          : facility,
      ),
    };
  }
  throw new Error(
    "We couldn't prepare a reliable starting grid for this location.",
  );
}
