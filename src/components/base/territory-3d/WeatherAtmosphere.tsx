import type { CSSProperties } from "react";
import type { MapWeather } from "./MapWeather";
import "./WeatherAtmosphere.scss";

/** Composited, repeating textures keep the number of weather layers fixed at any zoom. */
export default function WeatherAtmosphere({
  weather,
  moving,
  dark,
}: {
  weather: MapWeather;
  moving: boolean;
  dark: boolean;
}) {
  const { rain, snowfall, cloud, wind } = weather;
  const overcast = Math.max(0, (cloud - 0.24) / 0.76);
  const gust = Math.min(1, Math.max(0, (wind * 60 - 22) / 13));
  if (rain < 0.02 && snowfall < 0.02 && overcast < 0.02 && gust < 0.02)
    return null;
  const style = {
    "--map-weather-rain-angle": `${-(8 + wind * 25)}deg`,
    "--map-weather-snow-angle": `${-(3 + wind * 34)}deg`,
  } as CSSProperties;
  return (
    <div
      className="territoryMapWeather"
      aria-hidden="true"
      data-weather-motion={moving ? "running" : "paused"}
      data-weather-theme={dark ? "dark" : "light"}
      style={style}
    >
      {overcast >= 0.02 && (
        <div className="mapWeatherClouds" style={{ opacity: overcast }} />
      )}
      {rain >= 0.02 && (
        <div
          className="mapWeatherRain"
          style={{ opacity: 0.22 + rain * 0.54 }}
        />
      )}
      {snowfall >= 0.02 && (
        <div
          className="mapWeatherSnow"
          style={{ opacity: 0.28 + snowfall * 0.62 }}
        />
      )}
      {gust >= 0.02 && (
        <div className="mapWeatherWind" style={{ opacity: gust * 0.5 }} />
      )}
    </div>
  );
}
