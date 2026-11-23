import { LEGACY_SCENARIOS } from "./data/LegacyCampaign";
import { SCENARIOS } from "./data/Scenarios";
import { getScenarioLocation } from "./helpers/Locations";
import { offlineWeatherFile } from "./OfflineWeatherData";
import { weatherLocationIds } from "./helpers/WeatherLocations";

export function officialOfflineWeather(): { id: string; integrity: string }[] {
  const ids = new Set(
    [...SCENARIOS, ...LEGACY_SCENARIOS].flatMap((scenario) => {
      const location = getScenarioLocation(scenario);
      if (!location)
        throw new Error(`Missing location for scenario ${scenario.id}`);
      return weatherLocationIds(location);
    }),
  );
  return [...ids].map((id) => {
    const file = offlineWeatherFile(id);
    if (!file) throw new Error(`Missing shipped weather for ${id}`);
    return file;
  });
}
