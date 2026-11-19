import type { CSSProperties } from "react";
import type { MapWeather } from "./MapWeather";
import { useMapAnimationPlayback } from "../useFacilityMapMotion";
import "./WeatherAtmosphere.scss";

/** Composited, repeating textures keep the number of weather layers fixed at any zoom. */
export default function WeatherAtmosphere({
  weather,
  motion,
  dark,
}: {
  weather: MapWeather;
  motion: { allowed: boolean; rate: number };
  dark: boolean;
}) {
  const { rain, snowfall, cloud, wind } = weather;
  const overcast = Math.max(0, (cloud - 0.24) / 0.76);
  const gust = Math.min(1, Math.max(0, (wind * 60 - 22) / 13));
  const cloudsVisible = overcast >= 0.02;
  const rainVisible = rain >= 0.02;
  const snowVisible = snowfall >= 0.02;
  const windVisible = gust >= 0.02;
  const layers = `${cloudsVisible}:${rainVisible}:${snowVisible}:${windVisible}`;
  const ref = useMapAnimationPlayback<HTMLDivElement>(
    motion.allowed,
    motion.rate,
    layers,
  );
  if (!cloudsVisible && !rainVisible && !snowVisible && !windVisible)
    return null;
  const style = {
    "--map-weather-rain-angle": `${-(8 + wind * 25)}deg`,
    "--map-weather-snow-angle": `${-(3 + wind * 34)}deg`,
  } as CSSProperties;
  return (
    <div
      className="territoryMapWeather"
      ref={ref}
      aria-hidden="true"
      data-weather-motion={motion.allowed ? "running" : "paused"}
      data-weather-theme={dark ? "dark" : "light"}
      style={style}
    >
      {cloudsVisible && (
        <div className="mapWeatherClouds" style={{ opacity: overcast }} />
      )}
      {rainVisible && (
        <div
          className="mapWeatherRain"
          style={{ opacity: 0.22 + rain * 0.54 }}
        />
      )}
      {snowVisible && (
        <div
          className="mapWeatherSnow"
          style={{ opacity: 0.28 + snowfall * 0.62 }}
        />
      )}
      {windVisible && (
        <div className="mapWeatherWind" style={{ opacity: gust * 0.5 }} />
      )}
    </div>
  );
}
